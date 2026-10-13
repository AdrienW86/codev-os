-- Synthetic PostgreSQL local test only (phase 8, #47). Never execute remotely.
-- Charge côté base sur la chaîne complète des migrations : 20 clients fictifs, 60 publications approuvées par un humain,
-- préparation et envoi planifiés simulés passage par passage, garde de retard (réessais automatiques compris),
-- réservation limitée aux plateformes qui tiennent dans le temps restant. Lancé par tests/publications-load-db.test.mjs
-- dans une transaction annulée (now() constant : le temps est simulé en déplaçant run_at / scheduled_for).
-- Fixtures : supabase/tests/publications-load-fixtures.sql (chargées avant cette suite).
-- 0. Nouvelle fonction : invoker, chemin fixe, serveur seulement ; garde de retard toujours invoker.
do $$declare f text;r text;begin
 foreach f in array array['public.publication_job_claim_scheduled(text,integer,integer,text[])','public.publication_job_claim_on_time(text,integer,integer)'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser denied '||f); end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server only '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
end $$;
set local role anon;
select pg_temp.replay_failure('select public.publication_job_claim_scheduled(''w'',60,7200,null)','42501','anon scheduled claim denied');
reset role;
set local role service_role;
select pg_temp.replay_failure('select public.publication_job_claim_scheduled(''w'',60,7200,array[]::text[])','22023','empty platform list refused');
select pg_temp.replay_failure('select public.publication_job_claim_scheduled(''w'',60,7200,array[''linkedin''])','22023','unknown platform refused');
select pg_temp.replay_failure('select public.publication_job_claim_scheduled(''w'',60,10,null)','22023','tolerance bound kept');
reset role;

-- 1. 20 clients × 3 publications GBP approuvées : préparation par passages de 10 (plafond serveur), jamais deux fois.
do $$declare i integer;k integer;ticks integer:=0;prepared integer;c record;begin
 for i in 1..20 loop perform pg_temp.load_client(i);
  for k in 1..3 loop insert into load_ids values('pub',(i-1)*3+k,pg_temp.load_publication(i,'google_business_profile','Chantier '||i||'-'||k)); end loop;
 end loop;
 perform pg_temp.replay_assert((select count(*) from load_ids where name='pub')=60,'60 approved publications');
 perform pg_temp.replay_assert((select count(*) from public.publication_scheduled_delivery_candidates(now()-interval '2 hours',50) where state='ready')=50,'candidates capped at the limit (50)');
 loop
  prepared:=0;
  for c in select publication_id from public.publication_scheduled_delivery_candidates(now()-interval '2 hours',50) where state='ready' and publication_id in(select id from load_ids where name='pub') limit 10 loop
   set local role service_role;
   perform pg_temp.replay_assert((public.publication_prepare_delivery(c.publication_id,'user_local')->>'created')::boolean,'prepared once');
   reset role;prepared:=prepared+1;
  end loop;
  exit when prepared=0;ticks:=ticks+1;
 end loop;
 perform pg_temp.replay_assert(ticks=6,'60 approvals prepared in 6 ticks of 10');
 perform pg_temp.replay_assert((select count(*) from public.publication_deliveries d join load_ids l on l.name='pub' and l.id=d.publication_id)=60
  and (select count(distinct (d.publication_id,d.revision_id)) from public.publication_deliveries d join load_ids l on l.name='pub' and l.id=d.publication_id)=60,'one delivery per publication revision');
 -- Re-préparation (deux passages simultanés, rejeu) : la même diffusion, jamais une seconde.
 set local role service_role;
 for c in select id from load_ids where name='pub' loop
  perform pg_temp.replay_assert((public.publication_prepare_delivery(c.id,'user_local')->>'created')::boolean=false,'replay returns the existing delivery');
 end loop;
 reset role;
 perform pg_temp.replay_assert((select count(*) from public.publication_jobs j join load_ids l on l.name='pub' and l.id=j.publication_id where j.type='deliver')=60,'one deliver job per delivery');
end $$;

-- 2. En attente depuis plusieurs jours (planificateur arrêté) : jamais envoyé en retard ; blocage borné à 50 par appel.
do $$declare r jsonb;begin
 update public.publication_jobs set run_at=now()-interval '3 days' where type='deliver' and publication_id in(select id from load_ids where name='pub');
 update public.publication_deliveries set scheduled_for=now()-interval '3 days' where publication_id in(select id from load_ids where name='pub');
 set local role service_role;
 perform pg_temp.replay_assert(public.publication_job_claim_on_time('sched',60,7200) is null,'first call: 50 late jobs blocked, nothing sent');
 reset role;
 perform pg_temp.replay_assert((select count(*) from public.publication_deliveries where status='blocked' and blocked_reason='late_schedule' and publication_id in(select id from load_ids where name='pub'))=50,'exactly 50 blocked per call');
 set local role service_role;
 perform pg_temp.replay_assert(public.publication_job_claim_on_time('sched',60,7200) is null,'second call: the last 10 blocked, still nothing sent');
 reset role;
 perform pg_temp.replay_assert((select count(*) from public.publication_deliveries where status='blocked' and blocked_reason='late_schedule' and publication_id in(select id from load_ids where name='pub'))=60
  and not exists(select 1 from public.publication_attempts a join public.publication_deliveries d on d.id=a.delivery_id where d.publication_id in(select id from load_ids where name='pub')),'60 blocked, zero attempt');
 perform pg_temp.replay_assert((select count(*) from public.admin_notifications n join public.publication_deliveries d on n.event_key='publication-delivery:'||d.id||':blocked'
  where d.publication_id in(select id from load_ids where name='pub'))=60,'each late block notified once');
end $$;

-- 3. Un humain relance les 60 : le planificateur les envoie toutes, une fois chacune (aucun doublon, aucun oubli).
do $$declare c record;r jsonb;sends integer:=0;begin
 set local role service_role;
 for c in select d.id from public.publication_deliveries d join load_ids l on l.name='pub' and l.id=d.publication_id loop perform public.publication_delivery_retry(c.id,'user_local'); end loop;
 reset role;
 loop
  r:=pg_temp.load_send('sched-'||(sends%2),null,pg_temp.load_ok('simulated'));
  exit when r is null;sends:=sends+1;
  perform pg_temp.replay_assert(r->>'delivery_status'='simulated','sent: '||sends);
  exit when sends>100;
 end loop;
 perform pg_temp.replay_assert(sends=60,'60 sends, then idle');
 perform pg_temp.replay_assert((select count(*) from public.publication_attempts a join public.publication_deliveries d on d.id=a.delivery_id where d.publication_id in(select id from load_ids where name='pub'))=60
  and (select max(cnt) from (select count(*) cnt from public.publication_attempts a join public.publication_deliveries d on d.id=a.delivery_id where d.publication_id in(select id from load_ids where name='pub') group by a.delivery_id) x)=1,'exactly one attempt per delivery');
 perform pg_temp.replay_assert((select count(*) from public.publication_deliveries where status='simulated' and publication_id in(select id from load_ids where name='pub'))=60,'all 60 delivered (simulated)');
end $$;

-- 4. Garde de retard appliquée aux réessais automatiques (#47). Avant : run_at repoussé par le réessai masquait le retard.
do $$declare pub uuid;d uuid;r jsonb;begin
 pub:=pg_temp.load_publication(1,'google_business_profile','Réessai tardif');
 set local role service_role;d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;reset role;
 update public.publication_jobs set run_at=now()-interval '1 minute' where delivery_id=d;update public.publication_deliveries set scheduled_for=now()-interval '1 minute' where id=d;
 r:=pg_temp.load_send('sched',null,pg_temp.load_ok('provider_unavailable','{"error_code":"provider_5xx"}'));
 perform pg_temp.replay_assert(r->>'delivery_status'='retryable_error','5xx: automatic retry scheduled');
 -- 3 h plus tard (heure due 9 h, il est 12 h), le réessai automatique est dû : il ne part plus, il est bloqué.
 update public.publication_deliveries set scheduled_for=now()-interval '3 hours' where id=d;update public.publication_jobs set run_at=now()-interval '1 minute' where delivery_id=d and status='pending';
 perform pg_temp.replay_assert(pg_temp.load_send('sched',null,pg_temp.load_ok('simulated')) is null,'automatic retry 3 h after the slot never sent');
 perform pg_temp.replay_assert((select status='blocked' and blocked_reason='late_schedule' from public.publication_deliveries where id=d)
  and (select count(*) from public.publication_attempts where delivery_id=d)=1,'blocked late_schedule, still one attempt');
 -- Un humain relance : référence = sa relance, l'envoi part (dans la tolérance), une seule fois.
 set local role service_role;perform public.publication_delivery_retry(d,'user_local');reset role;
 r:=pg_temp.load_send('sched',null,pg_temp.load_ok('simulated'));
 perform pg_temp.replay_assert(r->>'delivery_status'='simulated' and (select count(*) from public.publication_attempts where delivery_id=d)=2,'relaunched by a human: sent');
 -- Délai imposé par le fournisseur (429, 2 h) : le réessai tombe hors tolérance → bloqué, jamais envoyé.
 pub:=pg_temp.load_publication(2,'google_business_profile','Quota dépassé');
 set local role service_role;d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;reset role;
 update public.publication_jobs set run_at=now()-interval '1 minute' where delivery_id=d;update public.publication_deliveries set scheduled_for=now()-interval '1 minute' where id=d;
 r:=pg_temp.load_send('sched',null,pg_temp.load_ok('rate_limit','{"error_code":"rate_limited","retry_after_seconds":7200}'));
 perform pg_temp.replay_assert((select run_at>now()+interval '119 minutes' from public.publication_jobs where delivery_id=d and status='pending'),'retry after the provider delay');
 update public.publication_deliveries set scheduled_for=now()-interval '2 hours 5 minutes' where id=d;update public.publication_jobs set run_at=now()-interval '1 second' where delivery_id=d and status='pending';
 perform pg_temp.replay_assert(pg_temp.load_send('sched',null,pg_temp.load_ok('simulated')) is null,'2 h 05 after the slot: nothing sent');
 perform pg_temp.replay_assert((select status='blocked' and blocked_reason='late_schedule' from public.publication_deliveries where id=d),'2 h 05 after the slot: blocked');
 -- Dans la tolérance (heure due il y a 1 h) : le réessai part normalement.
 pub:=pg_temp.load_publication(3,'google_business_profile','Réessai à temps');
 set local role service_role;d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;reset role;
 update public.publication_jobs set run_at=now()-interval '1 minute' where delivery_id=d;update public.publication_deliveries set scheduled_for=now()-interval '1 minute' where id=d;
 perform pg_temp.load_send('sched',null,pg_temp.load_ok('retryable','{"error_code":"temporary"}'));
 update public.publication_deliveries set scheduled_for=now()-interval '1 hour' where id=d;update public.publication_jobs set run_at=now()-interval '1 second' where delivery_id=d and status='pending';
 perform pg_temp.replay_assert(pg_temp.load_send('sched',null,pg_temp.load_ok('simulated'))->>'delivery_status'='simulated','retry within the tolerance: sent');
 -- Le bouton du cockpit (publication_job_claim, décision humaine) n'est pas concerné par la garde.
 perform pg_temp.replay_assert(position('publication_job_claim_on_time' in (select prosrc from pg_proc where oid='public.publication_job_claim(text,integer)'::regprocedure))=0,'cockpit claim unchanged');
end $$;

-- 5. Réservation limitée aux plateformes qui tiennent dans le temps restant : la tête de file n'est jamais doublée.
do $$declare ig uuid;gb uuid;dig uuid;dgb uuid;r jsonb;att integer;begin
 ig:=pg_temp.load_publication(4,'instagram','Instagram en tête');gb:=pg_temp.load_publication(5,'google_business_profile','GBP derrière');
 set local role service_role;
 dig:=(public.publication_prepare_delivery(ig,'user_local')->>'delivery_id')::uuid;dgb:=(public.publication_prepare_delivery(gb,'user_local')->>'delivery_id')::uuid;
 reset role;
 update public.publication_jobs set run_at=now()-interval '2 minutes' where delivery_id=dig;update public.publication_jobs set run_at=now()-interval '1 minute' where delivery_id=dgb;
 update public.publication_deliveries set scheduled_for=now()-interval '2 minutes' where id in(dig,dgb);
 r:=pg_temp.load_send('sched',array['facebook','google_business_profile'],pg_temp.load_ok('simulated'));
 perform pg_temp.replay_assert(r is null,'Instagram at the head and not allowed: nothing claimed');
 perform pg_temp.replay_assert((select status='pending' and attempts=0 and locked_by is null from public.publication_jobs where delivery_id=dig)
  and (select status='scheduled' from public.publication_deliveries where id=dig),'deferred claim fully rolled back (no attempt consumed)');
 perform pg_temp.replay_assert((select status='pending' and attempts=0 from public.publication_jobs where delivery_id=dgb),'the faster job behind is not taken out of order');
 r:=pg_temp.load_send('sched',null,pg_temp.load_ok('simulated'));
 perform pg_temp.replay_assert(r->>'platform'='instagram','unrestricted first send: Instagram');
 r:=pg_temp.load_send('sched',array['facebook','google_business_profile'],pg_temp.load_ok('simulated'));
 perform pg_temp.replay_assert(r->>'platform'='google_business_profile','then the GBP job fits');
 -- Arrêt d'urgence : rien, même restreint.
 update public.publication_settings set emergency_stop=true,publishing_enabled=false,generation_enabled=false,automation_enabled=false;
 set local role service_role;perform pg_temp.replay_assert(public.publication_job_claim_scheduled('sched',60,7200,array['facebook']) is null,'emergency stop wins');reset role;
 update public.publication_settings set emergency_stop=false,publishing_enabled=true;
end $$;
reset role;
