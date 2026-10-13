-- Synthetic PostgreSQL local test only (socle Publications, lot 6). Never execute remotely.
-- Runs on the full migration chain; every statement is rolled back by the runner.
create function pg_temp.sf_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate;end $$;
do $$declare id text:=gen_random_uuid()::text;begin
 -- « Publication à valider » vers une publication ; « Photo manquante » et les catégories existantes restent valides.
 perform pg_temp.replay_assert(pg_temp.sf_error(format('insert into public.admin_notifications(event_key,category,href) values(%L,%L,%L)','sf-1','publication_review','/publications/'||id)) is null,'publication review accepted');
 perform pg_temp.replay_assert(pg_temp.sf_error(format('insert into public.admin_notifications(event_key,category,href) values(%L,%L,%L)','sf-2','media_missing','/clients/'||id||'?tab=media')) is null,'media missing still accepted');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.admin_notifications(event_key,category,href) values('sf-3','delivery_failed','/notifications')$q$) is null,'generic fallback link accepted');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.admin_notifications(event_key,category,href) values('sf-7','publication_review','/publications/review')$q$) is null,'review queue link accepted');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.admin_notifications(event_key,category,href) values('sf-4','publication_review','/publications/../settings')$q$)='23514','path traversal refused');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.admin_notifications(event_key,category,href) values('sf-5','publication_review','https://evil.test/publications/x')$q$)='23514','external link refused');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.admin_notifications(event_key,category,href) values('sf-6','auto_published','/notifications')$q$)='23514','unknown category refused');
 perform pg_temp.replay_assert((select column_default from information_schema.columns where table_schema='public' and table_name='admin_notification_preferences' and column_name='categories') like '%publication_review%','visible by default');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.admin_notification_preferences(user_id,categories,push_enabled,push_categories) values('user_sf',array['publication_review','media_missing'],false,array['publication_review'])$q$) is null,'preferences accept the new categories');
 -- Trigger: only failure states, invoker, server-only.
 perform pg_temp.replay_assert((select tgenabled<>'D' from pg_trigger where tgname='publication_delivery_failure_notification'),'delivery failure trigger enabled');
 perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='publications_private.delivery_failure_notification()'::regprocedure),'invoker trigger function');
 perform pg_temp.replay_assert(not has_function_privilege('authenticated','publications_private.delivery_failure_notification()','EXECUTE'),'browser denied');
end $$;
-- Rotation, suivi des préparations, candidates, envoi à l'heure, battement : additifs, serveur uniquement.
do $$declare f text;t text;r text;begin
 perform pg_temp.replay_assert((select column_default is null and is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='publication_client_settings' and column_name='last_auto_prepared_at'),'rotation column additive (null by default)');
 foreach f in array array['public.publication_scheduled_delivery_candidates(timestamptz,integer)','public.publication_job_claim_on_time(text,integer,integer)'] loop
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser denied '||f||' '||r);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server allowed '||f);
 end loop;
 foreach t in array array['public.scheduler_heartbeats','public.publication_scheduled_runs'] loop
  perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid=t::regclass),'RLS '||t);
  perform pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public' and tablename=split_part(t,'.',2)),'no policy '||t);
  foreach r in array array['anon','authenticated'] loop perform pg_temp.replay_assert(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'browser privileges absent '||t||' '||r);end loop;
  perform pg_temp.replay_assert(has_table_privilege('service_role',t,'SELECT,INSERT,UPDATE') and not has_table_privilege('service_role',t,'DELETE'),'server writes, never deletes '||t);
 end loop;
 -- Battement : une ligne par nom, étapes à statut fermé, aucun texte libre.
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.scheduler_heartbeats(name,started_at,finished_at,ok,steps,last_success_at) values('scheduler_tick',now(),now(),true,'{"automations":{"status":"ok","ms":12,"counts":{"processed":1}},"publication_preparation":{"status":"skipped","ms":0}}',now())$q$) is null,'heartbeat accepted');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.scheduler_heartbeats(name,started_at) values('scheduler_tick',now())$q$)='23505','one row per name');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.scheduler_heartbeats(name,started_at,steps) values('other',now(),'{"push":{"status":"exploded","ms":1}}')$q$)='23514','unknown step status refused');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.scheduler_heartbeats(name,started_at,steps) values('other',now(),'{"push":"Texte libre"}')$q$)='23514','free text step refused');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.scheduler_heartbeats(name,started_at) values('Bad Name!',now())$q$)='23514','invalid name refused');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.scheduler_heartbeats(name,started_at,steps) values('other',now(),'[]')$q$)='23514','steps must be an object');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$insert into public.publication_scheduled_runs(run_id,client_id) values(gen_random_uuid(),gen_random_uuid())$q$)='23503','follow-up only for an existing run');
 perform pg_temp.replay_assert(pg_temp.sf_error($q$select public.publication_job_claim_on_time('sched',60,null)$q$)='22023','tolerance required');
 perform pg_temp.replay_assert((select tgqual from pg_trigger where tgname='publication_delivery_failure_notification') is not null
  and pg_get_triggerdef((select oid from pg_trigger where tgname='publication_delivery_failure_notification')) like '%blocked%','blocked deliveries notified too');
end $$;
