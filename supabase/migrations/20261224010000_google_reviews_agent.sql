-- Agent Avis Google : réponses aux avis des fiches Google Business Profile dans le ton du client, alerte immédiate sur
-- les avis négatifs et demandes d'avis après chantier. Additif et idempotent. Sans cette migration, l'agent ne tourne
-- pas (étape « google_reviews » désactivée, écran /avis indique la migration à appliquer).
-- Une réponse publique part sur la fiche Google seulement après « Publier » par l'administrateur, ou par la règle
-- de publication automatique des avis positifs choisie pour le client (désactivée par défaut). Jamais pour un avis
-- de 3 étoiles ou moins.

create table if not exists public.google_review_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  enabled boolean not null default true,
  tone_notes text not null default '' check (char_length(tone_notes) <= 1000),
  signature text not null default '' check (char_length(signature) <= 120),
  auto_publish_min_rating smallint check (auto_publish_min_rating is null or auto_publish_min_rating between 4 and 5),
  auto_publish_delay_hours smallint not null default 12 check (auto_publish_delay_hours between 1 and 72),
  review_url text check (review_url is null or (review_url ~ '^https://[^\s<>"]+$' and char_length(review_url) <= 500)),
  detected_review_url text check (detected_review_url is null or (detected_review_url ~ '^https://[^\s<>"]+$' and char_length(detected_review_url) <= 500)),
  request_subject text check (request_subject is null or char_length(request_subject) <= 120),
  request_template text check (request_template is null or char_length(request_template) <= 2000),
  request_delay_days smallint not null default 1 check (request_delay_days between 0 and 14),
  last_sync_at timestamptz,
  last_sync_error text check (last_sync_error is null or char_length(last_sync_error) <= 120),
  updated_by text check (updated_by is null or updated_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  location_name text not null check (location_name ~ '^accounts/[0-9A-Za-z_-]{1,100}/locations/[0-9A-Za-z_-]{1,100}$'),
  review_name text not null unique check (review_name ~ '^accounts/[0-9A-Za-z_-]{1,100}/locations/[0-9A-Za-z_-]{1,100}/reviews/[0-9A-Za-z_-]{1,300}$'),
  reviewer text check (reviewer is null or char_length(reviewer) <= 60),
  rating smallint check (rating is null or rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 4000),
  review_created_at timestamptz not null,
  review_updated_at timestamptz not null,
  status text not null default 'to_draft' check (status in ('to_draft','draft','publishing','published','replied_elsewhere','skipped','failed')),
  draft text check (draft is null or char_length(draft) <= 4096),
  draft_attempts smallint not null default 0 check (draft_attempts between 0 and 20),
  draft_score smallint check (draft_score is null or draft_score between 0 and 100),
  draft_issues jsonb not null default '[]'::jsonb check (jsonb_typeof(draft_issues) = 'array'),
  draft_at timestamptz,
  auto_publish_at timestamptz,
  existing_reply text check (existing_reply is null or char_length(existing_reply) <= 4096),
  published_reply text check (published_reply is null or char_length(published_reply) <= 4096),
  published_at timestamptz,
  published_by text check (published_by is null or published_by = 'auto' or published_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  decided_by text check (decided_by is null or decided_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  decided_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  notified_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Une publication automatique n'est possible que pour un avis de 4 étoiles ou plus.
alter table public.google_reviews drop constraint if exists google_reviews_auto_positive;
alter table public.google_reviews add constraint google_reviews_auto_positive check (published_by is distinct from 'auto' or coalesce(rating, 0) >= 4);
create index if not exists google_reviews_client_idx on public.google_reviews(client_id, review_created_at desc);
create index if not exists google_reviews_open_idx on public.google_reviews(status, first_seen_at) where status in ('to_draft','draft','publishing');

create table if not exists public.google_review_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  customer_name text not null check (char_length(customer_name) between 1 and 80),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$')),
  service text check (service is null or char_length(service) <= 120),
  job_date date not null,
  send_after timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','sent','failed','cancelled','suppressed')),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  sent_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  created_by text not null check (created_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  created_at timestamptz not null default now(),
  purged_at timestamptz
);
create index if not exists google_review_requests_due_idx on public.google_review_requests(send_after) where status = 'scheduled';
create index if not exists google_review_requests_client_idx on public.google_review_requests(client_id, created_at desc);

alter table public.google_review_settings enable row level security;
alter table public.google_reviews enable row level security;
alter table public.google_review_requests enable row level security;
revoke all on public.google_review_settings, public.google_reviews, public.google_review_requests from public, anon, authenticated;
grant select, insert, update, delete on public.google_review_settings, public.google_reviews, public.google_review_requests to service_role;

-- Alerte immédiate « avis négatif » (demande de l'administrateur, 2026-11-28) : nouvelle catégorie de notification,
-- lien vers /avis. Ajoutée aux préférences existantes qui reçoivent déjà les échecs de publication.
alter table public.admin_notifications drop constraint if exists admin_notifications_category_check;
alter table public.admin_notifications add constraint admin_notifications_category_check
  check (category in ('report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review','blog_scheduled','negative_review'));
alter table public.admin_notifications drop constraint if exists admin_notifications_href_check;
alter table public.admin_notifications add constraint admin_notifications_href_check
  check (href ~ '^/(reports|advertising/analyses|agents|publications|blog)/[0-9a-f-]{36}$' or href='/work?kind=incident' or href='/publications/review'
    or href ~ '^/clients/[0-9a-f-]{36}\?tab=media$' or href='/settings/whatsapp' or href='/notifications' or href ~ '^/avis\?client=[0-9a-f-]{36}$');
alter table public.admin_notification_preferences drop constraint if exists admin_notification_preferences_categories_check;
alter table public.admin_notification_preferences drop constraint if exists admin_notification_preferences_push_categories_check;
alter table public.admin_notification_preferences
  add constraint admin_notification_preferences_categories_check check (categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review','blog_scheduled','negative_review']),
  add constraint admin_notification_preferences_push_categories_check check (push_categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review','blog_scheduled','negative_review']),
  alter column categories set default array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review','blog_scheduled','negative_review'];
update public.admin_notification_preferences set categories = array_append(categories, 'negative_review') where not ('negative_review' = any(categories));
update public.admin_notification_preferences set push_categories = array_append(push_categories, 'negative_review') where 'delivery_failed' = any(push_categories) and not ('negative_review' = any(push_categories));
create or replace function public.codev_unread_notifications(p_user_id text) returns bigint language sql security invoker set search_path=pg_catalog as $$
 select count(*) from public.admin_notifications n where n.category=any(coalesce((select categories from public.admin_notification_preferences where user_id=p_user_id),
  array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review','blog_scheduled','negative_review']))
 and not exists(select 1 from public.admin_notification_reads r where r.user_id=p_user_id and r.notification_id=n.id);
$$;

notify pgrst, 'reload schema';
