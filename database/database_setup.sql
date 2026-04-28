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
