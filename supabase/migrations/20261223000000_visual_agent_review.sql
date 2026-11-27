-- Agent Visuels : validation manuelle des visuels générés (règle de l'utilisateur, 2026-11-18 : toute image générée
-- passe par sa validation). Un visuel planifié est rendu, relu par l'auto-contrôle, puis rangé « à valider » dans le
-- stockage privé brand-assets ; il n'est déposé dans le Drive (donc dans la photothèque) qu'après « Valider ».
-- Additif : les lignes existantes restent « déposées » (status par défaut). Sans cette migration, l'agent garde le
-- comportement d'avant (dépôt direct).

alter table public.client_visual_items
 add column status text not null default 'deposited' check(status in('pending_review','deposited','rejected')),
 add column storage_path text check(storage_path is null or storage_path ~ '^[0-9a-f-]{36}/pending/[0-9a-f-]{36}\.png$'),
 add column review_score smallint check(review_score is null or review_score between 0 and 100),
 add column review_issues jsonb not null default '[]'::jsonb check(jsonb_typeof(review_issues)='array'),
 add column photo_asset_id uuid,
 add column decided_by text check(decided_by is null or decided_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 add column decided_at timestamptz,
 add column rejection_reason text check(rejection_reason is null or length(rejection_reason) <= 500);

-- Un visuel en attente a toujours son fichier privé.
alter table public.client_visual_items add constraint client_visual_items_pending_file check(status<>'pending_review' or storage_path is not null);

create index client_visual_items_pending_idx on public.client_visual_items(created_at) where status='pending_review';
grant update(status,drive_file_id,storage_path,decided_by,decided_at,rejection_reason) on public.client_visual_items to service_role;

-- La validation automatique dans la photothèque (20261126000000) ne vaut que pour un visuel déposé après validation :
-- un visuel en attente ou refusé n'a pas de fichier Drive, il ne peut donc pas être importé. Rien à changer au trigger.
