-- =========================================================
-- 11_community_post_views.sql
-- Statistiques de vues des publications communautaires
-- =========================================================

create table if not exists public.community_post_views (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (post_id, viewer_id)
);

create index if not exists idx_community_post_views_post
  on public.community_post_views (post_id);

create index if not exists idx_community_post_views_viewer
  on public.community_post_views (viewer_id);

alter table public.community_post_views enable row level security;

drop policy if exists "Community views are visible to everyone" on public.community_post_views;
create policy "Community views are visible to everyone"
on public.community_post_views
for select
using (true);

drop policy if exists "Users can register their own views" on public.community_post_views;
create policy "Users can register their own views"
on public.community_post_views
for insert
with check (auth.uid() = viewer_id);

drop policy if exists "Users can delete their own views" on public.community_post_views;
create policy "Users can delete their own views"
on public.community_post_views
for delete
using (auth.uid() = viewer_id);

drop policy if exists "Users can refresh their own views" on public.community_post_views;
create policy "Users can refresh their own views"
on public.community_post_views
for update
using (auth.uid() = viewer_id)
with check (auth.uid() = viewer_id);

drop view if exists public.community_posts_stats;

create view public.community_posts_stats as
select
  p.id as post_id,
  coalesce(l.likes_count, 0)::int as likes_count,
  coalesce(c.comments_count, 0)::int as comments_count,
  coalesce(s.saves_count, 0)::int as saves_count,
  coalesce(v.views_count, 0)::int as views_count,
  coalesce(i.images_count, 0)::int as images_count
from public.community_posts p
left join (
  select post_id, count(*) as likes_count
  from public.community_post_likes
  group by post_id
) l on l.post_id = p.id
left join (
  select post_id, count(*) as comments_count
  from public.community_post_comments
  group by post_id
) c on c.post_id = p.id
left join (
  select post_id, count(*) as saves_count
  from public.community_post_saves
  group by post_id
) s on s.post_id = p.id
left join (
  select post_id, count(*) as views_count
  from public.community_post_views
  group by post_id
) v on v.post_id = p.id
left join (
  select post_id, count(*) as images_count
  from public.community_post_images
  group by post_id
) i on i.post_id = p.id;
