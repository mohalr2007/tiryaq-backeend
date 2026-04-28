-- =========================================================
-- 14_patient_registration_numbers.sql
-- Immatriculation patient sur 13 chiffres
-- Structure:
--   1-6   = date d'attribution en AAMMJJ (fuseau Afrique/Alger)
--   7-12  = serie technique sequentielle sur 6 chiffres
--   13    = cle de verification calculee avec l'algorithme EAN-13
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
  expected_check_digit integer;
begin
  if clean_value !~ '^\d{13}$' then
    return false;
  end if;

  for index_value in 1..12 loop
    digit_value := substring(clean_value from index_value for 1)::integer;
    if mod(index_value, 2) = 0 then
      sum_value := sum_value + (digit_value * 3);
    else
      sum_value := sum_value + digit_value;
    end if;
  end loop;

  expected_check_digit := mod(10 - mod(sum_value, 10), 10);
  return expected_check_digit = substring(clean_value from 13 for 1)::integer;
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
    if mod(index_value, 2) = 0 then
      sum_value := sum_value + (digit_value * 3);
    else
      sum_value := sum_value + digit_value;
    end if;
  end loop;

  return mod(10 - mod(sum_value, 10), 10)::text;
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
