-- ===== database_setup.sql =====
-- Créer une table publique pour les profils utilisateurs
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text,
  account_type text check (account_type in ('patient', 'doctor')),
  specialty text,
  license_number text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Activer Row Level Security (RLS)
alter table public.profiles enable row level security;

-- Créer des politiques (policies) pour la table profiles
-- Les utilisateurs peuvent lire tous les profils (ou seulement le leur, selon le besoin)
drop policy if exists "Les utilisateurs peuvent lire tous les profils" on public.profiles;
create policy "Les utilisateurs peuvent lire tous les profils" on public.profiles
  for select using ( true );

-- Seul l'utilisateur concerné peut modifier son propre profil
drop policy if exists "Les utilisateurs peuvent modifier leur propre profil" on public.profiles;
create policy "Les utilisateurs peuvent modifier leur propre profil" on public.profiles
  for update using ( auth.uid() = id );

-- made by mohamed - added UPSERT logic to handle updates after Google OAuth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, account_type, specialty, license_number)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'account_type',
    new.raw_user_meta_data->>'specialty',
    new.raw_user_meta_data->>'license_number'
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    account_type = excluded.account_type,
    specialty = excluded.specialty,
    license_number = excluded.license_number;
  return new;
end;
$$;

-- Créer le trigger qui appelle la fonction (s'il n'existe pas déjà)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute procedure public.handle_new_user();
-- made by mohamed


-- ===== 02_database_extensions.sql =====
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


-- ===== 03_advanced_doctor_settings.sql =====
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


-- ===== 04_working_hours.sql =====
-- [MODIFICATION PAR LARABI]
-- 1. Ajout de la gestion des heures de travail
-- par défaut le docteur gère 08:00 à 17:00.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS working_hours_start time default '08:00',
ADD COLUMN IF NOT EXISTS working_hours_end time default '17:00';


-- ===== 05_community_publications.sql =====
-- =========================================================
-- 05_community_publications.sql
-- Système Communauté: publications, likes, commentaires, enregistrements
-- Script indépendant (peut être exécuté séparément)
-- =========================================================

-- 1) Publications docteurs
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  category text not null default 'conseil' check (category in ('conseil', 'maladie')),
  title text not null,
  content text not null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_community_posts_doctor_created_at
  on public.community_posts (doctor_id, created_at desc);

create index if not exists idx_community_posts_created_at
  on public.community_posts (created_at desc);

-- 2) Images des publications (max 10 images par publication)
create table if not exists public.community_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  image_url text not null,
  sort_order integer not null check (sort_order between 0 and 9),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (post_id, sort_order)
);

create index if not exists idx_community_post_images_post_sort
  on public.community_post_images (post_id, sort_order);

-- 3) Likes
create table if not exists public.community_post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (post_id, user_id)
);

create index if not exists idx_community_post_likes_post
  on public.community_post_likes (post_id);

create index if not exists idx_community_post_likes_user
  on public.community_post_likes (user_id);

-- 4) Commentaires
create table if not exists public.community_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(trim(content)) > 0),
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_community_post_comments_post_created
  on public.community_post_comments (post_id, created_at desc);

create index if not exists idx_community_post_comments_user
  on public.community_post_comments (user_id);

-- 5) Enregistrements (Saved posts)
create table if not exists public.community_post_saves (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (post_id, user_id)
);

create index if not exists idx_community_post_saves_post
  on public.community_post_saves (post_id);

create index if not exists idx_community_post_saves_user
  on public.community_post_saves (user_id);

-- 6) Trigger de mise à jour "updated_at" des publications
create or replace function public.set_updated_at_community_posts()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_community_posts_updated_at on public.community_posts;
create trigger trg_community_posts_updated_at
before update on public.community_posts
for each row execute function public.set_updated_at_community_posts();

-- 7) RLS
alter table public.community_posts enable row level security;
alter table public.community_post_images enable row level security;
alter table public.community_post_likes enable row level security;
alter table public.community_post_comments enable row level security;
alter table public.community_post_saves enable row level security;

-- community_posts
drop policy if exists "Community posts are visible to everyone" on public.community_posts;
drop policy if exists "Community posts are visible unless hidden" on public.community_posts;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'community_posts'
      and column_name = 'is_hidden'
  ) then
    execute $policy$
      create policy "Community posts are visible unless hidden"
      on public.community_posts
      for select
      using ((not is_hidden) or public.is_platform_admin(auth.uid()))
    $policy$;
  else
    execute $policy$
      create policy "Community posts are visible to everyone"
      on public.community_posts
      for select
      using (true)
    $policy$;
  end if;
end $$;

drop policy if exists "Doctors can insert their own community posts" on public.community_posts;
create policy "Doctors can insert their own community posts"
on public.community_posts
for insert
with check (
  auth.uid() = doctor_id
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_type = 'doctor'
  )
);

drop policy if exists "Doctors can update their own community posts" on public.community_posts;
create policy "Doctors can update their own community posts"
on public.community_posts
for update
using (auth.uid() = doctor_id)
with check (auth.uid() = doctor_id);

drop policy if exists "Doctors can delete their own community posts" on public.community_posts;
create policy "Doctors can delete their own community posts"
on public.community_posts
for delete
using (auth.uid() = doctor_id);

-- community_post_images
drop policy if exists "Community images are visible to everyone" on public.community_post_images;
create policy "Community images are visible to everyone"
on public.community_post_images
for select
using (true);

drop policy if exists "Doctors can insert images for their own posts" on public.community_post_images;
create policy "Doctors can insert images for their own posts"
on public.community_post_images
for insert
with check (
  exists (
    select 1
    from public.community_posts p
    where p.id = post_id
      and p.doctor_id = auth.uid()
  )
);

drop policy if exists "Doctors can delete images for their own posts" on public.community_post_images;
create policy "Doctors can delete images for their own posts"
on public.community_post_images
for delete
using (
  exists (
    select 1
    from public.community_posts p
    where p.id = post_id
      and p.doctor_id = auth.uid()
  )
);

-- community_post_likes
drop policy if exists "Community likes are visible to everyone" on public.community_post_likes;
create policy "Community likes are visible to everyone"
on public.community_post_likes
for select
using (true);

drop policy if exists "Users can like posts with their own identity" on public.community_post_likes;
create policy "Users can like posts with their own identity"
on public.community_post_likes
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can unlike their own likes" on public.community_post_likes;
create policy "Users can unlike their own likes"
on public.community_post_likes
for delete
using (auth.uid() = user_id);

-- community_post_comments
drop policy if exists "Community comments are visible to everyone" on public.community_post_comments;
drop policy if exists "Community comments are visible unless hidden" on public.community_post_comments;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'community_post_comments'
      and column_name = 'is_hidden'
  ) then
    execute $policy$
      create policy "Community comments are visible unless hidden"
      on public.community_post_comments
      for select
      using ((not is_hidden) or public.is_platform_admin(auth.uid()))
    $policy$;
  else
    execute $policy$
      create policy "Community comments are visible to everyone"
      on public.community_post_comments
      for select
      using (true)
    $policy$;
  end if;
end $$;

