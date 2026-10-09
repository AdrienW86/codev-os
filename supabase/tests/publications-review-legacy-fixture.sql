-- Synthetic LOCAL fixture: the old RPC writes two rows for one decision.
insert into public.projects(id,client_id,name,type) values
 ('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Legacy decision fixture','Réseaux sociaux');
set local role service_role;
do $$declare pub uuid; rev uuid; begin
 pub:=public.publication_save_draft(null,null,'10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',
  'Legacy decision','Angle','Source','2026-11-02',null,null,
  '[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]','user_local');
 select current_revision_id into rev from public.publications where id=pub;
 perform public.publication_submit_manual(pub,rev,'user_local');
 perform public.publication_review_manual(pub,rev,'rejected','Legacy refusal','user_local');
 perform pg_temp.replay_assert((select count(*)=2 from public.publication_reviews where revision_id=rev),'old RPC reproduced two variant rows');
end $$;
reset role;
create temp table legacy_review_snapshot as select * from public.publication_reviews;
