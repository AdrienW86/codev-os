-- Synthetic PostgreSQL local test only (socle Publications, lot 6). Never execute remotely.
-- Appended after publications-delivery-engine.sql on the full migration chain (same transaction, rolled back):
-- every delivery that ended failed or uncertain produced exactly one notification towards its publication.
reset role;
do $$declare rec record;n integer;begin
 perform pg_temp.replay_assert((select count(*) from public.publication_deliveries where status in('failed','uncertain'))>0,'the delivery suite produced failures');
 for rec in select id,publication_id,status from public.publication_deliveries where status in('failed','uncertain') loop
  select count(*) into n from public.admin_notifications where event_key='publication-delivery:'||rec.id||':'||rec.status and category='delivery_failed' and href='/publications/'||rec.publication_id;
  perform pg_temp.replay_assert(n=1,'one notification for delivery '||rec.id||' '||rec.status);
 end loop;
 perform pg_temp.replay_assert(not exists(select 1 from public.admin_notifications n where n.event_key like 'publication-delivery:%'
  and not exists(select 1 from public.publication_deliveries d where n.event_key like 'publication-delivery:'||d.id||':%')),'no notification without a delivery');
 perform pg_temp.replay_assert(not exists(select 1 from public.admin_notifications where event_key like 'publication-delivery:%:published' or event_key like 'publication-delivery:%:scheduled'),'success never notified as a failure');
end $$;
-- A refused publication is never prepared for delivery; a submitted one waits for an explicit human approval.
do $$declare pub uuid;rev uuid;begin
 pub:=pg_temp.p10_publication('facebook','Lot 6 refusée',false);select current_revision_id into rev from public.publications where id=pub;
 set local role service_role;
 perform public.publication_submit_manual(pub,rev,'user_local');
 perform pg_temp.replay_assert((select status from public.publications where id=pub)='pending_review','submitted: à valider');
 perform pg_temp.replay_failure(format('select public.publication_prepare_delivery(%L,%L)',pub,'user_local'),'55000','pending review never prepared');
 perform public.publication_review_manual(pub,rev,'rejected','Hors sujet','user_local');
 perform pg_temp.replay_failure(format('select public.publication_prepare_delivery(%L,%L)',pub,'user_local'),'55000','rejected never prepared');
 reset role;
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries where publication_id=pub),'no delivery for a refused publication');
end $$;