drop policy if exists "Users can comment with their own identity" on public.community_post_comments;
create policy "Users can comment with their own identity"
on public.community_post_comments
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own comments" on public.community_post_comments;
create policy "Users can update their own comments"
on public.community_post_comments
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own comments" on public.community_post_comments;
create policy "Users can delete their own comments"
on public.community_post_comments
for delete
using (auth.uid() = user_id);

-- community_post_saves
drop policy if exists "Community saves are visible to everyone" on public.community_post_saves;
create policy "Community saves are visible to everyone"
on public.community_post_saves
for select
using (true);

drop policy if exists "Users can save posts with their own identity" on public.community_post_saves;
create policy "Users can save posts with their own identity"
on public.community_post_saves
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can unsave their own posts" on public.community_post_saves;
create policy "Users can unsave their own posts"
on public.community_post_saves
for delete
using (auth.uid() = user_id);

-- 8) Vue de stats agrégées (pour affichage rapide du feed)
drop view if exists public.community_posts_stats;

do $$
begin
  if to_regclass('public.community_post_views') is not null then
    execute $view$
      create view public.community_posts_stats as
      select
        p.id as post_id,
        coalesce(l.likes_count, 0)::int as likes_count,
        coalesce(c.comments_count, 0)::int as comments_count,
        coalesce(s.saves_count, 0)::int as saves_count,
        coalesce(v.views_count, 0)::int as views_count,
        coalesce(i.images_count, 0)::int as images_count
      from public.community_posts p
      left join (
        select post_id, count(*) as likes_count
        from public.community_post_likes
        group by post_id
      ) l on l.post_id = p.id
      left join (
        select post_id, count(*) as comments_count
        from public.community_post_comments
        group by post_id
      ) c on c.post_id = p.id
      left join (
        select post_id, count(*) as saves_count
        from public.community_post_saves
        group by post_id
      ) s on s.post_id = p.id
      left join (
        select post_id, count(*) as views_count
        from public.community_post_views
        group by post_id
      ) v on v.post_id = p.id
      left join (
        select post_id, count(*) as images_count
        from public.community_post_images
        group by post_id
      ) i on i.post_id = p.id
    $view$;
  else
    execute $view$
      create view public.community_posts_stats as
      select
        p.id as post_id,
        coalesce(l.likes_count, 0)::int as likes_count,
        coalesce(c.comments_count, 0)::int as comments_count,
        coalesce(s.saves_count, 0)::int as saves_count,
        coalesce(i.images_count, 0)::int as images_count
      from public.community_posts p
      left join (
        select post_id, count(*) as likes_count
        from public.community_post_likes
        group by post_id
      ) l on l.post_id = p.id
      left join (
        select post_id, count(*) as comments_count
        from public.community_post_comments
        group by post_id
      ) c on c.post_id = p.id
      left join (
        select post_id, count(*) as saves_count
        from public.community_post_saves
        group by post_id
      ) s on s.post_id = p.id
      left join (
        select post_id, count(*) as images_count
        from public.community_post_images
        group by post_id
      ) i on i.post_id = p.id
    $view$;
  end if;
end $$;

-- 9) Bucket et policies storage pour les images communauté
do $$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'community-posts',
      'community-posts',
      true,
      10485760,
      array['image/png', 'image/jpeg', 'image/webp', 'image/jpg']
    )
    on conflict (id) do nothing;
  end if;
end
$$;

do $$
begin
  if to_regnamespace('storage') is not null then
    execute 'drop policy if exists "Community images are publicly readable" on storage.objects';
    execute 'create policy "Community images are publicly readable" on storage.objects for select using (bucket_id = ''community-posts'')';

    execute 'drop policy if exists "Doctors can upload their own community images" on storage.objects';
    execute 'create policy "Doctors can upload their own community images" on storage.objects for insert with check (bucket_id = ''community-posts'' and auth.uid()::text = (storage.foldername(name))[1])';

    execute 'drop policy if exists "Doctors can delete their own community images" on storage.objects';
    execute 'create policy "Doctors can delete their own community images" on storage.objects for delete using (bucket_id = ''community-posts'' and auth.uid()::text = (storage.foldername(name))[1])';
  end if;
end
$$;


-- ===== 06_appointment_booking_modes.sql =====
-- =========================================================
-- 06_appointment_booking_modes.sql
-- Modes de réservation RDV (patient/docteur)
-- =========================================================

-- 1) Paramètre de mode au niveau du profil docteur
alter table public.profiles
add column if not exists appointment_booking_mode text;

update public.profiles
set appointment_booking_mode = 'patient_datetime'
where appointment_booking_mode is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_appointment_booking_mode_valid'
  ) then
    alter table public.profiles
      add constraint profiles_appointment_booking_mode_valid
      check (appointment_booking_mode in ('patient_datetime', 'patient_date_only', 'doctor_datetime'));
  end if;
end $$;

alter table public.profiles
alter column appointment_booking_mode set default 'patient_datetime';

-- 2) Snapshot du mode et préférences dans les rendez-vous
alter table public.appointments
add column if not exists booking_selection_mode text,
add column if not exists requested_date date,
add column if not exists requested_time time;

update public.appointments
set booking_selection_mode = 'patient_datetime'
where booking_selection_mode is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_booking_selection_mode_valid'
  ) then
    alter table public.appointments
      add constraint appointments_booking_selection_mode_valid
      check (booking_selection_mode in ('patient_datetime', 'patient_date_only', 'doctor_datetime'));
  end if;
end $$;

alter table public.appointments
alter column booking_selection_mode set default 'patient_datetime';

update public.appointments
set requested_date = coalesce(requested_date, (appointment_date at time zone 'utc')::date)
where appointment_date is not null;

update public.appointments
set requested_time = coalesce(requested_time, (appointment_date at time zone 'utc')::time)
where appointment_date is not null
  and booking_selection_mode = 'patient_datetime';

create index if not exists idx_appointments_doctor_status_mode
  on public.appointments (doctor_id, status, booking_selection_mode);


-- ===== 07_moderation_observability.sql =====
-- =========================================================
-- 07_moderation_observability.sql
-- Modération communauté + journaux d'audit + métriques perf
-- =========================================================

-- 1) Flag admin plateforme
alter table public.profiles
add column if not exists is_platform_admin boolean not null default false;

create or replace function public.is_platform_admin(_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_platform_admin
    from public.profiles p
    where p.id = _user_id
  ), false);
$$;

-- 2) Masquage modération: posts/comments
alter table public.community_posts
add column if not exists is_hidden boolean not null default false,
add column if not exists hidden_reason text,
add column if not exists hidden_at timestamp with time zone,
add column if not exists hidden_by uuid references public.profiles(id) on delete set null;

alter table public.community_post_comments
add column if not exists is_hidden boolean not null default false,
add column if not exists hidden_reason text,
add column if not exists hidden_at timestamp with time zone,
add column if not exists hidden_by uuid references public.profiles(id) on delete set null;

drop policy if exists "Community posts are visible to everyone" on public.community_posts;
drop policy if exists "Community posts are visible unless hidden" on public.community_posts;
create policy "Community posts are visible unless hidden"
on public.community_posts
for select
using ((not is_hidden) or public.is_platform_admin(auth.uid()));

