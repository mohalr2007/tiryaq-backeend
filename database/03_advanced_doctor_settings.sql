-- [MODIFICATION PAR LARABI]
-- 1. Ajout des nouveaux champs métier (Genre, Congés, Configuration Avancée des RDV)

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS gender text check (gender in ('Homme', 'Femme')),
ADD COLUMN IF NOT EXISTS avatar_url text,
ADD COLUMN IF NOT EXISTS is_accepting_appointments boolean default true,
ADD COLUMN IF NOT EXISTS appointment_duration_minutes integer default 30,
ADD COLUMN IF NOT EXISTS max_appointments_per_day integer default null,
ADD COLUMN IF NOT EXISTS vacation_start date default null,
ADD COLUMN IF NOT EXISTS vacation_end date default null,
ADD COLUMN IF NOT EXISTS is_on_vacation boolean default false;

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

update public.profiles
set is_on_vacation = false
where is_on_vacation is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_max_appointments_per_day_positive'
  ) then
    alter table public.profiles
      add constraint profiles_max_appointments_per_day_positive
      check (max_appointments_per_day is null or max_appointments_per_day > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_vacation_range_valid'
  ) then
    alter table public.profiles
      add constraint profiles_vacation_range_valid
      check (
        vacation_start is null
        or vacation_end is null
        or vacation_end >= vacation_start
      );
  end if;
end $$;

-- 2. Système de notation réel (1 avis par rendez-vous terminé)
alter table public.reviews
add column if not exists appointment_id uuid references public.appointments(id) on delete cascade;

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

create or replace view public.doctor_ratings as
select
  doctor_id,
  round(avg(rating)::numeric, 1) as avg_rating,
  count(*)::int as total_reviews
from public.reviews
group by doctor_id;

-- Mise à jour de la fonction de recherche de proximité pour retourner aussi ces paramètres
-- (La fonction existedéjà, on s'assure juste que le select * fonctionne avec la vue)

-- Création d'une fonction pour récupérer les créneaux disponibles d'un docteur (Optionnel, utile pour des requêtes avancées)
-- mais tout sera géré en JS côté Front.
