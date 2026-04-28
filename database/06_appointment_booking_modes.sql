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
