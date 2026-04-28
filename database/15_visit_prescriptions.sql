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
