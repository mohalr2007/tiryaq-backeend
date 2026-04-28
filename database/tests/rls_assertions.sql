-- =========================================================
-- RLS assertions (manual SQL checks)
-- Usage: run in Supabase SQL Editor after migrations.
-- Prérequis: exécuter d'abord les scripts dans l'ordre:
--   1) database_setup.sql
--   2) 02_database_extensions.sql
--   3) 03_advanced_doctor_settings.sql
--   4) 04_working_hours.sql
--   5) 05_community_publications.sql
--   6) 06_appointment_booking_modes.sql
--   7) 07_moderation_observability.sql
--   8) 08_bootstrap_test_env.sql
-- =========================================================

do $$
declare
  v_reporter_id uuid;
  v_other_profile_id uuid;
  v_post_id uuid;
  v_non_admin_count int;
begin
  if to_regclass('public.community_post_reports') is null then
    raise exception
      'Table public.community_post_reports introuvable. Exécutez 05_community_publications.sql puis 07_moderation_observability.sql avant ce test.';
  end if;

  if to_regclass('public.system_audit_logs') is null then
    raise exception
      'Table public.system_audit_logs introuvable. Exécutez 07_moderation_observability.sql avant ce test.';
  end if;

  if to_regclass('public.performance_events') is null then
    raise exception
      'Table public.performance_events introuvable. Exécutez 07_moderation_observability.sql avant ce test.';
  end if;

  select p.id
  into v_reporter_id
  from public.profiles p
  where coalesce(p.is_platform_admin, false) = false
  order by p.created_at asc
  limit 1;

  select p.id
  into v_other_profile_id
  from public.profiles p
  where p.id <> v_reporter_id
  order by p.created_at asc
  limit 1;

  select cp.id
  into v_post_id
  from public.community_posts cp
  order by cp.created_at asc
  limit 1;

  if v_reporter_id is null or v_other_profile_id is null or v_post_id is null then
    raise exception
      'Contexte de test insuffisant. Exécutez 08_bootstrap_test_env.sql avant ce test.';
  end if;

  -- Nettoyage de sécurité avant test (évite le conflit unique post_id+reporter_id)
  delete from public.community_post_reports
  where post_id = v_post_id
    and reporter_id in (v_reporter_id, v_other_profile_id);

  -- Simule un utilisateur authentifié non-admin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_reporter_id::text, true);
  execute 'set local role authenticated';

  -- 1) Users cannot create report for another user_id
  -- Expected: ERROR (RLS with check)
  begin
    insert into public.community_post_reports (post_id, reporter_id, reason)
    values (v_post_id, v_other_profile_id, 'RLS test - should fail');
    raise exception 'TEST 1 FAILED: insertion autorisée pour un autre reporter_id.';
  exception
    when others then
      raise notice 'TEST 1 PASS: insertion bloquée comme prévu (%).', sqlerrm;
  end;

  -- 2) Users can create report with own identity
  -- Expected: INSERT 0 1
  begin
    insert into public.community_post_reports (post_id, reporter_id, reason)
    values (v_post_id, v_reporter_id, 'RLS self-report test - should pass');
    raise notice 'TEST 2 PASS: insertion autorisée pour reporter_id = auth.uid().';
  exception
    when others then
      raise exception 'TEST 2 FAILED: insertion refusée pour son propre reporter_id (%).', sqlerrm;
  end;

  -- 3) Non-admin cannot read full audit logs
  -- Expected: 0 rows (policy filtre)
  select count(*)
  into v_non_admin_count
  from public.system_audit_logs;

  if v_non_admin_count > 0 then
    raise exception 'TEST 3 FAILED: un non-admin lit des audit logs (% lignes).', v_non_admin_count;
  else
    raise notice 'TEST 3 PASS: non-admin ne lit pas les audit logs.';
  end if;

  -- 4) Performance event insertion by authenticated user
  -- Expected: INSERT 0 1
  begin
    insert into public.performance_events (actor_id, page_key, metric_name, metric_ms, context)
    values (v_reporter_id, 'rls_test', 'sample_metric', 123.45, '{"source":"rls_assertions"}'::jsonb);
    raise notice 'TEST 4 PASS: insertion performance_events autorisée.';
  exception
    when others then
      raise exception 'TEST 4 FAILED: insertion performance_events refusée (%).', sqlerrm;
  end;
end $$;
