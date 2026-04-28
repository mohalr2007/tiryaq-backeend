-- =========================================================
-- 05_community_publications.sql
-- Système Communauté: publications, likes, commentaires, enregistrements
-- Script indépendant (peut être exécuté séparément)
-- =========================================================

-- 1) Publications docteurs
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  category text not null default 'conseil' check (category in ('conseil', 'maladie')),
  title text not null,
  content text not null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_community_posts_doctor_created_at
  on public.community_posts (doctor_id, created_at desc);

create index if not exists idx_community_posts_created_at
  on public.community_posts (created_at desc);

-- 2) Images des publications (max 10 images par publication)
create table if not exists public.community_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  image_url text not null,
  sort_order integer not null check (sort_order between 0 and 9),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (post_id, sort_order)
);

create index if not exists idx_community_post_images_post_sort
  on public.community_post_images (post_id, sort_order);

-- 3) Likes
create table if not exists public.community_post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (post_id, user_id)
);

create index if not exists idx_community_post_likes_post
  on public.community_post_likes (post_id);

create index if not exists idx_community_post_likes_user
  on public.community_post_likes (user_id);

-- 4) Commentaires
create table if not exists public.community_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(trim(content)) > 0),
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_community_post_comments_post_created
  on public.community_post_comments (post_id, created_at desc);

create index if not exists idx_community_post_comments_user
  on public.community_post_comments (user_id);

-- 5) Enregistrements (Saved posts)
create table if not exists public.community_post_saves (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (post_id, user_id)
);

create index if not exists idx_community_post_saves_post
  on public.community_post_saves (post_id);

create index if not exists idx_community_post_saves_user
  on public.community_post_saves (user_id);

-- 6) Trigger de mise à jour "updated_at" des publications
create or replace function public.set_updated_at_community_posts()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_community_posts_updated_at on public.community_posts;
create trigger trg_community_posts_updated_at
before update on public.community_posts
for each row execute function public.set_updated_at_community_posts();

-- 7) RLS
alter table public.community_posts enable row level security;
alter table public.community_post_images enable row level security;
alter table public.community_post_likes enable row level security;
alter table public.community_post_comments enable row level security;
alter table public.community_post_saves enable row level security;

-- community_posts
drop policy if exists "Community posts are visible to everyone" on public.community_posts;
drop policy if exists "Community posts are visible unless hidden" on public.community_posts;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'community_posts'
      and column_name = 'is_hidden'
  ) then
    execute $policy$
      create policy "Community posts are visible unless hidden"
      on public.community_posts
      for select
      using ((not is_hidden) or public.is_platform_admin(auth.uid()))
    $policy$;
  else
    execute $policy$
      create policy "Community posts are visible to everyone"
      on public.community_posts
      for select
      using (true)
    $policy$;
  end if;
end $$;

drop policy if exists "Doctors can insert their own community posts" on public.community_posts;
create policy "Doctors can insert their own community posts"
on public.community_posts
for insert
with check (
  auth.uid() = doctor_id
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_type = 'doctor'
  )
);

drop policy if exists "Doctors can update their own community posts" on public.community_posts;
create policy "Doctors can update their own community posts"
on public.community_posts
for update
using (auth.uid() = doctor_id)
with check (auth.uid() = doctor_id);

drop policy if exists "Doctors can delete their own community posts" on public.community_posts;
create policy "Doctors can delete their own community posts"
on public.community_posts
for delete
using (auth.uid() = doctor_id);

-- community_post_images
drop policy if exists "Community images are visible to everyone" on public.community_post_images;
create policy "Community images are visible to everyone"
on public.community_post_images
for select
using (true);

drop policy if exists "Doctors can insert images for their own posts" on public.community_post_images;
create policy "Doctors can insert images for their own posts"
on public.community_post_images
for insert
with check (
  exists (
    select 1
    from public.community_posts p
    where p.id = post_id
      and p.doctor_id = auth.uid()
  )
);

