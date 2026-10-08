-- Lot 4.3 P11-b — Real Meta publisher: reconciliation of uncertain deliveries. Additive, forward-only.
-- The publisher itself needs no schema change (P10 contract). This migration only lets the server record the outcome
-- of a reconciliation (P10 transitions uncertain → published | failed already exist):
--  exists  → delivery published with the provider id found (never invented: the id comes from the provider);
--  missing / unknown → audited only, the delivery STAYS uncertain (no automatic resend);
--  explicit admin decision "not published" → failed (then a manual retry is possible).

-- Server-side context of an uncertain delivery (text, account, dispatch time). Never a credential.
create function public.publication_delivery_reconcile_context(p_delivery_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare d public.publication_deliveries;a public.publication_accounts;since timestamptz;
begin
 select * into d from public.publication_deliveries where id=p_delivery_id;
 if not found or d.revision_id is null then raise exception 'Invalid delivery' using errcode='23514'; end if;
 if d.status<>'uncertain' then raise exception 'Delivery is not uncertain' using errcode='55000'; end if;
 select * into a from public.publication_accounts where id=d.publication_account_id;
 select max(coalesce(t.started_at,t.created_at)) into since from public.publication_attempts t where t.delivery_id=d.id and t.result='uncertain';
 return jsonb_build_object('delivery_id',d.id,'publication_id',d.publication_id,'platform',d.platform,'remote_id',d.remote_id,'connection_id',a.connection_id,
  'account',jsonb_build_object('external_account_id',a.external_account_id,'parent_external_id',a.parent_external_id),
  'text',(select text_content from public.publication_variants where id=d.variant_id),'since',since);
end $$;

create function public.publication_delivery_reconcile(p_delivery_id uuid,p_status text,p_remote_id text,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare d public.publication_deliveries;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_delivery_id is null or p_status not in('exists','missing','unknown')
  or (p_status='exists' and (p_remote_id is null or p_remote_id !~ '^[0-9]{1,30}(_[0-9]{1,30})?$'))
  or (p_status<>'exists' and p_remote_id is not null) then raise exception 'Invalid reconciliation' using errcode='22023'; end if;
 select * into d from public.publication_deliveries where id=p_delivery_id for update;
 if not found or d.revision_id is null then raise exception 'Invalid delivery' using errcode='23514'; end if;
 if d.status<>'uncertain' then raise exception 'Delivery is not uncertain' using errcode='55000'; end if;
 if p_status='exists' then
  update public.publication_deliveries set status='published',remote_id=p_remote_id,last_error_class=null,last_error_code=null where id=d.id;
 end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.delivery_reconciled',d.client_id,'publication',d.publication_id,
  jsonb_build_object('delivery_id',d.id,'platform',d.platform,'result',p_status,'delivery_status',case when p_status='exists' then 'published' else 'uncertain' end));
 return jsonb_build_object('delivery_id',d.id,'status',case when p_status='exists' then 'published' else 'uncertain' end);
end $$;

-- Explicit admin decision after a reconciliation found nothing: the post was not published. uncertain → failed.
create function public.publication_delivery_confirm_not_published(p_delivery_id uuid,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare d public.publication_deliveries;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_delivery_id is null then raise exception 'Invalid decision' using errcode='22023'; end if;
 select * into d from public.publication_deliveries where id=p_delivery_id for update;
 if not found or d.revision_id is null then raise exception 'Invalid delivery' using errcode='23514'; end if;
 if d.status<>'uncertain' then raise exception 'Delivery is not uncertain' using errcode='55000'; end if;
 if not exists(select 1 from public.publication_events where action='publication.delivery_reconciled' and metadata->>'delivery_id'=d.id::text and metadata->>'result'='missing') then
  raise exception 'Reconcile first: no provider check found the post missing' using errcode='55000'; end if;
 update public.publication_deliveries set status='failed',last_error_code='confirmed_not_published' where id=d.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.delivery_confirmed_not_published',d.client_id,'publication',d.publication_id,jsonb_build_object('delivery_id',d.id,'platform',d.platform));
 return jsonb_build_object('delivery_id',d.id,'status','failed');
end $$;

revoke all on function public.publication_delivery_reconcile_context(uuid),public.publication_delivery_reconcile(uuid,text,text,text),
 public.publication_delivery_confirm_not_published(uuid,text) from public,anon,authenticated;
grant execute on function public.publication_delivery_reconcile_context(uuid),public.publication_delivery_reconcile(uuid,text,text,text),
 public.publication_delivery_confirm_not_published(uuid,text) to service_role;