drop policy if exists "Community comments are visible to everyone" on public.community_post_comments;
drop policy if exists "Community comments are visible unless hidden" on public.community_post_comments;
create policy "Community comments are visible unless hidden"
on public.community_post_comments
for select
using ((not is_hidden) or public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can moderate community posts" on public.community_posts;
create policy "Admins can moderate community posts"
on public.community_posts
for update
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can moderate community comments" on public.community_post_comments;
create policy "Admins can moderate community comments"
on public.community_post_comments
for update
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

-- 3) Signalements
create table if not exists public.community_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (post_id, reporter_id)
);

create table if not exists public.community_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.community_post_comments(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (comment_id, reporter_id)
);

create index if not exists idx_post_reports_status_created
  on public.community_post_reports (status, created_at desc);

create index if not exists idx_comment_reports_status_created
  on public.community_comment_reports (status, created_at desc);

alter table public.community_post_reports enable row level security;
alter table public.community_comment_reports enable row level security;

drop policy if exists "Users can create post reports" on public.community_post_reports;
create policy "Users can create post reports"
on public.community_post_reports
for insert
to authenticated
with check (auth.uid() = reporter_id);

drop policy if exists "Users can view own post reports or admin all" on public.community_post_reports;
create policy "Users can view own post reports or admin all"
on public.community_post_reports
for select
using ((auth.uid() = reporter_id) or public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can review post reports" on public.community_post_reports;
create policy "Admins can review post reports"
on public.community_post_reports
for update
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

drop policy if exists "Users can create comment reports" on public.community_comment_reports;
create policy "Users can create comment reports"
on public.community_comment_reports
for insert
to authenticated
with check (auth.uid() = reporter_id);

drop policy if exists "Users can view own comment reports or admin all" on public.community_comment_reports;
create policy "Users can view own comment reports or admin all"
on public.community_comment_reports
for select
using ((auth.uid() = reporter_id) or public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can review comment reports" on public.community_comment_reports;
create policy "Admins can review comment reports"
on public.community_comment_reports
for update
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

-- 4) Journal d'audit (actions sensibles)
create table if not exists public.system_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_system_audit_logs_created
  on public.system_audit_logs (created_at desc);

create index if not exists idx_system_audit_logs_actor_created
  on public.system_audit_logs (actor_id, created_at desc);

alter table public.system_audit_logs enable row level security;

drop policy if exists "Authenticated users can insert own audit logs" on public.system_audit_logs;
create policy "Authenticated users can insert own audit logs"
on public.system_audit_logs
for insert
to authenticated
with check (actor_id is null or auth.uid() = actor_id);

drop policy if exists "Admins can read audit logs" on public.system_audit_logs;
create policy "Admins can read audit logs"
on public.system_audit_logs
for select
using (public.is_platform_admin(auth.uid()));

-- 5) Mesures de performance côté client
create table if not exists public.performance_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  page_key text not null,
  metric_name text not null,
  metric_ms numeric(10, 2) not null check (metric_ms >= 0),
  context jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_performance_events_page_metric_created
  on public.performance_events (page_key, metric_name, created_at desc);

alter table public.performance_events enable row level security;

drop policy if exists "Clients can insert performance events" on public.performance_events;
create policy "Clients can insert performance events"
on public.performance_events
for insert
with check (actor_id is null or auth.uid() = actor_id);

drop policy if exists "Admins can read performance events" on public.performance_events;
create policy "Admins can read performance events"
on public.performance_events
for select
using (public.is_platform_admin(auth.uid()));


-- ===== 08_bootstrap_test_env.sql =====
-- =========================================================
-- 08_bootstrap_test_env.sql
-- Prépare un contexte de test réel pour les checks RLS
-- =========================================================

do $$
declare
  v_reporter_id uuid;
  v_other_profile_id uuid;
  v_doctor_id uuid;
  v_post_id uuid;
  v_comment_id uuid;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Table public.profiles introuvable. Exécutez database_setup.sql.';
  end if;

  if to_regclass('public.community_posts') is null
     or to_regclass('public.community_post_comments') is null then
    raise exception 'Tables communauté introuvables. Exécutez 05_community_publications.sql.';
  end if;

  if to_regclass('public.community_post_reports') is null
     or to_regclass('public.system_audit_logs') is null
     or to_regclass('public.performance_events') is null then
    raise exception 'Tables de modération/observabilité introuvables. Exécutez 07_moderation_observability.sql.';
  end if;

  select p.id
  into v_reporter_id
  from public.profiles p
  where coalesce(p.is_platform_admin, false) = false
  order by p.created_at asc
  limit 1;

  if v_reporter_id is null then
    select p.id
    into v_reporter_id
    from public.profiles p
    order by p.created_at asc
    limit 1;
  end if;

  select p.id
  into v_other_profile_id
  from public.profiles p
  where p.id <> v_reporter_id
  order by p.created_at asc
  limit 1;

  if v_reporter_id is null or v_other_profile_id is null then
    raise exception 'Il faut au moins 2 profils utilisateurs dans public.profiles pour les tests RLS.';
  end if;

  select p.id
  into v_doctor_id
  from public.profiles p
  where p.account_type = 'doctor'
  order by p.created_at asc
  limit 1;

  if v_doctor_id is null then
    v_doctor_id := v_reporter_id;
    raise notice 'Aucun docteur trouvé: utilisation du profil % pour créer le post de test.', v_doctor_id;
  end if;

  select cp.id
  into v_post_id
  from public.community_posts cp
  where cp.title = '[RLS_TEST] Post de référence'
  limit 1;

  if v_post_id is null then
    insert into public.community_posts (doctor_id, category, title, content)
    values (v_doctor_id, 'conseil', '[RLS_TEST] Post de référence', 'Post généré automatiquement pour les tests RLS.')
    returning id into v_post_id;
  end if;

  select cc.id
  into v_comment_id
  from public.community_post_comments cc
  where cc.post_id = v_post_id
  order by cc.created_at asc
  limit 1;

  if v_comment_id is null then
    insert into public.community_post_comments (post_id, user_id, content)
    values (v_post_id, v_reporter_id, '[RLS_TEST] Commentaire de référence')
    returning id into v_comment_id;
  end if;

  raise notice 'Bootstrap terminé.';
  raise notice 'reporter_id       = %', v_reporter_id;
  raise notice 'other_profile_id  = %', v_other_profile_id;
  raise notice 'post_id           = %', v_post_id;
  raise notice 'comment_id        = %', v_comment_id;
end $$;


-- ===== 09_account_identity_guard.sql =====
-- =========================================================
-- 09_account_identity_guard.sql
-- Vérification du rôle déjà associé à un email
-- =========================================================

