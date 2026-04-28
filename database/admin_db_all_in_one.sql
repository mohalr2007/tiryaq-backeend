-- =========================================================
-- admin_page_external_db.sql
-- Base independante pour le portail admin
-- =========================================================

create extension if not exists pgcrypto;

create table if not exists admin_users (
  id text primary key,
  username text not null unique,
  full_name text,
  password_hash text not null,
  role text not null default 'admin' check (role in ('super_admin', 'admin')),
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  last_login_at timestamp with time zone
);

create table if not exists admin_activity_logs (
  id bigserial primary key,
  admin_user_id text references admin_users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists admin_doctor_verifications (
  doctor_id text primary key,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'approved', 'rejected')),
  is_doctor_verified boolean not null default false,
  verification_note text,
  request_message text,
  requested_at timestamp with time zone,
  submitted_by_site_user_id text,
  verified_by_admin_user_id text references admin_users(id) on delete set null,
  verified_by_admin_label text,
  verified_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.admin_doctor_verifications
add column if not exists request_message text,
add column if not exists requested_at timestamp with time zone,
add column if not exists submitted_by_site_user_id text,
add column if not exists verified_by_admin_user_id text references admin_users(id) on delete set null,
add column if not exists verified_by_admin_label text,
add column if not exists verified_at timestamp with time zone,
add column if not exists created_at timestamp with time zone not null default now(),
add column if not exists updated_at timestamp with time zone not null default now();

create table if not exists admin_doctor_verification_files (
  id uuid primary key default gen_random_uuid(),
  doctor_id text not null,
  document_type text not null check (document_type in ('clinic_document', 'medical_certificate', 'other')),
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  storage_bucket text not null default 'doctor-verification-files',
  storage_path text not null,
  uploaded_by_site_user_id text not null,
  uploaded_at timestamp with time zone not null default now(),
  is_active boolean not null default true
);

create index if not exists idx_admin_users_username
  on admin_users (lower(username));

create index if not exists idx_admin_activity_logs_admin_created
  on admin_activity_logs (admin_user_id, created_at desc);

create index if not exists idx_admin_doctor_verifications_status
  on admin_doctor_verifications (verification_status, updated_at desc);

create index if not exists idx_admin_doctor_verification_files_doctor
  on admin_doctor_verification_files (doctor_id, uploaded_at desc);

create index if not exists idx_admin_doctor_verification_files_active
  on admin_doctor_verification_files (doctor_id, is_active);

comment on table admin_doctor_verification_files is
  'Documents justificatifs envoyés par les docteurs (papier clinique, certificat médical, autres preuves).';

comment on table admin_users is
  'Utilisateurs de la base admin indépendante, séparée de la base principale du site.';

comment on table admin_activity_logs is
  'Journal des actions effectuées depuis le portail admin indépendant.';

comment on table admin_doctor_verifications is
  'Validation des docteurs du site stockée dans la base admin indépendante.';

do $$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'doctor-verification-files',
      'doctor-verification-files',
      false,
      15728640,
      array[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/jpg'
      ]
    )
    on conflict (id) do nothing;
  end if;
end $$;
