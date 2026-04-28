-- =========================================================
-- 13_doctor_contact_channels.sql
-- Coordonnees publiques et reseaux sociaux des docteurs
-- =========================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Table public.profiles introuvable. Exécutez database_setup.sql puis 02_database_extensions.sql avant ce script.';
  end if;
end $$;

alter table public.profiles
add column if not exists contact_phone text,
add column if not exists contact_phone_enabled boolean not null default false,
add column if not exists contact_email text,
add column if not exists contact_email_enabled boolean not null default false,
add column if not exists facebook_url text,
add column if not exists facebook_enabled boolean not null default false,
add column if not exists instagram_url text,
add column if not exists instagram_enabled boolean not null default false,
add column if not exists x_url text,
add column if not exists x_enabled boolean not null default false,
add column if not exists whatsapp_url text,
add column if not exists whatsapp_enabled boolean not null default false,
add column if not exists telegram_url text,
add column if not exists telegram_enabled boolean not null default false,
add column if not exists linkedin_url text,
add column if not exists linkedin_enabled boolean not null default false,
add column if not exists gmail_url text,
add column if not exists gmail_enabled boolean not null default false;

comment on column public.profiles.contact_phone is 'Numéro public du docteur visible côté patient si activé.';
comment on column public.profiles.contact_email is 'Email public du docteur visible côté patient si activé.';
comment on column public.profiles.facebook_url is 'Lien Facebook public du docteur.';
comment on column public.profiles.instagram_url is 'Lien Instagram public du docteur.';
comment on column public.profiles.x_url is 'Lien X / Twitter public du docteur.';
comment on column public.profiles.whatsapp_url is 'Numéro ou lien WhatsApp public du docteur.';
comment on column public.profiles.telegram_url is 'Lien Telegram public du docteur.';
comment on column public.profiles.linkedin_url is 'Lien LinkedIn public du docteur.';
comment on column public.profiles.gmail_url is 'Email ou lien Gmail public du docteur.';

notify pgrst, 'reload schema';
