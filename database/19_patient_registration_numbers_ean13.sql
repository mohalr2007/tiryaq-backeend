-- =========================================================
-- 19_patient_registration_numbers_ean13.sql
-- Aligne la clé patient sur un calcul EAN-13 standard
-- (12 chiffres de base + 1 chiffre de contrôle modulo 10)
-- =========================================================

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

update public.profiles
set patient_registration_number =
  left(regexp_replace(patient_registration_number, '\D', '', 'g'), 12) ||
  public.compute_patient_registration_check_digit(left(regexp_replace(patient_registration_number, '\D', '', 'g'), 12))
where account_type = 'patient'
  and patient_registration_number is not null
  and regexp_replace(patient_registration_number, '\D', '', 'g') ~ '^\d{13}$'
  and not public.is_valid_patient_registration_number(patient_registration_number);

do $$
begin
  if to_regclass('public.medical_dossiers') is not null then
    update public.medical_dossiers
    set patient_registration_number =
      left(regexp_replace(patient_registration_number, '\D', '', 'g'), 12) ||
      public.compute_patient_registration_check_digit(left(regexp_replace(patient_registration_number, '\D', '', 'g'), 12))
    where patient_registration_number is not null
      and regexp_replace(patient_registration_number, '\D', '', 'g') ~ '^\d{13}$'
      and not public.is_valid_patient_registration_number(patient_registration_number);
  end if;
end $$;

notify pgrst, 'reload schema';
