-- Lot 4.3 P12 — Real Google Business Profile publisher. Additive, forward-only.
-- The publisher itself needs no schema change (P10 contract: remote ids up to 500 characters). Only the
-- reconciliation of P11-b accepted Meta ids exclusively; a Google post is identified by its resource name
-- accounts/{a}/locations/{l}/localPosts/{id}. The provider id format is now checked PER PLATFORM, and a Google
-- post name must belong to the delivery's own location (never a post of another business).
create or replace function public.publication_delivery_reconcile(p_delivery_id uuid,p_status text,p_remote_id text,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare d public.publication_deliveries;location text;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_delivery_id is null or p_status not in('exists','missing','unknown')
  or (p_status='exists' and p_remote_id is null)
  or (p_status<>'exists' and p_remote_id is not null) then raise exception 'Invalid reconciliation' using errcode='22023'; end if;
 select * into d from public.publication_deliveries where id=p_delivery_id for update;
 if not found or d.revision_id is null then raise exception 'Invalid delivery' using errcode='23514'; end if;
 if d.status<>'uncertain' then raise exception 'Delivery is not uncertain' using errcode='55000'; end if;
 if p_status='exists' then
  if d.platform in('facebook','instagram') then
   if p_remote_id !~ '^[0-9]{1,30}(_[0-9]{1,30})?$' then raise exception 'Invalid reconciliation' using errcode='22023'; end if;
  elsif d.platform='google_business_profile' then
   select a.external_account_id into location from public.publication_accounts a where a.id=d.publication_account_id;
   if location is null or p_remote_id !~ '^accounts/[0-9A-Za-z_-]{1,100}/locations/[0-9A-Za-z_-]{1,100}/localPosts/[0-9A-Za-z_-]{1,100}$'
    or left(p_remote_id,length(location)+1)<>location||'/' then raise exception 'Invalid reconciliation' using errcode='22023'; end if;
  else raise exception 'Invalid reconciliation' using errcode='22023';
  end if;
  update public.publication_deliveries set status='published',remote_id=p_remote_id,last_error_class=null,last_error_code=null where id=d.id;
 end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.delivery_reconciled',d.client_id,'publication',d.publication_id,
  jsonb_build_object('delivery_id',d.id,'platform',d.platform,'result',p_status,'delivery_status',case when p_status='exists' then 'published' else 'uncertain' end));
 return jsonb_build_object('delivery_id',d.id,'status',case when p_status='exists' then 'published' else 'uncertain' end);
end $$;

revoke all on function public.publication_delivery_reconcile(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.publication_delivery_reconcile(uuid,text,text,text) to service_role;