create or replace function public.find_account_by_email(_email text)
returns table (
  user_id uuid,
  email text,
  account_type text,
  full_name text,
  specialty text
)
language sql
security definer
set search_path = public, auth
stable
as $$
  select
    au.id as user_id,
    au.email::text as email,
    coalesce(p.account_type, au.raw_user_meta_data->>'account_type') as account_type,
    coalesce(p.full_name, au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name') as full_name,
    coalesce(p.specialty, au.raw_user_meta_data->>'specialty') as specialty
  from auth.users au
  left join public.profiles p on p.id = au.id
  where lower(trim(au.email)) = lower(trim(_email))
  limit 1;
$$;

grant execute on function public.find_account_by_email(text) to anon, authenticated;


-- ===== 10_auto_expire_vacations.sql =====
-- =========================================================
-- 10_auto_expire_vacations.sql
-- Désactive automatiquement le mode congé quand la date est dépassée
-- =========================================================

create or replace function public.clear_expired_doctor_vacations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  update public.profiles
  set is_on_vacation = false
  where account_type = 'doctor'
    and coalesce(is_on_vacation, false) = true
    and vacation_end is not null
    and vacation_end < current_date;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function public.clear_expired_doctor_vacations() to anon, authenticated, service_role;


-- ===== 11_community_post_views.sql =====
-- =========================================================
-- 11_community_post_views.sql
-- Statistiques de vues des publications communautaires
-- =========================================================

create table if not exists public.community_post_views (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (post_id, viewer_id)
);

create index if not exists idx_community_post_views_post
  on public.community_post_views (post_id);

create index if not exists idx_community_post_views_viewer
  on public.community_post_views (viewer_id);

alter table public.community_post_views enable row level security;

drop policy if exists "Community views are visible to everyone" on public.community_post_views;
create policy "Community views are visible to everyone"
on public.community_post_views
for select
using (true);

drop policy if exists "Users can register their own views" on public.community_post_views;
create policy "Users can register their own views"
on public.community_post_views
for insert
with check (auth.uid() = viewer_id);

drop policy if exists "Users can delete their own views" on public.community_post_views;
create policy "Users can delete their own views"
on public.community_post_views
for delete
using (auth.uid() = viewer_id);

drop policy if exists "Users can refresh their own views" on public.community_post_views;
create policy "Users can refresh their own views"
on public.community_post_views
for update
using (auth.uid() = viewer_id)
with check (auth.uid() = viewer_id);

drop view if exists public.community_posts_stats;

create view public.community_posts_stats as
select
  p.id as post_id,
  coalesce(l.likes_count, 0)::int as likes_count,
  coalesce(c.comments_count, 0)::int as comments_count,
  coalesce(s.saves_count, 0)::int as saves_count,
  coalesce(v.views_count, 0)::int as views_count,
  coalesce(i.images_count, 0)::int as images_count
from public.community_posts p
left join (
  select post_id, count(*) as likes_count
  from public.community_post_likes
  group by post_id
) l on l.post_id = p.id
left join (
  select post_id, count(*) as comments_count
  from public.community_post_comments
  group by post_id
) c on c.post_id = p.id
left join (
  select post_id, count(*) as saves_count
  from public.community_post_saves
  group by post_id
) s on s.post_id = p.id
left join (
  select post_id, count(*) as views_count
  from public.community_post_views
  group by post_id
) v on v.post_id = p.id
left join (
  select post_id, count(*) as images_count
  from public.community_post_images
  group by post_id
) i on i.post_id = p.id;


-- ===== 12_follow_up_appointments.sql =====
-- =========================================================
-- 12_follow_up_appointments.sql
-- Suivis / contrôles programmés par le docteur
-- =========================================================

do $$
begin
  if to_regclass('public.appointments') is null then
    raise exception 'Table public.appointments introuvable. Exécutez 02_database_extensions.sql puis 06_appointment_booking_modes.sql avant ce script.';
  end if;
end $$;

alter table public.appointments
add column if not exists appointment_source text,
add column if not exists follow_up_visit_id uuid,
add column if not exists follow_up_dossier_id uuid,
add column if not exists follow_up_time_pending boolean not null default false,
add column if not exists follow_up_reminder_days integer not null default 4;

update public.appointments
set appointment_source = 'patient_request'
where appointment_source is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_source_valid'
  ) then
    alter table public.appointments
      add constraint appointments_source_valid
      check (appointment_source in ('patient_request', 'doctor_follow_up'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_follow_up_reminder_days_valid'
  ) then
    alter table public.appointments
      add constraint appointments_follow_up_reminder_days_valid
      check (follow_up_reminder_days between 1 and 14);
  end if;
end $$;

alter table public.appointments
alter column appointment_source set default 'patient_request',
alter column follow_up_reminder_days set default 4;

do $$
begin
  if to_regclass('public.dossier_visits') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'appointments_follow_up_visit_id_fkey'
    ) then
    alter table public.appointments
      add constraint appointments_follow_up_visit_id_fkey
      foreign key (follow_up_visit_id)
      references public.dossier_visits(id)
      on delete set null;
  end if;

  if to_regclass('public.medical_dossiers') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'appointments_follow_up_dossier_id_fkey'
    ) then
    alter table public.appointments
      add constraint appointments_follow_up_dossier_id_fkey
      foreign key (follow_up_dossier_id)
      references public.medical_dossiers(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_appointments_doctor_follow_up_reminder
  on public.appointments (doctor_id, status, follow_up_time_pending, requested_date);

create index if not exists idx_appointments_follow_up_visit
  on public.appointments (follow_up_visit_id);

create index if not exists idx_appointments_follow_up_dossier
  on public.appointments (follow_up_dossier_id);

drop policy if exists "Les patients creent des rdv" on public.appointments;
drop policy if exists "Les patients ou medecins creent des rdv" on public.appointments;

create policy "Les patients ou medecins creent des rdv"
on public.appointments
for insert
with check (auth.uid() in (patient_id, doctor_id));

notify pgrst, 'reload schema';


-- ===== 13_doctor_contact_channels.sql =====
-- =========================================================
-- 13_doctor_contact_channels.sql
-- Coordonnees publiques et reseaux sociaux des docteurs
-- =========================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Table public.profiles introuvable. Exécutez database_setup.sql puis 02_database_extensions.sql avant ce script.';
  end if;
end $$;

alter table public.profiles
add column if not exists contact_phone text,
add column if not exists contact_phone_enabled boolean not null default false,
add column if not exists contact_email text,
add column if not exists contact_email_enabled boolean not null default false,
add column if not exists facebook_url text,
add column if not exists facebook_enabled boolean not null default false,
add column if not exists instagram_url text,
add column if not exists instagram_enabled boolean not null default false,
add column if not exists x_url text,
add column if not exists x_enabled boolean not null default false,
add column if not exists whatsapp_url text,
add column if not exists whatsapp_enabled boolean not null default false,
add column if not exists telegram_url text,
add column if not exists telegram_enabled boolean not null default false,
add column if not exists linkedin_url text,
add column if not exists linkedin_enabled boolean not null default false,
add column if not exists gmail_url text,
add column if not exists gmail_enabled boolean not null default false;

comment on column public.profiles.contact_phone is 'Numéro public du docteur visible côté patient si activé.';
comment on column public.profiles.contact_email is 'Email public du docteur visible côté patient si activé.';
comment on column public.profiles.facebook_url is 'Lien Facebook public du docteur.';
comment on column public.profiles.instagram_url is 'Lien Instagram public du docteur.';
comment on column public.profiles.x_url is 'Lien X / Twitter public du docteur.';
comment on column public.profiles.whatsapp_url is 'Numéro ou lien WhatsApp public du docteur.';
comment on column public.profiles.telegram_url is 'Lien Telegram public du docteur.';
comment on column public.profiles.linkedin_url is 'Lien LinkedIn public du docteur.';
comment on column public.profiles.gmail_url is 'Email ou lien Gmail public du docteur.';

notify pgrst, 'reload schema';


-- ===== 14_patient_registration_numbers.sql =====
-- =========================================================
-- 14_patient_registration_numbers.sql
-- Immatriculation patient sur 13 chiffres
-- Structure:
--   1-6   = date d'attribution en AAMMJJ (fuseau Afrique/Alger)
--   7-12  = serie technique sequentielle sur 6 chiffres
--   13    = cle de verification calculee selon EAN-13
-- =========================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Table public.profiles introuvable. Exécutez database_setup.sql avant ce script.';
  end if;
end $$;

alter table public.profiles
add column if not exists patient_registration_number text;

comment on column public.profiles.patient_registration_number is
  'Immatriculation patient sur 13 chiffres: 12 chiffres de codage + 1 clé de vérification.';

create sequence if not exists public.patient_registration_serial_seq;

create or replace function public.is_valid_patient_registration_number(_value text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  clean_value text := regexp_replace(coalesce(_value, ''), '\D', '', 'g');
  sum_value integer := 0;
  index_value integer;
  digit_value integer;
begin
  if clean_value !~ '^\d{13}$' then
    return false;
  end if;

  for index_value in 1..12 loop
    digit_value := substring(clean_value from index_value for 1)::integer;
    sum_value := sum_value + (digit_value * case when mod(index_value, 2) = 0 then 3 else 1 end);
  end loop;

  return ((10 - mod(sum_value, 10)) % 10) = substring(clean_value from 13 for 1)::integer;
end;
$$;

create or replace function public.compute_patient_registration_check_digit(_base12 text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  clean_base text := regexp_replace(coalesce(_base12, ''), '\D', '', 'g');
  sum_value integer := 0;
  index_value integer;
  digit_value integer;
begin
  if clean_base !~ '^\d{12}$' then
    raise exception 'La base doit contenir exactement 12 chiffres.';
  end if;

  for index_value in 1..12 loop
    digit_value := substring(clean_base from index_value for 1)::integer;
    sum_value := sum_value + (digit_value * case when mod(index_value, 2) = 0 then 3 else 1 end);
  end loop;

  return ((10 - mod(sum_value, 10)) % 10)::text;
end;
$$;

create or replace function public.generate_patient_registration_number(_assigned_at timestamp with time zone default timezone('utc'::text, now()))
returns text
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  assigned_at timestamp with time zone := coalesce(_assigned_at, timezone('utc'::text, now()));
  serial_value bigint;
  base12 text;
begin
  serial_value := nextval('public.patient_registration_serial_seq');

  base12 :=
    to_char(assigned_at at time zone 'Africa/Algiers', 'YYMMDD') ||
    right(lpad(serial_value::text, 6, '0'), 6);

  return base12 || public.compute_patient_registration_check_digit(base12);
end;
$$;

create or replace function public.ensure_patient_registration_number()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  normalized_number text := nullif(regexp_replace(coalesce(new.patient_registration_number, ''), '\D', '', 'g'), '');
begin
  if normalized_number is not null then
    new.patient_registration_number := normalized_number;
  else
    new.patient_registration_number := null;
  end if;

  if new.account_type = 'patient' then
    if new.patient_registration_number is null
      or not public.is_valid_patient_registration_number(new.patient_registration_number) then
      new.patient_registration_number := public.generate_patient_registration_number(coalesce(new.created_at, timezone('utc'::text, now())));
    end if;
  elsif new.patient_registration_number is not null
    and not public.is_valid_patient_registration_number(new.patient_registration_number) then
    new.patient_registration_number := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ensure_patient_registration_number on public.profiles;
create trigger trg_ensure_patient_registration_number
before insert or update on public.profiles
for each row
execute function public.ensure_patient_registration_number();

update public.profiles
set patient_registration_number = public.generate_patient_registration_number(created_at)
where account_type = 'patient'
  and (
    patient_registration_number is null
    or not public.is_valid_patient_registration_number(patient_registration_number)
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_patient_registration_number_valid'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_patient_registration_number_valid
      check (
        patient_registration_number is null
        or public.is_valid_patient_registration_number(patient_registration_number)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_patient_registration_number_required_for_patient'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_patient_registration_number_required_for_patient
      check (
        account_type <> 'patient'
        or patient_registration_number is not null
      );
  end if;
end $$;

create unique index if not exists idx_profiles_patient_registration_number_unique
  on public.profiles (patient_registration_number)
  where patient_registration_number is not null;

do $$
begin
  if to_regclass('public.medical_dossiers') is not null then
    execute 'alter table public.medical_dossiers add column if not exists patient_registration_number text';
    execute $sql$
      comment on column public.medical_dossiers.patient_registration_number is
        'Immatriculation patient visible côté médecin pour distinguer les homonymes.'
    $sql$;

    execute $sql$
      create or replace function public.sync_medical_dossier_registration_number()
      returns trigger
      language plpgsql
      set search_path = public
      as $body$
      declare
        linked_number text;
        normalized_number text := nullif(regexp_replace(coalesce(new.patient_registration_number, ''), '\D', '', 'g'), '');
      begin
        if new.patient_id is not null then
          select p.patient_registration_number
          into linked_number
          from public.profiles p
          where p.id = new.patient_id;

          if linked_number is not null then
            new.patient_registration_number := regexp_replace(linked_number, '\D', '', 'g');
          elsif normalized_number is not null
            and public.is_valid_patient_registration_number(normalized_number) then
            new.patient_registration_number := normalized_number;
          else
            new.patient_registration_number := public.generate_patient_registration_number(coalesce(new.created_at, timezone('utc'::text, now())));
          end if;
        else
          if normalized_number is not null
            and public.is_valid_patient_registration_number(normalized_number) then
            new.patient_registration_number := normalized_number;
          else
            new.patient_registration_number := public.generate_patient_registration_number(coalesce(new.created_at, timezone('utc'::text, now())));
          end if;
        end if;

        return new;
      end;
      $body$
    $sql$;

    execute 'drop trigger if exists trg_sync_medical_dossier_registration_number on public.medical_dossiers';
    execute $sql$
      create trigger trg_sync_medical_dossier_registration_number
      before insert or update on public.medical_dossiers
      for each row
      execute function public.sync_medical_dossier_registration_number()
    $sql$;

    execute $sql$
      update public.medical_dossiers d
      set patient_registration_number = coalesce(
        (
          select regexp_replace(p.patient_registration_number, '\D', '', 'g')
          from public.profiles p
          where p.id = d.patient_id
        ),
        public.generate_patient_registration_number(d.created_at)
      )
      where d.patient_registration_number is null
         or not public.is_valid_patient_registration_number(d.patient_registration_number)
    $sql$;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'medical_dossiers_patient_registration_number_valid'
        and conrelid = 'public.medical_dossiers'::regclass
    ) then
      execute $sql$
        alter table public.medical_dossiers
          add constraint medical_dossiers_patient_registration_number_valid
          check (
            patient_registration_number is not null
            and public.is_valid_patient_registration_number(patient_registration_number)
          )
      $sql$;
    end if;

    execute $sql$
      create index if not exists idx_medical_dossiers_doctor_patient_registration
        on public.medical_dossiers (doctor_id, patient_registration_number)
    $sql$;
  end if;
end $$;

notify pgrst, 'reload schema';


-- ===== 15_visit_prescriptions.sql =====
-- =========================================================
-- 15_visit_prescriptions.sql
-- Ordonnances structurees par visite, avec copie publique securisee
-- =========================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Table public.profiles introuvable. Exécutez database_setup.sql avant ce script.';
  end if;

  if to_regclass('public.medical_dossiers') is null then
    raise exception 'Table public.medical_dossiers introuvable. Exécutez d''abord le script de dossiers médicaux.';
  end if;

  if to_regclass('public.dossier_visits') is null then
    raise exception 'Table public.dossier_visits introuvable. Exécutez d''abord le script des consultations.';
  end if;
end $$;

create sequence if not exists public.visit_prescription_number_seq;

create or replace function public.generate_visit_prescription_number()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  serial_value bigint;
begin
  serial_value := nextval('public.visit_prescription_number_seq');
  return lpad(serial_value::text, 6, '0');
end;
$$;

create table if not exists public.visit_prescriptions (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.dossier_visits(id) on delete cascade,
  dossier_id uuid not null references public.medical_dossiers(id) on delete cascade,
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid references public.profiles(id) on delete set null,
  prescription_number text not null default public.generate_visit_prescription_number(),
  public_token text not null default replace(gen_random_uuid()::text, '-', ''),
  prescription_date date not null default ((now() at time zone 'Africa/Algiers')::date),
  patient_display_name text not null,
  doctor_display_name text not null,
  doctor_specialty text,
  doctor_address text,
  doctor_phone text,
  signature_label text,
  notes text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (visit_id),
  unique (prescription_number),
  unique (public_token)
);

create table if not exists public.visit_prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.visit_prescriptions(id) on delete cascade,
  line_number integer not null check (line_number between 1 and 20),
  medication_name text not null check (length(trim(medication_name)) > 0),
  dosage text,
  instructions text,
  duration text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (prescription_id, line_number)
);

comment on table public.visit_prescriptions is
  'Ordonnance structurée liée à une visite du dossier médical.';

comment on column public.visit_prescriptions.public_token is
  'Jeton public aléatoire utilisé dans le QR code pour ouvrir une copie sécurisée.';

comment on table public.visit_prescription_items is
  'Lignes détaillées des médicaments d''une ordonnance.';

alter table public.visit_prescriptions
add column if not exists doctor_address text,
add column if not exists doctor_phone text;

comment on column public.visit_prescriptions.doctor_address is
  'Adresse du docteur imprimée sur l''ordonnance comme snapshot historique.';

comment on column public.visit_prescriptions.doctor_phone is
  'Téléphone du docteur imprimé sur l''ordonnance comme snapshot historique.';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'address'
  ) then
    execute $sql$
      update public.visit_prescriptions vp
      set doctor_address = p.address
      from public.profiles p
      where p.id = vp.doctor_id
        and vp.doctor_address is null
        and p.address is not null
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'contact_phone'
  ) then
    execute $sql$
      update public.visit_prescriptions vp
      set doctor_phone = p.contact_phone
      from public.profiles p
      where p.id = vp.doctor_id
        and vp.doctor_phone is null
        and p.contact_phone is not null
    $sql$;
  end if;
end $$;

create index if not exists idx_visit_prescriptions_dossier_created
  on public.visit_prescriptions (dossier_id, created_at desc);

create index if not exists idx_visit_prescriptions_doctor_created
  on public.visit_prescriptions (doctor_id, created_at desc);

create index if not exists idx_visit_prescriptions_patient_created
  on public.visit_prescriptions (patient_id, created_at desc);

create index if not exists idx_visit_prescription_items_prescription_line
  on public.visit_prescription_items (prescription_id, line_number);

create or replace function public.set_updated_at_visit_prescription_entities()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_visit_prescriptions_updated_at on public.visit_prescriptions;
create trigger trg_visit_prescriptions_updated_at
before update on public.visit_prescriptions
for each row execute function public.set_updated_at_visit_prescription_entities();

drop trigger if exists trg_visit_prescription_items_updated_at on public.visit_prescription_items;
create trigger trg_visit_prescription_items_updated_at
before update on public.visit_prescription_items
for each row execute function public.set_updated_at_visit_prescription_entities();

alter table public.visit_prescriptions enable row level security;
alter table public.visit_prescription_items enable row level security;

drop policy if exists "Doctors can view their visit prescriptions" on public.visit_prescriptions;
create policy "Doctors can view their visit prescriptions"
on public.visit_prescriptions
for select
using (auth.uid() = doctor_id);

drop policy if exists "Linked patients can view their visit prescriptions" on public.visit_prescriptions;
create policy "Linked patients can view their visit prescriptions"
on public.visit_prescriptions
for select
using (patient_id is not null and auth.uid() = patient_id);

drop policy if exists "Doctors can insert their visit prescriptions" on public.visit_prescriptions;
create policy "Doctors can insert their visit prescriptions"
on public.visit_prescriptions
for insert
with check (auth.uid() = doctor_id);

drop policy if exists "Doctors can update their visit prescriptions" on public.visit_prescriptions;
create policy "Doctors can update their visit prescriptions"
on public.visit_prescriptions
for update
using (auth.uid() = doctor_id)
with check (auth.uid() = doctor_id);

drop policy if exists "Doctors can delete their visit prescriptions" on public.visit_prescriptions;
create policy "Doctors can delete their visit prescriptions"
on public.visit_prescriptions
for delete
using (auth.uid() = doctor_id);

drop policy if exists "Doctors and linked patients can view prescription items" on public.visit_prescription_items;
create policy "Doctors and linked patients can view prescription items"
on public.visit_prescription_items
for select
using (
  exists (
    select 1
    from public.visit_prescriptions p
    where p.id = prescription_id
      and (p.doctor_id = auth.uid() or (p.patient_id is not null and p.patient_id = auth.uid()))
  )
);

drop policy if exists "Doctors can insert prescription items" on public.visit_prescription_items;
create policy "Doctors can insert prescription items"
on public.visit_prescription_items
for insert
with check (
  exists (
    select 1
    from public.visit_prescriptions p
    where p.id = prescription_id
      and p.doctor_id = auth.uid()
  )
);

drop policy if exists "Doctors can update prescription items" on public.visit_prescription_items;
create policy "Doctors can update prescription items"
on public.visit_prescription_items
for update
using (
  exists (
    select 1
    from public.visit_prescriptions p
    where p.id = prescription_id
      and p.doctor_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.visit_prescriptions p
    where p.id = prescription_id
      and p.doctor_id = auth.uid()
  )
);

drop policy if exists "Doctors can delete prescription items" on public.visit_prescription_items;
create policy "Doctors can delete prescription items"
on public.visit_prescription_items
for delete
using (
  exists (
    select 1
    from public.visit_prescriptions p
    where p.id = prescription_id
      and p.doctor_id = auth.uid()
  )
);

notify pgrst, 'reload schema';


-- ===== 16_doctor_verification_admin_portal.sql =====
-- =========================================================
-- 16_doctor_verification_admin_portal.sql
-- Validation des docteurs pour le portail admin independant
-- =========================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Table public.profiles introuvable. Exécutez database_setup.sql avant ce script.';
  end if;
end $$;

alter table public.profiles
add column if not exists is_doctor_verified boolean,
add column if not exists doctor_verification_status text,
add column if not exists doctor_verified_at timestamp with time zone,
add column if not exists doctor_verified_by_admin text,
add column if not exists doctor_verification_note text;

comment on column public.profiles.is_doctor_verified is
  'Indique si le profil docteur a ete valide par le portail admin.';

comment on column public.profiles.doctor_verification_status is
  'Statut de validation du docteur: pending, approved ou rejected.';

comment on column public.profiles.doctor_verified_at is
  'Date de validation ou de revalidation du docteur.';

comment on column public.profiles.doctor_verified_by_admin is
  'Identifiant ou nom de l''admin independant qui a valide ou refuse le docteur.';

comment on column public.profiles.doctor_verification_note is
  'Note interne du portail admin independant sur la decision prise.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_doctor_verification_status_valid'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_doctor_verification_status_valid
      check (
        doctor_verification_status is null
        or doctor_verification_status in ('pending', 'approved', 'rejected')
      );
  end if;
end $$;

create or replace function public.apply_doctor_verification_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.account_type = 'doctor' then
    if new.doctor_verification_status is null then
      new.doctor_verification_status := 'pending';
    end if;

    if new.doctor_verification_status = 'approved' then
      new.is_doctor_verified := true;
      if new.doctor_verified_at is null then
        new.doctor_verified_at := coalesce(new.created_at, timezone('utc'::text, now()));
      end if;
    elsif new.doctor_verification_status = 'rejected' then
      new.is_doctor_verified := false;
      new.doctor_verified_at := null;
    else
      new.is_doctor_verified := false;
      new.doctor_verified_at := null;
      new.doctor_verified_by_admin := null;
    end if;
  else
    new.is_doctor_verified := null;
    new.doctor_verification_status := null;
    new.doctor_verified_at := null;
    new.doctor_verified_by_admin := null;
    new.doctor_verification_note := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_doctor_verification_defaults on public.profiles;
create trigger trg_apply_doctor_verification_defaults
before insert or update on public.profiles
for each row
execute function public.apply_doctor_verification_defaults();

update public.profiles
set
  is_doctor_verified = coalesce(is_doctor_verified, true),
  doctor_verification_status = coalesce(doctor_verification_status, 'approved'),
  doctor_verified_at = coalesce(doctor_verified_at, created_at, timezone('utc'::text, now())),
  doctor_verified_by_admin = coalesce(doctor_verified_by_admin, 'bootstrap'),
  doctor_verification_note = coalesce(doctor_verification_note, 'Validation automatique des docteurs existants lors de l''activation du portail admin.')
where account_type = 'doctor';

update public.profiles
set
  is_doctor_verified = null,
  doctor_verification_status = null,
  doctor_verified_at = null,
  doctor_verified_by_admin = null,
  doctor_verification_note = null
where account_type <> 'doctor';

create index if not exists idx_profiles_doctor_verification_status
  on public.profiles (doctor_verification_status)
  where account_type = 'doctor';

create index if not exists idx_profiles_doctor_verified_flag
  on public.profiles (is_doctor_verified)
  where account_type = 'doctor';

create or replace function public.get_nearby_doctors(
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
    and coalesce(doctor_verification_status, 'approved') = 'approved'
    and coalesce(is_doctor_verified, true)
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

notify pgrst, 'reload schema';


-- ===== 17_admin_governance_verification_moderation.sql =====
-- =========================================================
-- 17_admin_governance_verification_moderation.sql
-- Gouvernance site: validation docteur + sanctions utilisateurs
-- =========================================================

alter table public.profiles
add column if not exists doctor_verification_status text,
add column if not exists is_doctor_verified boolean not null default false,
add column if not exists doctor_verification_note text,
add column if not exists doctor_verification_requested_at timestamp with time zone,
add column if not exists doctor_verification_decided_at timestamp with time zone,
add column if not exists doctor_verification_admin_label text,
add column if not exists moderation_status text not null default 'active',
add column if not exists moderation_reason text,
add column if not exists moderation_updated_at timestamp with time zone;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_doctor_verification_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_doctor_verification_status_check
      check (
        doctor_verification_status is null
        or doctor_verification_status in ('pending', 'approved', 'rejected')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_moderation_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_moderation_status_check
      check (
        moderation_status in ('active', 'warned', 'temporarily_blocked', 'permanently_blocked')
      );
  end if;
end $$;

create or replace function public.sync_profile_governance_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.account_type = 'doctor' then
    new.doctor_verification_status := coalesce(new.doctor_verification_status, 'pending');
    if new.doctor_verification_status = 'approved' then
      new.is_doctor_verified := true;
    else
      new.is_doctor_verified := false;
    end if;
  else
    new.doctor_verification_status := null;
    new.is_doctor_verified := false;
    new.doctor_verification_note := null;
    new.doctor_verification_requested_at := null;
    new.doctor_verification_decided_at := null;
    new.doctor_verification_admin_label := null;
  end if;

  new.moderation_status := coalesce(new.moderation_status, 'active');
  return new;
end;
$$;

drop trigger if exists trg_profiles_governance_defaults on public.profiles;
create trigger trg_profiles_governance_defaults
before insert or update on public.profiles
for each row
execute function public.sync_profile_governance_defaults();

update public.profiles
set
  doctor_verification_status = case
    when account_type = 'doctor' then coalesce(doctor_verification_status, 'pending')
    else null
  end,
  is_doctor_verified = case
    when account_type = 'doctor' and doctor_verification_status = 'approved' then true
    else false
  end,
  moderation_status = coalesce(moderation_status, 'active')
where
  doctor_verification_status is null
  or moderation_status is null
  or (account_type = 'doctor' and is_doctor_verified is distinct from (doctor_verification_status = 'approved'));

create index if not exists idx_profiles_doctor_verification_status
  on public.profiles (account_type, doctor_verification_status);

create index if not exists idx_profiles_moderation_status
  on public.profiles (moderation_status);

create table if not exists public.blocked_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'blocked' check (status in ('blocked', 'released')),
  reason text,
  handled_by_admin_label text,
  blocked_at timestamp with time zone not null default timezone('utc'::text, now()),
  released_at timestamp with time zone,
  release_note text
);

create index if not exists idx_blocked_emails_status
  on public.blocked_emails (status, blocked_at desc);

create table if not exists public.user_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid references public.profiles(id) on delete set null,
  target_email text,
  report_type text not null check (report_type in ('community_post_report', 'community_comment_report', 'manual')),
  report_id uuid,
  action_type text not null check (action_type in ('warning', 'temporary_block', 'permanent_block', 'dismissed', 'false_alert', 'email_released', 'email_blocked')),
  reason text,
  admin_actor_label text not null,
  expires_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_user_moderation_actions_target_created
  on public.user_moderation_actions (target_user_id, created_at desc);

create index if not exists idx_user_moderation_actions_report
  on public.user_moderation_actions (report_type, report_id);

alter table public.blocked_emails enable row level security;
alter table public.user_moderation_actions enable row level security;

drop policy if exists "Admins can manage blocked emails" on public.blocked_emails;
create policy "Admins can manage blocked emails"
on public.blocked_emails
for all
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can read moderation actions" on public.user_moderation_actions;
create policy "Admins can read moderation actions"
on public.user_moderation_actions
for select
using (public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can insert moderation actions" on public.user_moderation_actions;
create policy "Admins can insert moderation actions"
on public.user_moderation_actions
for insert
with check (public.is_platform_admin(auth.uid()));


-- ===== 21_standalone_prescriptions.sql =====
-- Ordonnances libres créées par le docteur, avec lien
-- optionnel vers un dossier médical existant

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Table public.profiles introuvable. Exécutez database_setup.sql avant ce script.';
  end if;

  if to_regclass('public.medical_dossiers') is null then
    raise exception 'Table public.medical_dossiers introuvable. Exécutez d''abord le script de dossiers médicaux.';
  end if;
end $$;

create sequence if not exists public.standalone_prescription_number_seq;

create or replace function public.generate_standalone_prescription_number()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  serial_value bigint;
begin
  serial_value := nextval('public.standalone_prescription_number_seq');
  return lpad(serial_value::text, 6, '0');
end;
$$;

create table if not exists public.standalone_prescriptions (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  dossier_id uuid references public.medical_dossiers(id) on delete set null,
  patient_id uuid references public.profiles(id) on delete set null,
  patient_registration_number text,
  prescription_number text not null default public.generate_standalone_prescription_number(),
  public_token text not null default replace(gen_random_uuid()::text, '-', ''),
  prescription_date date not null default ((now() at time zone 'Africa/Algiers')::date),
  patient_display_name text not null,
  doctor_display_name text not null,
  doctor_specialty text,
  doctor_address text,
  doctor_phone text,
  signature_label text,
  notes text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (prescription_number),
  unique (public_token)
);

create table if not exists public.standalone_prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.standalone_prescriptions(id) on delete cascade,
  line_number integer not null check (line_number between 1 and 20),
  medication_name text not null check (length(trim(medication_name)) > 0),
  dosage text,
  instructions text,
  duration text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (prescription_id, line_number)
);

comment on table public.standalone_prescriptions is
  'Ordonnance libre créée hors visite, avec rattachement optionnel à un dossier médical.';

comment on table public.standalone_prescription_items is
  'Lignes détaillées des médicaments d''une ordonnance libre.';

create index if not exists idx_standalone_prescriptions_doctor_created
  on public.standalone_prescriptions (doctor_id, created_at desc);

create index if not exists idx_standalone_prescriptions_dossier_created
  on public.standalone_prescriptions (dossier_id, created_at desc);

create index if not exists idx_standalone_prescriptions_patient_created
  on public.standalone_prescriptions (patient_id, created_at desc);

create index if not exists idx_standalone_prescription_items_prescription_line
  on public.standalone_prescription_items (prescription_id, line_number);

create or replace function public.set_updated_at_standalone_prescription_entities()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_standalone_prescriptions_updated_at on public.standalone_prescriptions;
create trigger trg_standalone_prescriptions_updated_at
before update on public.standalone_prescriptions
for each row execute function public.set_updated_at_standalone_prescription_entities();

drop trigger if exists trg_standalone_prescription_items_updated_at on public.standalone_prescription_items;
create trigger trg_standalone_prescription_items_updated_at
before update on public.standalone_prescription_items
for each row execute function public.set_updated_at_standalone_prescription_entities();

alter table public.standalone_prescriptions enable row level security;
alter table public.standalone_prescription_items enable row level security;

drop policy if exists "Doctors can view their standalone prescriptions" on public.standalone_prescriptions;
create policy "Doctors can view their standalone prescriptions"
on public.standalone_prescriptions
for select
using (auth.uid() = doctor_id);

drop policy if exists "Linked patients can view their standalone prescriptions" on public.standalone_prescriptions;
create policy "Linked patients can view their standalone prescriptions"
on public.standalone_prescriptions
for select
using (patient_id is not null and auth.uid() = patient_id);

drop policy if exists "Doctors can insert their standalone prescriptions" on public.standalone_prescriptions;
create policy "Doctors can insert their standalone prescriptions"
on public.standalone_prescriptions
for insert
with check (auth.uid() = doctor_id);

drop policy if exists "Doctors can update their standalone prescriptions" on public.standalone_prescriptions;
create policy "Doctors can update their standalone prescriptions"
on public.standalone_prescriptions
for update
using (auth.uid() = doctor_id)
with check (auth.uid() = doctor_id);

drop policy if exists "Doctors can delete their standalone prescriptions" on public.standalone_prescriptions;
create policy "Doctors can delete their standalone prescriptions"
on public.standalone_prescriptions
for delete
using (auth.uid() = doctor_id);

drop policy if exists "Doctors and linked patients can view standalone prescription items" on public.standalone_prescription_items;
create policy "Doctors and linked patients can view standalone prescription items"
on public.standalone_prescription_items
for select
using (
  exists (
    select 1
    from public.standalone_prescriptions p
    where p.id = prescription_id
      and (p.doctor_id = auth.uid() or (p.patient_id is not null and p.patient_id = auth.uid()))
  )
);

drop policy if exists "Doctors can insert standalone prescription items" on public.standalone_prescription_items;
create policy "Doctors can insert standalone prescription items"
on public.standalone_prescription_items
for insert
with check (
  exists (
    select 1
    from public.standalone_prescriptions p
    where p.id = prescription_id
      and p.doctor_id = auth.uid()
  )
);

drop policy if exists "Doctors can update standalone prescription items" on public.standalone_prescription_items;
create policy "Doctors can update standalone prescription items"
on public.standalone_prescription_items
for update
using (
  exists (
    select 1
    from public.standalone_prescriptions p
    where p.id = prescription_id
      and p.doctor_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.standalone_prescriptions p
    where p.id = prescription_id
      and p.doctor_id = auth.uid()
  )
);

drop policy if exists "Doctors can delete standalone prescription items" on public.standalone_prescription_items;
create policy "Doctors can delete standalone prescription items"
on public.standalone_prescription_items
for delete
using (
  exists (
    select 1
    from public.standalone_prescriptions p
    where p.id = prescription_id
      and p.doctor_id = auth.uid()
  )
);

notify pgrst, 'reload schema';


