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
