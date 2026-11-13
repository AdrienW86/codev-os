-- Registre éditorial permanent (socle éditorial, lot 3). Ce qui a été publié ou proposé se lit dans les tables de
-- chaque canal (publications, blog_articles, email_newsletters) ; cette table ne garde que les RÉSERVATIONS : un sujet
-- retenu par un agent au moment de la planification, avant l'écriture. Deux agents ne peuvent pas réserver le même
-- sujet (même empreinte) sur le même canal en même temps ; une réservation expire seule si l'agent échoue.
create table public.editorial_reservations(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 channel text not null check(channel in('social','blog','newsletter')),
 topic text not null check(length(btrim(topic)) between 2 and 300),
 fingerprint text not null check(length(fingerprint) between 1 and 300),
 service text check(service is null or length(service) <= 200),
 angle text check(angle is null or length(angle) <= 200),
 reserved_by text not null check(reserved_by ~ '^[a-z][a-z0-9-]{1,40}$'),
 status text not null default 'reserved' check(status in('reserved','consumed','released')),
 -- Contenu qui a consommé la réservation (ex. blog:<uuid>) : l'entrée « publiée » vit ensuite dans la table du canal.
 consumed_ref text check(consumed_ref is null or consumed_ref ~ '^[a-z]+:[0-9a-f-]{36}$'),
 reserved_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '14 days',
 closed_at timestamptz,
 check(expires_at > reserved_at),
 check((status = 'reserved') = (closed_at is null)),
 check(status <> 'consumed' or consumed_ref is not null)
);
create unique index editorial_reservations_one_active on public.editorial_reservations(client_id, channel, fingerprint) where status = 'reserved';
create index editorial_reservations_client on public.editorial_reservations(client_id, status, reserved_at desc);
alter table public.editorial_reservations enable row level security;
revoke all on public.editorial_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.editorial_reservations to service_role;
