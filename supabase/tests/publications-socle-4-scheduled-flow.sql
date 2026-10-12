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
