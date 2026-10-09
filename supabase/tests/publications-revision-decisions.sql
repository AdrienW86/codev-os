-- LOCAL ONLY. Preserve old append-only rows, test the corrected RPC.
drop trigger workspace_fail on public.publication_events;
select pg_temp.replay_assert(not exists(
 select 1 from legacy_review_snapshot s left join public.publication_reviews r on r.id=s.id
 where to_jsonb(s) is distinct from to_jsonb(r)), 'legacy decisions preserved byte-for-byte');
select pg_temp.replay_assert((select relrowsecurity from pg_class where oid='public.publication_reviews'::regclass),'reviews RLS preserved');
select pg_temp.replay_assert(not has_table_privilege('anon','public.publication_reviews','select')
 and not has_table_privilege('authenticated','public.publication_reviews','select'),'no public access');
set local role service_role;
do $$
declare pub uuid;rev uuid;oldrev uuid;before_events bigint;client uuid;project uuid;
begin
 select id,current_revision_id,client_id,project_id into pub,rev,client,project from public.publications where subject='Moved';
 perform public.publication_save_draft(pub,rev,client,project,'Decision fixture','A','S',null,null,null,
  '[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]','user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform public.publication_submit_manual(pub,rev,'user_local');
 select count(*) into before_events from public.publication_events where resource_id=pub and action='publication.reviewed';
 perform public.publication_review_manual(pub,rev,'rejected','Invalid text','user_local');
 perform public.publication_review_manual(pub,rev,'rejected','Invalid text','user_local');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_reviews where revision_id=rev and variant_id is null),'two platforms and retry produce one persisted decision');
 perform pg_temp.replay_assert((select count(*)=before_events+1 from public.publication_events where resource_id=pub and action='publication.reviewed'),'retry produces one event');
 perform pg_temp.replay_failure(format('select public.publication_review_manual(%L,%L,''approved'',null,''user_local'')',pub,rev),'40001','conflicting decision refused');
 perform pg_temp.replay_failure(format('select public.publication_review_manual(%L,%L,''rejected'',''Changed reason'',''user_local'')',pub,rev),'40001','changed reason refused');
 perform pg_temp.replay_failure(format('select public.publication_review_manual(%L,%L,''rejected'',''Invalid text'',''user_other'')',pub,rev),'40001','different actor refused');
 oldrev:=rev;
 perform public.publication_save_draft(pub,rev,client,project,'Next revision','A','S',null,null,null,
  '[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]','user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform pg_temp.replay_assert(rev<>oldrev and not exists(select 1 from public.publication_reviews where revision_id=rev),'new revision has no decision');
 perform pg_temp.replay_failure(format('select public.publication_review_manual(%L,%L,''rejected'',''Invalid text'',''user_local'')',pub,oldrev),'40001','old retry cannot review new revision');
 perform public.publication_submit_manual(pub,rev,'user_local');
 perform public.publication_review_manual(pub,rev,'approved',null,'user_local');
 perform public.publication_review_manual(pub,rev,'approved',null,'user_local');
 perform pg_temp.replay_assert((select status='approved' from public.publications where id=pub),'global approval covers both variants');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_reviews where revision_id=rev),'one global approval');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_reviews where revision_id=oldrev),'old refusal retained once');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_jobs),'no jobs created by review');
end $$;
reset role;
-- Audit failure rolls back the global decision and status atomically.
set local role service_role;
do $$declare pub uuid;rev uuid;begin
 select id,current_revision_id into pub,rev from public.publications where subject='Second';
 perform public.publication_submit_manual(pub,rev,'user_local');
end $$;
reset role;
create trigger review_audit_failure before insert on public.publication_events
 for each row execute function pg_temp.fail_workspace_event();
set local role service_role;
do $$declare pub uuid;rev uuid;begin
 select id,current_revision_id into pub,rev from public.publications where subject='Second';
 perform pg_temp.replay_failure(format('select public.publication_review_manual(%L,%L,''rejected'',''Rollback'',''user_local'')',pub,rev),'P0001','review audit failure');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_reviews where revision_id=rev),'global review rolled back');
 perform pg_temp.replay_assert((select status='pending_review' from public.publications where id=pub),'review status rolled back');
end $$;
reset role;
drop trigger review_audit_failure on public.publication_events;