drop policy if exists "Doctors can delete images for their own posts" on public.community_post_images;
create policy "Doctors can delete images for their own posts"
on public.community_post_images
for delete
using (
  exists (
    select 1
    from public.community_posts p
    where p.id = post_id
      and p.doctor_id = auth.uid()
  )
);

-- community_post_likes
drop policy if exists "Community likes are visible to everyone" on public.community_post_likes;
create policy "Community likes are visible to everyone"
on public.community_post_likes
for select
using (true);

drop policy if exists "Users can like posts with their own identity" on public.community_post_likes;
create policy "Users can like posts with their own identity"
on public.community_post_likes
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can unlike their own likes" on public.community_post_likes;
create policy "Users can unlike their own likes"
on public.community_post_likes
for delete
using (auth.uid() = user_id);

-- community_post_comments
drop policy if exists "Community comments are visible to everyone" on public.community_post_comments;
drop policy if exists "Community comments are visible unless hidden" on public.community_post_comments;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'community_post_comments'
      and column_name = 'is_hidden'
  ) then
    execute $policy$
      create policy "Community comments are visible unless hidden"
      on public.community_post_comments
      for select
      using ((not is_hidden) or public.is_platform_admin(auth.uid()))
    $policy$;
  else
    execute $policy$
      create policy "Community comments are visible to everyone"
      on public.community_post_comments
      for select
      using (true)
    $policy$;
  end if;
end $$;

drop policy if exists "Users can comment with their own identity" on public.community_post_comments;
create policy "Users can comment with their own identity"
on public.community_post_comments
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own comments" on public.community_post_comments;
create policy "Users can update their own comments"
on public.community_post_comments
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own comments" on public.community_post_comments;
create policy "Users can delete their own comments"
on public.community_post_comments
for delete
using (auth.uid() = user_id);

-- community_post_saves
drop policy if exists "Community saves are visible to everyone" on public.community_post_saves;
create policy "Community saves are visible to everyone"
on public.community_post_saves
for select
using (true);

drop policy if exists "Users can save posts with their own identity" on public.community_post_saves;
create policy "Users can save posts with their own identity"
on public.community_post_saves
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can unsave their own posts" on public.community_post_saves;
create policy "Users can unsave their own posts"
on public.community_post_saves
for delete
using (auth.uid() = user_id);

-- 8) Vue de stats agrégées (pour affichage rapide du feed)
drop view if exists public.community_posts_stats;

do $$
begin
  if to_regclass('public.community_post_views') is not null then
    execute $view$
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
      ) i on i.post_id = p.id
    $view$;
  else
    execute $view$
      create view public.community_posts_stats as
      select
        p.id as post_id,
        coalesce(l.likes_count, 0)::int as likes_count,
        coalesce(c.comments_count, 0)::int as comments_count,
        coalesce(s.saves_count, 0)::int as saves_count,
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
        select post_id, count(*) as images_count
        from public.community_post_images
        group by post_id
      ) i on i.post_id = p.id
    $view$;
  end if;
end $$;

-- 9) Bucket et policies storage pour les images communauté
do $$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'community-posts',
      'community-posts',
      true,
      10485760,
      array['image/png', 'image/jpeg', 'image/webp', 'image/jpg']
    )
    on conflict (id) do nothing;
  end if;
end
$$;

do $$
begin
  if to_regnamespace('storage') is not null then
    execute 'drop policy if exists "Community images are publicly readable" on storage.objects';
    execute 'create policy "Community images are publicly readable" on storage.objects for select using (bucket_id = ''community-posts'')';

    execute 'drop policy if exists "Doctors can upload their own community images" on storage.objects';
    execute 'create policy "Doctors can upload their own community images" on storage.objects for insert with check (bucket_id = ''community-posts'' and auth.uid()::text = (storage.foldername(name))[1])';

    execute 'drop policy if exists "Doctors can delete their own community images" on storage.objects';
    execute 'create policy "Doctors can delete their own community images" on storage.objects for delete using (bucket_id = ''community-posts'' and auth.uid()::text = (storage.foldername(name))[1])';
  end if;
end
$$;
