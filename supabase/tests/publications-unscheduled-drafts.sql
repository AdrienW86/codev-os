-- Synthetic PostgreSQL local test only (brouillons non planifiés). Never execute on a remote project.
-- Runs after publications-delivery-engine-before.sql (client "P10 fixture", social project with a configured Facebook
-- channel and account) and every publications migration through P13, then 20261025000000_publications_unscheduled_drafts.sql.
create function pg_temp.ud_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate||':'||sqlerrm;end $$;
grant execute on function pg_temp.ud_error(text) to service_role;
create temporary table ud_ids(name text primary key,id uuid not null);
grant select,insert on ud_ids to service_role;

-- 1. Grants, function properties, additive schema.
do $$declare r text;f text:='public.publication_save_unscheduled_draft(uuid,uuid,text,text,text,jsonb,text)';begin
 foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||r);end loop;
 perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function granted');
 perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path');
 perform pg_temp.replay_assert(not exists(select 1 from public.publications where slot is null),'existing publications all keep their slot');
 perform pg_temp.replay_assert((select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='publications' and column_name='slot'),'slot nullable');
 perform pg_temp.replay_assert((select is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='publications' and column_name='editorial_week'),'editorial week still required');
end $$;

-- 2. Both editorial slots of a week taken: the existing rule still refuses a third scheduled draft (23505).
set local role service_role;
do $$declare cl uuid:=(select id from p10_ids where name='client');s uuid:=(select id from p10_ids where name='social');v jsonb:='[{"platform":"facebook","text_content":"F"}]';begin
 insert into ud_ids values('slot1',public.publication_save_draft(null,null,cl,s,'Créneau 1','A','S',null,'2027-03-01',null,v,'user_local'));
 insert into ud_ids values('slot2',public.publication_save_draft(null,null,cl,s,'Créneau 2','A','S',null,'2027-03-01',null,v,'user_local'));
 perform pg_temp.replay_assert(pg_temp.ud_error(format('select public.publication_save_draft(null,null,%L,%L,''Trop'',''A'',''S'',null,''2027-03-01'',null,%L,''user_local'')',cl,s,v)) like '23505:%','two slots per week kept');
end $$;

-- 3. Unscheduled drafts never consume a slot, even when the current week is full.
do $$declare cl uuid:=(select id from p10_ids where name='client');s uuid:=(select id from p10_ids where name='social');v jsonb:='[{"platform":"facebook","text_content":"Texte WhatsApp"}]';
 week date:=date_trunc('week',current_date::timestamp)::date;u1 uuid;u2 uuid;p public.publications;n integer;begin
 for n in 1..2 loop perform pg_temp.ud_error(format('select public.publication_save_draft(null,null,%L,%L,''Semaine %s'',''A'',''S'',null,%L,null,%L,''user_local'')',cl,s,n,week,v));end loop;
 perform pg_temp.replay_assert((select count(*) from public.publications where client_id=cl and project_id=s and editorial_week=week and slot is not null and occurrence_id is null)=2,'current week full');
 u1:=public.publication_save_unscheduled_draft(cl,s,' Photo WhatsApp ','Angle','Source WhatsApp',v,'user_local');
 u2:=public.publication_save_unscheduled_draft(cl,s,'Deuxième photo','Angle','Source',v,'user_local');
 insert into ud_ids values('u1',u1),('u2',u2);
 select * into p from public.publications where id=u1;
 perform pg_temp.replay_assert(p.slot is null and p.occurrence_id is null and p.target_date is null and p.editorial_group_id is null,'no slot, occurrence, date or group');
 perform pg_temp.replay_assert(p.status='draft' and p.subject='Photo WhatsApp' and p.editorial_week=week and p.project_id=s,'draft of the project, creation week kept for information');
 perform pg_temp.replay_assert((select count(*) from public.publication_variants where revision_id=p.current_revision_id and platform='facebook' and text_content='Texte WhatsApp')=1,'variant saved on the current revision');
 perform pg_temp.replay_assert((select internal_title='Photo WhatsApp' and angle='Angle' and source_content='Source WhatsApp' from public.publication_revisions where id=p.current_revision_id),'audited revision content');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where resource_id=u1 and action='publication.draft_saved' and metadata->>'unscheduled'='true'),'draft_saved event marks the draft unscheduled');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_calendar_slots where publication_id in(u1,u2)),'no calendar reservation bound');
 -- A new scheduled draft on an empty week still gets slot 1: unscheduled drafts do not count.
 insert into ud_ids values('next',public.publication_save_draft(null,null,cl,s,'Semaine suivante','A','S',null,'2027-03-08',null,v,'user_local'));
 perform pg_temp.replay_assert((select slot from public.publications where id=(select id from ud_ids where name='next'))=1,'slot search ignores unscheduled drafts');
