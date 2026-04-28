-- =========================================================
-- 20_admin_doctor_verification_request_columns.sql
-- Complète les colonnes manquantes pour les projets admin
-- déjà initialisés avec une ancienne version du schéma
-- =========================================================

alter table public.admin_doctor_verifications
add column if not exists request_message text,
add column if not exists requested_at timestamp with time zone,
add column if not exists submitted_by_site_user_id text,
add column if not exists verified_by_admin_user_id text references public.admin_users(id) on delete set null,
add column if not exists verified_by_admin_label text,
add column if not exists verified_at timestamp with time zone,
add column if not exists created_at timestamp with time zone not null default now(),
add column if not exists updated_at timestamp with time zone not null default now();

notify pgrst, 'reload schema';
