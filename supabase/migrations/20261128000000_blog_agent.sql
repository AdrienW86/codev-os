-- Agent Blog : pour les clients qui l'activent, un article de blog (illustré d'une photo publiable du client) est
-- rédigé une ou deux fois par semaine à partir de ses prestations vérifiées, programmé 24 h plus tard et signalé par
-- une notification (« Article prévu demain ») : l'administrateur peut le relire, le modifier ou l'annuler. À l'heure
-- prévue, l'article est publié (servi au site du client par une API publique en lecture seule) puis, si le relais est
-- activé, résumé sur les réseaux du client avec un renvoi vers l'article (circuit de publication habituel).
create table public.client_blog_agents(
 client_id uuid primary key references public.clients(id) on delete cascade,
 enabled boolean not null default false,
 per_week smallint not null default 1 check(per_week between 1 and 2),
 site_url text check(site_url is null or site_url ~ '^https://[a-z0-9.-]+\.[a-z]{2,}$'),
 blog_path text not null default '/blog' check(blog_path ~ '^/[a-z0-9-]+(/[a-z0-9-]+)*$'),
 social_relay boolean not null default false,
 last_planned_at timestamptz,
 updated_by text check(updated_by is null or updated_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table public.blog_articles(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 slug text not null check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 90),
 title text not null check(length(title) between 10 and 120),
 meta_description text not null check(length(meta_description) between 50 and 170),
 excerpt text not null check(length(excerpt) between 30 and 400),
 body_markdown text not null check(length(body_markdown) between 500 and 20000),
 service text,
 image_path text check(image_path is null or image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
 image_alt text check(image_alt is null or length(image_alt) <= 200),
 library_asset_id uuid,
 social jsonb not null default '{}'::jsonb check(jsonb_typeof(social)='object'),
 status text not null default 'scheduled' check(status in('scheduled','published','cancelled')),
 publish_at timestamptz not null,
 notified_at timestamptz,
 published_at timestamptz,
 cancelled_at timestamptz,
 social_status text not null default 'pending' check(social_status in('pending','off','done','partial','failed')),
 social_publication_ids uuid[] not null default '{}',
 created_by text not null check(created_by='blog_agent' or created_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 updated_by text check(updated_by is null or updated_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(client_id,slug),
 check((status='published')=(published_at is not null)),
 check((status='cancelled')=(cancelled_at is not null))
);
create index blog_articles_client_published on public.blog_articles(client_id,published_at desc) where status='published';
create index blog_articles_due on public.blog_articles(publish_at) where status='scheduled';

alter table public.client_blog_agents enable row level security;
alter table public.blog_articles enable row level security;
revoke all on public.client_blog_agents, public.blog_articles from public, anon, authenticated;
grant select, insert, update on public.client_blog_agents, public.blog_articles to service_role;

-- Images des articles : publiques (affichées par le site du client et ses aperçus de partage), JPEG uniquement.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('blog-images','blog-images',true,2097152,array['image/jpeg'])
on conflict (id) do nothing;

-- Notification « Article prévu demain » vers la fiche de l'article (relecture, modification, annulation).
alter table public.admin_notifications drop constraint admin_notifications_category_check;
alter table public.admin_notifications add constraint admin_notifications_category_check
  check (category in ('report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review','blog_scheduled'));
alter table public.admin_notifications drop constraint admin_notifications_href_check;
alter table public.admin_notifications add constraint admin_notifications_href_check
  check (href ~ '^/(reports|advertising/analyses|agents|publications|blog)/[0-9a-f-]{36}$' or href='/work?kind=incident' or href='/publications/review'
    or href ~ '^/clients/[0-9a-f-]{36}\?tab=media$' or href='/settings/whatsapp' or href='/notifications');
alter table public.admin_notification_preferences drop constraint admin_notification_preferences_categories_check;
alter table public.admin_notification_preferences drop constraint admin_notification_preferences_push_categories_check;
alter table public.admin_notification_preferences
  add constraint admin_notification_preferences_categories_check check (categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review','blog_scheduled']),
  add constraint admin_notification_preferences_push_categories_check check (push_categories <@ array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review','blog_scheduled']),
  alter column categories set default array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review','blog_scheduled'];
-- Demandée explicitement : la notification est ajoutée à la cloche et, pour les appareils abonnés, au push.
update public.admin_notification_preferences set categories = array_append(categories, 'blog_scheduled') where not ('blog_scheduled' = any(categories));
update public.admin_notification_preferences set push_categories = array_append(push_categories, 'blog_scheduled') where not ('blog_scheduled' = any(push_categories));
create or replace function public.codev_unread_notifications(p_user_id text) returns bigint language sql security invoker set search_path=pg_catalog as $$
 select count(*) from public.admin_notifications n where n.category=any(coalesce((select categories from public.admin_notification_preferences where user_id=p_user_id),
  array['report_ready','analysis_completed','analysis_failed','incident','delivery_failed','media_received','media_missing','publication_review','blog_scheduled']))
 and not exists(select 1 from public.admin_notification_reads r where r.user_id=p_user_id and r.notification_id=n.id);
$$;
