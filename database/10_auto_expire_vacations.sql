-- =========================================================
-- 10_auto_expire_vacations.sql
-- Désactive automatiquement le mode congé quand la date est dépassée
-- =========================================================

create or replace function public.clear_expired_doctor_vacations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  update public.profiles
  set is_on_vacation = false
  where account_type = 'doctor'
    and coalesce(is_on_vacation, false) = true
    and vacation_end is not null
    and vacation_end < current_date;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function public.clear_expired_doctor_vacations() to anon, authenticated, service_role;
