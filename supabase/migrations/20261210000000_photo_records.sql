-- Fiches photo (socle éditorial, lot 2) : ce que la photo montre (analyse automatique, whatsapp_asset_assessments)
-- reste séparé de ce qui est confirmé sur le chantier (cette table). Une description automatique n'est jamais une
-- preuve de réalisation : seule une fiche validée par un administrateur rend citables l'intervention, la commune et
-- la date. Une fiche exclue retire la photo des propositions de l'Agent Publications.
create table public.photo_records(
 asset_id uuid primary key,
 client_id uuid not null references public.clients(id) on delete cascade,
 status text not null check(status in('validated','excluded')),
 intervention text check(intervention is null or length(btrim(intervention)) between 2 and 200),
 commune text check(commune is null or length(btrim(commune)) between 2 and 100),
 work_month date check(work_month is null or extract(day from work_month) = 1),
 -- Le chantier a bien été réalisé par l'entreprise cliente (et non une photo d'illustration ou d'un concurrent).
 done_by_client boolean,
 -- Le client autorise la publication de cette photo avec ces informations.
 publication_allowed boolean not null default true,
 note text check(note is null or length(note) <= 300),
 confirmed_by text not null check(confirmed_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 confirmed_at timestamptz not null default now(),
 check(status <> 'validated' or (intervention is not null and done_by_client is not null)),
 foreign key(asset_id, client_id) references public.whatsapp_assets(id, client_id) on delete cascade
);
create index photo_records_client on public.photo_records(client_id, status);
alter table public.photo_records enable row level security;
revoke all on public.photo_records from public, anon, authenticated;
grant select, insert, update, delete on public.photo_records to service_role;
