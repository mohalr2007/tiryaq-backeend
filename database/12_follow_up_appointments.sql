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