end $$;

-- 4. Validations unchanged: actor, content and project scope.
do $$declare cl uuid:=(select id from p10_ids where name='client');s uuid:=(select id from p10_ids where name='social');other uuid:=(select id from p10_ids where name='other_client');v jsonb:='[{"platform":"facebook","text_content":"F"}]';begin
 perform pg_temp.replay_assert(pg_temp.ud_error(format('select public.publication_save_unscheduled_draft(%L,%L,''T'',''A'',''S'',%L,''admin'')',cl,s,v)) like '22023:%','invalid actor');
 perform pg_temp.replay_assert(pg_temp.ud_error(format('select public.publication_save_unscheduled_draft(%L,%L,'' '',''A'',''S'',%L,''user_local'')',cl,s,v)) like '22023:%','empty title');
 perform pg_temp.replay_assert(pg_temp.ud_error(format('select public.publication_save_unscheduled_draft(%L,%L,''T'',''A'',''S'',%L,''user_local'')',other,s,v)) like '23514:%','project of another client refused');
 perform pg_temp.replay_assert(pg_temp.ud_error(format('select public.publication_save_unscheduled_draft(%L,null,''T'',''A'',''S'',%L,''user_local'')',cl,v)) like '23514:%','project required');
end $$;

-- 5. Revising the unscheduled draft through the existing save path keeps it unscheduled; its identity stays immutable.
do $$declare cl uuid:=(select id from p10_ids where name='client');s uuid:=(select id from p10_ids where name='social');u1 uuid:=(select id from ud_ids where name='u1');rev uuid;r uuid;begin
 select current_revision_id into rev from public.publications where id=u1;
 r:=public.publication_save_draft(u1,rev,cl,s,'Photo WhatsApp','Angle','Source WhatsApp',null,null,null,'[{"platform":"facebook","text_content":"Texte relu"}]','user_local');
 perform pg_temp.replay_assert(r=u1 and (select slot is null and current_revision_id<>rev and status='draft' from public.publications where id=u1),'new revision, still unscheduled');
 reset role;
 perform pg_temp.replay_assert(pg_temp.ud_error(format('update public.publications set slot=1 where id=%L',u1)) like '55000:%','no slot taken by a plain update');
 perform pg_temp.replay_assert(pg_temp.ud_error(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject) values(%L,null,''2027-03-01'',null,''Sans projet'')',cl)) like '23514:%','unscheduled requires a project');
 set local role service_role;
end $$;

-- 6. An approved unscheduled publication can never get a delivery (even once bound to a platform).
do $$declare u2 uuid:=(select id from ud_ids where name='u2');rev uuid;v uuid;cl uuid;asset uuid:=gen_random_uuid();n integer;begin
 reset role;
 select current_revision_id,client_id into rev,cl from public.publications where id=u2;select id into v from public.publication_variants where revision_id=rev;
 insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,width,height,provenance,rights_confirmed)
 values(asset,cl,cl::text||'/'||u2::text||'/'||asset::text,md5(asset::text)||md5(u2::text),'image/jpeg',1080,1080,'WhatsApp client',true);
 insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(v,asset,cl,0);
 update public.publications set platform='facebook' where id=u2;
 set local role service_role;
 perform public.publication_submit_manual(u2,rev,'user_local');perform public.publication_review_manual(u2,rev,'approved',null,'user_local');
 perform pg_temp.replay_assert((select status from public.publications where id=u2)='approved','human approval still possible');
 select count(*) into n from public.publication_deliveries where publication_id=u2;
 perform pg_temp.replay_assert(pg_temp.ud_error(format('select public.publication_prepare_delivery(%L,''user_local'')',u2))='55000:Unscheduled publication','delivery refused while unscheduled');
 perform pg_temp.replay_assert((select count(*) from public.publication_deliveries where publication_id=u2)=n and not exists(select 1 from public.publication_jobs where publication_id=u2),'no delivery nor job created');
end $$;
reset role;
