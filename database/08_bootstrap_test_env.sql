-- =========================================================
-- 08_bootstrap_test_env.sql
-- Prépare un contexte de test réel pour les checks RLS
-- =========================================================

do $$
declare
  v_reporter_id uuid;
  v_other_profile_id uuid;
  v_doctor_id uuid;
  v_post_id uuid;
  v_comment_id uuid;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Table public.profiles introuvable. Exécutez database_setup.sql.';
  end if;

  if to_regclass('public.community_posts') is null
     or to_regclass('public.community_post_comments') is null then
    raise exception 'Tables communauté introuvables. Exécutez 05_community_publications.sql.';
  end if;

  if to_regclass('public.community_post_reports') is null
     or to_regclass('public.system_audit_logs') is null
     or to_regclass('public.performance_events') is null then
    raise exception 'Tables de modération/observabilité introuvables. Exécutez 07_moderation_observability.sql.';
  end if;

  select p.id
  into v_reporter_id
  from public.profiles p
  where coalesce(p.is_platform_admin, false) = false
  order by p.created_at asc
  limit 1;

  if v_reporter_id is null then
    select p.id
    into v_reporter_id
    from public.profiles p
    order by p.created_at asc
    limit 1;
  end if;

  select p.id
  into v_other_profile_id
  from public.profiles p
  where p.id <> v_reporter_id
  order by p.created_at asc
  limit 1;

  if v_reporter_id is null or v_other_profile_id is null then
    raise exception 'Il faut au moins 2 profils utilisateurs dans public.profiles pour les tests RLS.';
  end if;

  select p.id
  into v_doctor_id
  from public.profiles p
  where p.account_type = 'doctor'
  order by p.created_at asc
  limit 1;

  if v_doctor_id is null then
    v_doctor_id := v_reporter_id;
    raise notice 'Aucun docteur trouvé: utilisation du profil % pour créer le post de test.', v_doctor_id;
  end if;

  select cp.id
  into v_post_id
  from public.community_posts cp
  where cp.title = '[RLS_TEST] Post de référence'
  limit 1;

  if v_post_id is null then
    insert into public.community_posts (doctor_id, category, title, content)
    values (v_doctor_id, 'conseil', '[RLS_TEST] Post de référence', 'Post généré automatiquement pour les tests RLS.')
    returning id into v_post_id;
  end if;

  select cc.id
  into v_comment_id
  from public.community_post_comments cc
  where cc.post_id = v_post_id
  order by cc.created_at asc
  limit 1;

  if v_comment_id is null then
    insert into public.community_post_comments (post_id, user_id, content)
    values (v_post_id, v_reporter_id, '[RLS_TEST] Commentaire de référence')
    returning id into v_comment_id;
  end if;

  raise notice 'Bootstrap terminé.';
  raise notice 'reporter_id       = %', v_reporter_id;
  raise notice 'other_profile_id  = %', v_other_profile_id;
  raise notice 'post_id           = %', v_post_id;
  raise notice 'comment_id        = %', v_comment_id;
end $$;
