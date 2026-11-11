-- Finance PR2 : synchronisation Qonto en lecture seule + rapprochement manuel audité.
-- Aucune facture émise, aucun virement, aucune relance/suspension.
create table public.finance_qonto_invoices (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique check(length(external_id) between 1 and 150),
  external_client_id text check (length(external_client_id)<=150),
  external_client_name text check (length(external_client_name)<=200),
  client_id uuid references public.clients(id) on delete restrict,
  number text not null check(length(number) between 1 and 150),
  status text not null check(length(status) between 1 and 50),
  total_cents bigint not null check(total_cents >= 0),
  currency text not null default 'EUR' check(currency='EUR'),
  issued_on date, due_on date,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  assigned_by text,
  assigned_at timestamptz
);
create index finance_qonto_invoices_client_idx on public.finance_qonto_invoices(client_id, due_on);
create index finance_qonto_invoices_external_client_idx on public.finance_qonto_invoices(external_client_id);
create index finance_qonto_invoices_status_idx on public.finance_qonto_invoices(status, due_on);

create table public.finance_qonto_transactions (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique check(length(external_id) between 1 and 150),
  external_bank_account_id text not null check(length(external_bank_account_id) between 1 and 150),
  amount_cents bigint not null check(amount_cents > 0),
  currency text not null default 'EUR' check(currency='EUR'),
  side text not null default 'credit' check(side='credit'),
  status text not null default 'completed' check(status='completed'),
  label text not null default '' check(length(label)<=180),
  reference text not null default '' check(length(reference)<=240),
  settled_at timestamptz not null,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now()
);
create index finance_qonto_transactions_date_idx on public.finance_qonto_transactions(settled_at desc);
create index finance_qonto_transactions_reference_idx on public.finance_qonto_transactions(reference);

create table public.finance_qonto_allocations (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_qonto_invoices(id) on delete restrict,
  transaction_id uuid not null references public.finance_qonto_transactions(id) on delete restrict,
  amount_cents bigint not null check(amount_cents > 0),
  assigned_by text not null check(length(assigned_by) between 1 and 160),
  created_at timestamptz not null default now(),
  unique(invoice_id,transaction_id)
);
create index finance_qonto_allocations_tx_idx on public.finance_qonto_allocations(transaction_id);

create table public.finance_qonto_sync_state (
  id boolean primary key default true check(id=true),
  status text not null default 'never' check(status in ('never','ok','error')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  invoice_count integer not null default 0 check(invoice_count>=0),
  credit_count integer not null default 0 check(credit_count>=0),
  error_code text check(length(error_code)<=80),
  synced_by text
);
insert into public.finance_qonto_sync_state (id) values (true);

-- Transaction atomique : pas d'allocation excessive ni de rapprochement sans client identifié.
-- La facture reste celle de Qonto ; la table d'allocation ne modifie pas son statut Qonto.
create function public.finance_qonto_allocate_credit(
  p_invoice_id uuid,
  p_transaction_id uuid,
  p_amount_cents bigint,
  p_actor text
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
 v_invoice public.finance_qonto_invoices%rowtype;
 v_transaction public.finance_qonto_transactions%rowtype;
 v_invoiced bigint;
 v_allocated_tx bigint;
 v_id uuid;
begin
 if p_actor is null or length(btrim(p_actor)) not between 1 and 160 then
  raise exception 'Invalid actor' using errcode='22023';
 end if;
 if p_amount_cents is null or p_amount_cents<=0 then
  raise exception 'Invalid amount' using errcode='22023';
 end if;
 -- Verrouiller les deux objets dans un ordre stable avant de calculer les sommes.
 select * into v_invoice from public.finance_qonto_invoices where id=p_invoice_id for update;
 select * into v_transaction from public.finance_qonto_transactions where id=p_transaction_id for update;
 if not found or v_invoice.id is null or v_transaction.id is null or v_invoice.client_id is null then
  raise exception 'Invoice or credit unavailable / client not linked' using errcode='23514';
 end if;
 if v_invoice.currency<>'EUR' or v_transaction.currency<>'EUR' or v_transaction.side<>'credit' or v_transaction.status<>'completed' then
  raise exception 'Ineligible credit' using errcode='23514';
 end if;
 if v_invoice.status in ('canceled','draft') then
  raise exception 'Invoice not payable' using errcode='23514';
 end if;
 select coalesce(sum(amount_cents),0) into v_invoiced from public.finance_qonto_allocations where invoice_id=p_invoice_id;
 select coalesce(sum(amount_cents),0) into v_allocated_tx from public.finance_qonto_allocations where transaction_id=p_transaction_id;
 if v_invoiced+p_amount_cents>v_invoice.total_cents or v_allocated_tx+p_amount_cents>v_transaction.amount_cents then
  raise exception 'Allocation exceeds source amount' using errcode='23514';
 end if;
 insert into public.finance_qonto_allocations(invoice_id,transaction_id,amount_cents,assigned_by)
 values (p_invoice_id,p_transaction_id,p_amount_cents,btrim(p_actor)) returning id into v_id;
 return v_id;
end $$;

alter table public.finance_qonto_invoices enable row level security;
alter table public.finance_qonto_transactions enable row level security;
alter table public.finance_qonto_allocations enable row level security;
alter table public.finance_qonto_sync_state enable row level security;
revoke all on table public.finance_qonto_invoices,public.finance_qonto_transactions,public.finance_qonto_allocations,public.finance_qonto_sync_state from public,anon,authenticated;
grant select,insert,update on public.finance_qonto_invoices,public.finance_qonto_transactions,public.finance_qonto_sync_state to service_role;
grant select,insert on public.finance_qonto_allocations to service_role;
revoke all on function public.finance_qonto_allocate_credit(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.finance_qonto_allocate_credit(uuid,uuid,bigint,text) to service_role;
