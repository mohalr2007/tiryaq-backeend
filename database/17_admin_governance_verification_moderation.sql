-- =========================================================
-- 17_admin_governance_verification_moderation.sql
-- Gouvernance site: validation docteur + sanctions utilisateurs
-- =========================================================

alter table public.profiles
add column if not exists doctor_verification_status text,
add column if not exists is_doctor_verified boolean not null default false,
add column if not exists doctor_verification_note text,
add column if not exists doctor_verification_requested_at timestamp with time zone,
add column if not exists doctor_verification_decided_at timestamp with time zone,
add column if not exists doctor_verification_admin_label text,
add column if not exists moderation_status text not null default 'active',
add column if not exists moderation_reason text,
add column if not exists moderation_updated_at timestamp with time zone;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_doctor_verification_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_doctor_verification_status_check
      check (
        doctor_verification_status is null
        or doctor_verification_status in ('pending', 'approved', 'rejected')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_moderation_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_moderation_status_check
      check (
        moderation_status in ('active', 'warned', 'temporarily_blocked', 'permanently_blocked')
      );
  end if;
end $$;

create or replace function public.sync_profile_governance_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.account_type = 'doctor' then
    new.doctor_verification_status := coalesce(new.doctor_verification_status, 'pending');
    if new.doctor_verification_status = 'approved' then
      new.is_doctor_verified := true;
    else
      new.is_doctor_verified := false;
    end if;
  else
    new.doctor_verification_status := null;
    new.is_doctor_verified := false;
    new.doctor_verification_note := null;
    new.doctor_verification_requested_at := null;
    new.doctor_verification_decided_at := null;
    new.doctor_verification_admin_label := null;
  end if;

  new.moderation_status := coalesce(new.moderation_status, 'active');
  return new;
end;
$$;

drop trigger if exists trg_profiles_governance_defaults on public.profiles;
create trigger trg_profiles_governance_defaults
before insert or update on public.profiles
for each row
execute function public.sync_profile_governance_defaults();

update public.profiles
set
  doctor_verification_status = case
    when account_type = 'doctor' then coalesce(doctor_verification_status, 'pending')
    else null
  end,
  is_doctor_verified = case
    when account_type = 'doctor' and doctor_verification_status = 'approved' then true
    else false
  end,
  moderation_status = coalesce(moderation_status, 'active')
where
  doctor_verification_status is null
  or moderation_status is null
  or (account_type = 'doctor' and is_doctor_verified is distinct from (doctor_verification_status = 'approved'));

create index if not exists idx_profiles_doctor_verification_status
  on public.profiles (account_type, doctor_verification_status);

create index if not exists idx_profiles_moderation_status
  on public.profiles (moderation_status);

create table if not exists public.blocked_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'blocked' check (status in ('blocked', 'released')),
  reason text,
  handled_by_admin_label text,
  blocked_at timestamp with time zone not null default timezone('utc'::text, now()),
  released_at timestamp with time zone,
  release_note text
);

create index if not exists idx_blocked_emails_status
  on public.blocked_emails (status, blocked_at desc);

create table if not exists public.user_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid references public.profiles(id) on delete set null,
  target_email text,
  report_type text not null check (report_type in ('community_post_report', 'community_comment_report', 'manual')),
  report_id uuid,
  action_type text not null check (action_type in ('warning', 'temporary_block', 'permanent_block', 'dismissed', 'false_alert', 'email_released', 'email_blocked')),
  reason text,
  admin_actor_label text not null,
  expires_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_user_moderation_actions_target_created
  on public.user_moderation_actions (target_user_id, created_at desc);

create index if not exists idx_user_moderation_actions_report
  on public.user_moderation_actions (report_type, report_id);

alter table public.blocked_emails enable row level security;
alter table public.user_moderation_actions enable row level security;

drop policy if exists "Admins can manage blocked emails" on public.blocked_emails;
create policy "Admins can manage blocked emails"
on public.blocked_emails
for all
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can read moderation actions" on public.user_moderation_actions;
create policy "Admins can read moderation actions"
on public.user_moderation_actions
for select
using (public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can insert moderation actions" on public.user_moderation_actions;
create policy "Admins can insert moderation actions"
on public.user_moderation_actions
for insert
with check (public.is_platform_admin(auth.uid()));
