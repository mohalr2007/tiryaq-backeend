-- =========================================================
-- 21_standalone_prescriptions.sql
-- Ordonnances libres créées par le docteur, avec lien
-- optionnel vers un dossier médical existant
-- =========================================================

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
