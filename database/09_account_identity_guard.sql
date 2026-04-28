-- =========================================================
-- 09_account_identity_guard.sql
-- Vérification du rôle déjà associé à un email
-- =========================================================

create or replace function public.find_account_by_email(_email text)
returns table (
  user_id uuid,
  email text,
  account_type text,
  full_name text,
  specialty text
)
language sql
security definer
set search_path = public, auth
stable
as $$
  select
    au.id as user_id,
    au.email::text as email,
    coalesce(p.account_type, au.raw_user_meta_data->>'account_type') as account_type,
    coalesce(p.full_name, au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name') as full_name,
    coalesce(p.specialty, au.raw_user_meta_data->>'specialty') as specialty
  from auth.users au
  left join public.profiles p on p.id = au.id
  where lower(trim(au.email)) = lower(trim(_email))
  limit 1;
$$;

grant execute on function public.find_account_by_email(text) to anon, authenticated;
