-- Synthetic local-only fixtures. Never run against the remote database.
insert into public.projects(id,client_id,name,type) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Social','Réseaux sociaux'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','GBP','Google Business Profile'),
('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Foreign','Réseaux sociaux'),
('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Other social','Réseaux sociaux');
select pg_temp.replay_assert((select not public and file_size_limit=786432 from storage.buckets where id='publication-images'),'private bucket');
set local role service_role;
do $$
declare pub uuid;rev uuid;oldrev uuid;asset uuid:='90000000-0000-4000-8000-000000000001';client uuid:='10000000-0000-4000-8000-000000000001';project uuid:='30000000-0000-4000-8000-000000000001';before_events bigint;variants jsonb:='[{"platform":"facebook","text_content":"Facebook manual","metadata":{"title":"Canal","cta":"Contacter"}},{"platform":"instagram","text_content":"Instagram manual"}]';
begin
 pub:=public.publication_save_draft(null,null,client,project,'Titre','Angle','Source','2026-10-07',null,null,variants,'user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform pg_temp.replay_assert((select status='draft' and slot=1 and editorial_week='2026-10-05' and target_date='2026-10-07' from public.publications where id=pub),'draft with automatic slot');
 perform pg_temp.replay_assert((select source_content='Source' and actor_id='user_local' and project_id=project from public.publication_revisions where id=rev),'editorial snapshot');
 perform pg_temp.replay_assert((select count(*)=2 from public.publication_variants where revision_id=rev),'variants snapshot');
 perform pg_temp.replay_assert((select metadata->>'cta'='Contacter' from public.publication_variants where revision_id=rev and platform='facebook'),'CTA metadata');
 perform public.publication_submit_manual(pub,rev,'user_local');
 perform pg_temp.replay_assert((select status='pending_review' from public.publications where id=pub),'submitted');
 perform pg_temp.replay_failure(format('select public.publication_review_manual(%L,%L,''rejected'','''',''user_local'')',pub,rev),'22023','reason mandatory');
 perform public.publication_review_manual(pub,rev,'approved',null,'user_local');
 perform pg_temp.replay_assert((select status='approved' from public.publications where id=pub),'approved');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_reviews where revision_id=rev and variant_id is null and decision='approved'),'all approvals bound to revision');
 oldrev:=rev;
 perform public.publication_save_draft(pub,rev,client,project,'Titre 2','Angle 2','Source 2',null,null,null,variants,'user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform pg_temp.replay_assert(rev<>oldrev,'new revision');
 perform pg_temp.replay_assert((select status='draft' from public.publications where id=pub),'approval invalidated');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_reviews where revision_id=rev),'no inherited approval');
 perform pg_temp.replay_assert((select source_content='Source' from public.publication_revisions where id=oldrev),'old content retained');
 perform pg_temp.replay_failure(format('select public.publication_submit_manual(%L,%L,''user_local'')',pub,oldrev),'40001','stale submission');
 perform public.publication_register_image(pub,rev,asset,client::text||'/'||pub::text||'/'||asset::text,repeat('a',64),'image/png','Owned photo','user_local');
 perform pg_temp.replay_assert((select rights_confirmed from public.publication_assets where id=asset),'registered private image');
 variants:=jsonb_build_array(jsonb_build_object('platform','facebook','text_content','Updated','asset_ids',jsonb_build_array(asset)));
 perform public.publication_save_draft(pub,rev,client,project,'Titre 3','Angle','Source',null,null,null,variants,'user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform pg_temp.replay_assert(exists(select 1 from public.publication_variant_assets where asset_id=asset),'asset associated');
 perform public.publication_save_draft(pub,rev,client,project,'Titre 4','Angle','Source',null,null,null,'[{"platform":"facebook","text_content":"No image"}]','user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where resource_id=pub and action='publication.media_detached'),'detachment audited');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_assets where id=asset),'historical media retained');
 perform public.publication_submit_manual(pub,rev,'user_local');perform public.publication_review_manual(pub,rev,'rejected','Revoir le texte','user_local');
 perform pg_temp.replay_assert((select status='rejected' from public.publications where id=pub),'rejection');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_jobs),'no regeneration job');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries),'no deliveries');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(%L,%L,%L,%L,''T'',''A'',''S'',null,null,null,''[{"platform":"facebook","text_content":"T"}]'',''user_local'')',pub,rev,client,'30000000-0000-4000-8000-000000000003'),'23514','cross-client project');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(%L,%L,%L,%L,''T'',''A'',''S'',null,null,null,''[{"platform":"facebook","text_content":"T"}]'',''user_local'')',pub,rev,client,'30000000-0000-4000-8000-000000000002'),'23514','platform incompatible');
 perform public.publication_save_draft(null,null,client,project,'Second','Angle','Source','2026-10-07',null,null,'[{"platform":"facebook","text_content":"T"}]','user_local');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(null,null,%L,%L,''Third'',''Angle'',''Source'',''2026-10-07'',null,null,''[{"platform":"facebook","text_content":"T"}]'',''user_local'')',client,project),'23505','maximum two slots');
 perform pg_temp.replay_failure('update public.publication_events set action=''publication.tampered''','42501','events update denied');
 perform pg_temp.replay_failure('delete from public.publication_events','42501','events delete denied');
 perform pg_temp.replay_assert((select emergency_stop and not generation_enabled and not automation_enabled and not publishing_enabled from public.publication_settings),'kill switch unchanged');
 set constraints all immediate;
 perform public.publication_save_draft(pub,rev,client,'30000000-0000-4000-8000-000000000004','Moved','Angle','Source',null,null,null,'[{"platform":"facebook","text_content":"Moved"}]','user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform pg_temp.replay_assert((select project_id='30000000-0000-4000-8000-000000000004' from public.publications where id=pub),'atomic project change with immediate constraints');
 perform pg_temp.replay_assert((select project_id='30000000-0000-4000-8000-000000000004' from public.publication_revisions where id=rev),'project revision snapshot');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where resource_id=pub and action='publication.project_changed'),'project change audited');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(%L,%L,%L,%L,''Stale'',''A'',''S'',null,null,null,''[{"platform":"facebook","text_content":"T"}]'',''user_local'')',pub,oldrev,client,project),'40001','stale edit');
 perform pg_temp.replay_failure(format('update public.publications set subject=''Unversioned'' where id=%L',pub),'55000','direct title mutation denied');
end $$;
reset role;
-- Deliberate audit failure proves atomic rollback of editorial/variant changes.
create function pg_temp.fail_workspace_event() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure' using errcode='P0001';end$$;
create trigger workspace_fail before insert on public.publication_events for each row execute function pg_temp.fail_workspace_event();
select pg_temp.replay_failure('set local role service_role;select public.publication_save_draft(null,null,''10000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000001'',''Rollback'',''Angle'',''Source'',''2026-10-14'',null,null,''[{"platform":"facebook","text_content":"T"}]'',''user_local'')','P0001','audit rolls back');
select pg_temp.replay_assert(not exists(select 1 from public.publications where subject='Rollback'),'no partial draft');
select pg_temp.replay_assert((select count(*)=15 from public.audit_logs),'historical audits retained');
select pg_temp.replay_assert(not has_function_privilege('anon','public.publication_submit_manual(uuid,uuid,text)','EXECUTE'),'anon RPC denied');
select pg_temp.replay_assert(not has_function_privilege('authenticated','public.publication_save_draft(uuid,uuid,uuid,uuid,text,text,text,date,date,smallint,jsonb,text)','EXECUTE'),'authenticated RPC denied');
