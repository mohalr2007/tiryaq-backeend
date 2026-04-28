-- =========================================================
-- 07_moderation_observability.sql
-- Modération communauté + journaux d'audit + métriques perf
-- =========================================================

-- 1) Flag admin plateforme
alter table public.profiles
add column if not exists is_platform_admin boolean not null default false;

create or replace function public.is_platform_admin(_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_platform_admin
    from public.profiles p
    where p.id = _user_id
  ), false);
$$;

-- 2) Masquage modération: posts/comments
alter table public.community_posts
add column if not exists is_hidden boolean not null default false,
add column if not exists hidden_reason text,
add column if not exists hidden_at timestamp with time zone,
add column if not exists hidden_by uuid references public.profiles(id) on delete set null;

alter table public.community_post_comments
add column if not exists is_hidden boolean not null default false,
add column if not exists hidden_reason text,
add column if not exists hidden_at timestamp with time zone,
add column if not exists hidden_by uuid references public.profiles(id) on delete set null;

drop policy if exists "Community posts are visible to everyone" on public.community_posts;
drop policy if exists "Community posts are visible unless hidden" on public.community_posts;
create policy "Community posts are visible unless hidden"
on public.community_posts
for select
using ((not is_hidden) or public.is_platform_admin(auth.uid()));

drop policy if exists "Community comments are visible to everyone" on public.community_post_comments;
drop policy if exists "Community comments are visible unless hidden" on public.community_post_comments;
create policy "Community comments are visible unless hidden"
on public.community_post_comments
for select
using ((not is_hidden) or public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can moderate community posts" on public.community_posts;
create policy "Admins can moderate community posts"
on public.community_posts
for update
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can moderate community comments" on public.community_post_comments;
create policy "Admins can moderate community comments"
on public.community_post_comments
for update
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

-- 3) Signalements
create table if not exists public.community_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (post_id, reporter_id)
);

create table if not exists public.community_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.community_post_comments(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (comment_id, reporter_id)
);

create index if not exists idx_post_reports_status_created
  on public.community_post_reports (status, created_at desc);

create index if not exists idx_comment_reports_status_created
  on public.community_comment_reports (status, created_at desc);

alter table public.community_post_reports enable row level security;
alter table public.community_comment_reports enable row level security;

drop policy if exists "Users can create post reports" on public.community_post_reports;
create policy "Users can create post reports"
on public.community_post_reports
for insert
to authenticated
with check (auth.uid() = reporter_id);

drop policy if exists "Users can view own post reports or admin all" on public.community_post_reports;
create policy "Users can view own post reports or admin all"
on public.community_post_reports
for select
using ((auth.uid() = reporter_id) or public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can review post reports" on public.community_post_reports;
create policy "Admins can review post reports"
on public.community_post_reports
for update
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

drop policy if exists "Users can create comment reports" on public.community_comment_reports;
create policy "Users can create comment reports"
on public.community_comment_reports
for insert
to authenticated
with check (auth.uid() = reporter_id);

drop policy if exists "Users can view own comment reports or admin all" on public.community_comment_reports;
create policy "Users can view own comment reports or admin all"
on public.community_comment_reports
for select
using ((auth.uid() = reporter_id) or public.is_platform_admin(auth.uid()));

drop policy if exists "Admins can review comment reports" on public.community_comment_reports;
create policy "Admins can review comment reports"
on public.community_comment_reports
for update
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

-- 4) Journal d'audit (actions sensibles)
create table if not exists public.system_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_system_audit_logs_created
  on public.system_audit_logs (created_at desc);

create index if not exists idx_system_audit_logs_actor_created
  on public.system_audit_logs (actor_id, created_at desc);

alter table public.system_audit_logs enable row level security;

drop policy if exists "Authenticated users can insert own audit logs" on public.system_audit_logs;
create policy "Authenticated users can insert own audit logs"
on public.system_audit_logs
for insert
to authenticated
with check (actor_id is null or auth.uid() = actor_id);

drop policy if exists "Admins can read audit logs" on public.system_audit_logs;
create policy "Admins can read audit logs"
on public.system_audit_logs
for select
using (public.is_platform_admin(auth.uid()));

-- 5) Mesures de performance côté client
create table if not exists public.performance_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  page_key text not null,
  metric_name text not null,
  metric_ms numeric(10, 2) not null check (metric_ms >= 0),
  context jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_performance_events_page_metric_created
  on public.performance_events (page_key, metric_name, created_at desc);

alter table public.performance_events enable row level security;

drop policy if exists "Clients can insert performance events" on public.performance_events;
create policy "Clients can insert performance events"
on public.performance_events
for insert
with check (actor_id is null or auth.uid() = actor_id);

drop policy if exists "Admins can read performance events" on public.performance_events;
create policy "Admins can read performance events"
on public.performance_events
for select
using (public.is_platform_admin(auth.uid()));
