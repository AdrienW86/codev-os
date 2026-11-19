-- Prospection e-mail, PR 3 : approbation, planification et envoi progressif (puis réponses, relance, rédaction).
-- Additif et idempotent. Colonnes prévues pour les PR 4 à 6 (réponse reçue, relance unique, faits de rédaction)
-- afin de n'appliquer qu'une migration pour l'envoi.

alter table public.acquisition_messages
  add column if not exists idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9:_-]{16,150}$'),
  add column if not exists approved_by text check (approved_by is null or char_length(approved_by) <= 120),
  add column if not exists attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  add column if not exists last_error text check (last_error is null or char_length(last_error) <= 60),
  add column if not exists cancelled_reason text check (cancelled_reason is null or char_length(cancelled_reason) <= 60),
  add column if not exists step smallint not null default 1 check (step in (1, 2)),
  add column if not exists parent_message_id uuid references public.acquisition_messages(id) on delete cascade,
  add column if not exists replied_at timestamptz,
  add column if not exists reply_kind text check (reply_kind is null or reply_kind in ('reply','stop','auto_reply')),
  add column if not exists reply_excerpt text check (reply_excerpt is null or char_length(reply_excerpt) <= 1000),
  add column if not exists facts jsonb not null default '[]'::jsonb,
  add column if not exists draft_source text not null default 'template' check (draft_source in ('template','ai_pending','ai')),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists acquisition_messages_idempotency on public.acquisition_messages(idempotency_key) where idempotency_key is not null;
create unique index if not exists acquisition_messages_one_followup on public.acquisition_messages(parent_message_id) where parent_message_id is not null;
create index if not exists acquisition_messages_provider_id on public.acquisition_messages(provider_message_id) where provider_message_id is not null;
create index if not exists acquisition_messages_recipient on public.acquisition_messages(recipient_email, sent_at);

alter table public.acquisition_workspaces
  add column if not exists send_paused_reason text check (send_paused_reason is null or char_length(send_paused_reason) <= 300),
  add column if not exists send_paused_at timestamptz;

notify pgrst, 'reload schema';
