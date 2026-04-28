-- Extensions pour la plateforme Medecin / Patient

-- 1. Ajout de champs additionnels pour les profils
alter table public.profiles
add column if not exists address text,
add column if not exists latitude float,
add column if not exists longitude float,
add column if not exists bio text,
add column if not exists avatar_url text;

-- 1.1 Bucket Storage pour les avatars utilisateurs
insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', true)
on conflict (id) do nothing;

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable" on storage.objects
for select
using (bucket_id = 'profile-avatars');

drop policy if exists "Users can upload own avatar" on storage.objects;
create policy "Users can upload own avatar" on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own avatar" on storage.objects;
create policy "Users can update own avatar" on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own avatar" on storage.objects;
create policy "Users can delete own avatar" on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 2. Table: Availabilities (Disponibilités des médecins)
create table if not exists public.availabilities (
  id uuid default gen_random_uuid() primary key,
  doctor_id uuid references public.profiles(id) on delete cascade not null,
  day_of_week integer not null check (day_of_week between 0 and 6), -- 0=Dimanche, 6=Samedi
  start_time time not null,
  end_time time not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.availabilities enable row level security;
drop policy if exists "Tous les utilisateurs peuvent voir les dispos" on public.availabilities;
create policy "Tous les utilisateurs peuvent voir les dispos" on public.availabilities for select using (true);
drop policy if exists "Les docteurs gerent leurs dispos" on public.availabilities;
create policy "Les docteurs gerent leurs dispos" on public.availabilities for all using (auth.uid() = doctor_id);

-- 3. Table: Appointments (Rendez-vous)
create table if not exists public.appointments (
  id uuid default gen_random_uuid() primary key,
  patient_id uuid references public.profiles(id) on delete cascade not null,
  doctor_id uuid references public.profiles(id) on delete cascade not null,
  appointment_date timestamp with time zone not null,
  status text not null check (status in ('pending', 'confirmed', 'cancelled', 'completed')) default 'pending',
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.appointments enable row level security;
drop policy if exists "Les patients voient leurs rdv" on public.appointments;
create policy "Les patients voient leurs rdv" on public.appointments for select using (auth.uid() = patient_id);
drop policy if exists "Les medecins voient leurs rdv" on public.appointments;
create policy "Les medecins voient leurs rdv" on public.appointments for select using (auth.uid() = doctor_id);
drop policy if exists "Les patients creent des rdv" on public.appointments;
create policy "Les patients creent des rdv" on public.appointments for insert with check (auth.uid() = patient_id);
drop policy if exists "Les medecins et patients modifient rdv" on public.appointments;
create policy "Les medecins et patients modifient rdv" on public.appointments for update using (auth.uid() in (patient_id, doctor_id));
create index if not exists idx_appointments_doctor_date on public.appointments (doctor_id, appointment_date);
create index if not exists idx_appointments_patient_date on public.appointments (patient_id, appointment_date);

-- 4. Table: Reviews (Avis et Notes)
create table if not exists public.reviews (
  id uuid default gen_random_uuid() primary key,
  patient_id uuid references public.profiles(id) on delete cascade not null,
  doctor_id uuid references public.profiles(id) on delete cascade not null,
  appointment_id uuid references public.appointments(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (appointment_id)
);
alter table public.reviews
add column if not exists appointment_id uuid references public.appointments(id) on delete cascade;
alter table public.reviews enable row level security;
drop policy if exists "Tout le monde voit les avis" on public.reviews;
create policy "Tout le monde voit les avis" on public.reviews for select using (true);
drop policy if exists "Les patients peuvent laisser un avis" on public.reviews;
create policy "Les patients peuvent laisser un avis" on public.reviews
for insert
with check (
  auth.uid() = patient_id
  and appointment_id is not null
  and exists (
    select 1
    from public.appointments a
    where a.id = appointment_id
      and a.patient_id = auth.uid()
      and a.doctor_id = doctor_id
      and a.status = 'completed'
  )
);
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reviews_appointment_id_unique'
  ) then
    alter table public.reviews
      add constraint reviews_appointment_id_unique unique (appointment_id);
  end if;
end $$;

create index if not exists idx_reviews_doctor on public.reviews (doctor_id);

create or replace view public.doctor_ratings as
select
  doctor_id,
  round(avg(rating)::numeric, 1) as avg_rating,
  count(*)::int as total_reviews
from public.reviews
group by doctor_id;

-- 5. Table: Articles (Contenu médical)
create table if not exists public.articles (
  id uuid default gen_random_uuid() primary key,
  author_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.articles enable row level security;
drop policy if exists "Tout le monde voit les articles" on public.articles;
create policy "Tout le monde voit les articles" on public.articles for select using (true);
drop policy if exists "Les medecins creent/modifient" on public.articles;
-- Les medecins creent/modifient
create policy "Les medecins creent/modifient" on public.articles for all using (auth.uid() = author_id);
create index if not exists idx_articles_author_created_at on public.articles (author_id, created_at desc);
create index if not exists idx_profiles_account_type_specialty on public.profiles (account_type, specialty);

-- 6. Fonction de calcul des médecins à proximité (Géolocalisation / Ajout Larabi)
-- Utilisation de la formule de Haversine pour le calcul de distance en Km.
create or replace function get_nearby_doctors(
  user_lat float, 
  user_lon float, 
  radius_km float
)
returns setof public.profiles
language sql
as $$
  select *
  from public.profiles
  where account_type = 'doctor'
    and latitude is not null 
    and longitude is not null
    and (
      6371 * acos(
        cos(radians(user_lat)) * cos(radians(latitude)) *
        cos(radians(longitude) - radians(user_lon)) +
        sin(radians(user_lat)) * sin(radians(latitude))
      )
    ) <= radius_km
  order by (
    6371 * acos(
      cos(radians(user_lat)) * cos(radians(latitude)) *
      cos(radians(longitude) - radians(user_lon)) +
      sin(radians(user_lat)) * sin(radians(latitude))
    )
  ) asc;
$$;
