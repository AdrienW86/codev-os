-- Notifications : retrait des notifications lues de la liste (par administrateur). L'événement est conservé
-- (clé d'unicité event_key : il ne peut pas être recréé en double) ; seule sa ligne de lecture porte le retrait.
alter table public.admin_notification_reads add column if not exists dismissed_at timestamptz;
create index if not exists admin_notification_reads_dismissed on public.admin_notification_reads(user_id) where dismissed_at is not null;
