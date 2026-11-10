-- CODE-V OS Finance (étape 1) : catalogue commercial et prestations contractuelles.
-- Aucune création de facture, aucun accès bancaire et aucune suspension.
-- Référence : CODE-V_Devis-cadre_prestations.pdf (27 repères HT indicatifs, pas de prix de vente).
create table if not exists public.finance_categories (
 code text primary key check (code ~ '^[a-z][a-z0-9_]{2,48}$'),
 label text not null check (length(label) between 2 and 120),
 sort_order integer not null default 0,
 archived_at timestamptz
);
create table if not exists public.finance_catalog_items (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check (code ~ '^[a-z][a-z0-9-]{2,100}$'),
 category_code text not null references public.finance_categories(code) on delete restrict,
 name text not null check (length(name) between 2 and 160),
 description text not null default '' check (length(description) <= 3000),
 billing_unit text not null check (billing_unit in ('forfait','projet','article','support','dossier','heure','mois','an','mise_en_place')),
 billing_frequency text not null check (billing_frequency in ('ponctuel','mensuel','annuel')),
 reference_min_cents bigint check (reference_min_cents >= 0),
 reference_max_cents bigint check (reference_max_cents >= reference_min_cents),
 -- Prix proposé global : NULL pour les 27 références du PDF (aucun tarif ferme inventé).
 default_price_cents bigint check (default_price_cents >= 0),
 currency char(3) not null default 'EUR' check (currency='EUR'),
 source text not null default 'personnalise' check (source in ('reference_pdf_2026','personnalise')),
 archived_at timestamptz,
 updated_by text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists finance_catalog_category_idx on public.finance_catalog_items(category_code) where archived_at is null;

create table if not exists public.finance_client_contracts (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete restrict,
 catalog_item_id uuid references public.finance_catalog_items(id) on delete restrict,
 name text not null check (length(name) between 2 and 160),
 description text not null default '' check (length(description) <= 3000),
 billing_unit text not null check (billing_unit in ('forfait','projet','article','support','dossier','heure','mois','an','mise_en_place')),
 billing_frequency text not null check (billing_frequency in ('ponctuel','mensuel','annuel')),
 unit_price_cents bigint not null check (unit_price_cents >= 0),
 quantity numeric(10,2) not null default 1 check (quantity > 0 and quantity <= 100000),
 currency char(3) not null default 'EUR' check (currency='EUR'),
 starts_on date not null,
 ends_on date check (ends_on is null or ends_on >= starts_on),
 status text not null default 'draft' check (status in ('draft','active','paused','ended')),
 reference text check (length(reference) <= 160),
 notes text check (length(notes) <= 3000),
 updated_by text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists finance_contracts_client_idx on public.finance_client_contracts(client_id,status,starts_on);
create index if not exists finance_contracts_catalog_idx on public.finance_client_contracts(catalog_item_id) where catalog_item_id is not null;

-- Traçabilité transactionnelle : les versions contractuelles restent figées même si le catalogue évolue.
create table if not exists public.finance_catalog_history (
 id bigint generated always as identity primary key,
 catalog_item_id uuid not null references public.finance_catalog_items(id) on delete restrict,
 snapshot jsonb not null,
 changed_by text,
 changed_at timestamptz not null default now()
);
create table if not exists public.finance_contract_history (
 id bigint generated always as identity primary key,
 contract_id uuid not null references public.finance_client_contracts(id) on delete restrict,
 snapshot jsonb not null,
 changed_by text,
 changed_at timestamptz not null default now()
);
create index if not exists finance_catalog_history_item_idx on public.finance_catalog_history(catalog_item_id,changed_at desc);
create index if not exists finance_contract_history_contract_idx on public.finance_contract_history(contract_id,changed_at desc);
create or replace function public.finance_touch_updated_at() returns trigger language plpgsql set search_path=pg_catalog as $$
begin new.updated_at=now();return new;end $$;
create or replace function public.finance_record_snapshot() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_table_name='finance_catalog_items' then
  insert into public.finance_catalog_history(catalog_item_id,snapshot,changed_by) values(new.id,to_jsonb(new),new.updated_by);
 elsif tg_table_name='finance_client_contracts' then
  insert into public.finance_contract_history(contract_id,snapshot,changed_by) values(new.id,to_jsonb(new),new.updated_by);
 end if;
 return new;
end $$;
drop trigger if exists finance_catalog_touch on public.finance_catalog_items;
create trigger finance_catalog_touch before update on public.finance_catalog_items for each row execute function public.finance_touch_updated_at();
drop trigger if exists finance_contract_touch on public.finance_client_contracts;
create trigger finance_contract_touch before update on public.finance_client_contracts for each row execute function public.finance_touch_updated_at();
drop trigger if exists finance_catalog_history_trigger on public.finance_catalog_items;
create trigger finance_catalog_history_trigger after insert or update on public.finance_catalog_items for each row execute function public.finance_record_snapshot();
drop trigger if exists finance_contract_history_trigger on public.finance_client_contracts;
create trigger finance_contract_history_trigger after insert or update on public.finance_client_contracts for each row execute function public.finance_record_snapshot();

-- Serveur uniquement ; jamais d'accès direct depuis les rôles navigateur.
alter table public.finance_categories enable row level security;
alter table public.finance_catalog_items enable row level security;
alter table public.finance_client_contracts enable row level security;
alter table public.finance_catalog_history enable row level security;
alter table public.finance_contract_history enable row level security;
revoke all on table public.finance_categories,public.finance_catalog_items,public.finance_client_contracts,public.finance_catalog_history,public.finance_contract_history from public,anon,authenticated;
grant select,insert,update,delete on table public.finance_categories,public.finance_catalog_items,public.finance_client_contracts to service_role;
grant select,insert on table public.finance_catalog_history,public.finance_contract_history to service_role;
grant usage,select on sequence public.finance_catalog_history_id_seq,public.finance_contract_history_id_seq to service_role;
revoke all on function public.finance_touch_updated_at(),public.finance_record_snapshot() from public,anon,authenticated;
grant execute on function public.finance_touch_updated_at(),public.finance_record_snapshot() to service_role;

insert into public.finance_categories(code,label,sort_order) values
 ('seo_visibilite_locale','SEO & visibilité locale',1),
 ('acquisition_publicite','Acquisition & publicité',2),
 ('web_applications','Web & applications',3),
 ('automatisation_ia','Automatisation & intelligence artificielle',4),
 ('relation_client','Relation client & pilotage administratif',5)
on conflict(code) do nothing;
insert into public.finance_catalog_items(code,category_code,name,description,billing_unit,billing_frequency,reference_min_cents,reference_max_cents,default_price_cents,source)
select v.code,v.category_code,v.name,v.description,v.billing_unit,v.billing_frequency,v.min_cents,v.max_cents,null,'reference_pdf_2026'
from (values
 ('google-business-profile','seo_visibilite_locale','Création / optimisation de fiche Google Business Profile','Configuration, catégories, description, services, zones desservies, photos et conseils de publication.','forfait','ponctuel',25000,50000),
 ('audit-seo','seo_visibilite_locale','Audit SEO du site','Analyse technique, structure, indexation, performances et recommandations priorisées.','forfait','ponctuel',35000,80000),
 ('optimisation-seo-locale','seo_visibilite_locale','Optimisation SEO locale','Optimisation des pages et contenus locaux, balisage, maillage interne et suivi des positions.','forfait','ponctuel',45000,90000),
 ('redaction-article-seo','seo_visibilite_locale','Rédaction d’un article optimisé SEO','Recherche de sujet et mots-clés, rédaction, titres, méta-description et intégration simple.','article','ponctuel',15000,30000),
 ('hebergement-domaine-maintenance','seo_visibilite_locale','Hébergement, nom de domaine & maintenance','Hébergement, renouvellement du domaine, sauvegardes et mises à jour selon formule.','an','annuel',18000,42000),
 ('gestion-reseaux-sociaux','seo_visibilite_locale','Gestion des réseaux sociaux','Ligne éditoriale, calendrier, création et programmation de publications, modération définie.','mois','mensuel',35000,90000),
 ('setup-google-ads','acquisition_publicite','Mise en place d’une campagne Google Ads','Paramétrage du compte, structure des campagnes, annonces, ciblage et suivi des conversions.','forfait','ponctuel',40000,90000),
 ('pilotage-google-ads','acquisition_publicite','Pilotage Google Ads','Optimisations, contrôle des requêtes, ajustements budgétaires et reporting.','mois','mensuel',25000,60000),
 ('acquisition-locale','acquisition_publicite','Acquisition locale / génération de prospects','Définition de la cible, recherche de canaux et mise en place d’un dispositif de collecte.','forfait','ponctuel',40000,100000),
 ('liste-prospects','acquisition_publicite','Création d’une liste de prospects','Recherche et structuration de contacts professionnels selon critères convenus, avec vérification raisonnable des données.','forfait','ponctuel',25000,70000),
 ('supports-communication-imprimes','acquisition_publicite','Supports de communication imprimés','Conception graphique d’une carte de visite ou d’un flyer, préparation des fichiers imprimeur.','support','ponctuel',18000,45000),
 ('contenus-publicitaires','acquisition_publicite','Création de contenus publicitaires','Déclinaisons visuelles et rédaction de messages pour une campagne digitale.','forfait','ponctuel',25000,60000),
 ('site-vitrine','web_applications','Site vitrine','Conception responsive, jusqu’à 5 pages, formulaire de contact, intégration des contenus fournis et SEO technique de base.','projet','ponctuel',180000,350000),
 ('site-vitrine-etendu-blog','web_applications','Site vitrine étendu / blog','Architecture éditoriale, jusqu’à 10 pages, rubrique articles et modèles de contenus.','projet','ponctuel',280000,550000),
 ('application-web-espace-metier','web_applications','Application web / espace métier','Cadrage fonctionnel, interface, base de données et fonctionnalités sur mesure selon cahier des charges.','projet','ponctuel',500000,null),
 ('refonte-site','web_applications','Refonte de site existant','Audit de l’existant, nouvelle direction graphique, réorganisation des pages et migration définie.','projet','ponctuel',150000,450000),
 ('optimisation-profils-reseaux','web_applications','Création / optimisation des réseaux sociaux','Création ou harmonisation des profils, biographies, visuels et liens de contact.','forfait','ponctuel',25000,60000),
 ('automatisation-emailing','automatisation_ia','Automatisation d’e-mails / emailing','Scénarios d’envoi, formulaires, segmentation simple et connexions aux outils disponibles.','mise_en_place','ponctuel',40000,120000),
 ('agent-ia','automatisation_ia','Agent IA / assistant métier','Cadrage, base de connaissances, consignes, intégration à un canal et tests avec validation humaine.','projet','ponctuel',90000,300000),
 ('connexion-outils-automatisation','automatisation_ia','Connexion d’outils & automatisation administrative','Automatisation de transferts de données, notifications, relances et tâches répétitives.','projet','ponctuel',50000,180000),
 ('configuration-logiciel-facturation','automatisation_ia','Mise à disposition / configuration d’un logiciel de facturation','Aide au choix, paramétrage initial, modèles et prise en main ; abonnement logiciel non inclus.','forfait','ponctuel',25000,70000),
 ('maintenance-automatisations','automatisation_ia','Maintenance et supervision d’automatisations','Surveillance, corrections mineures et assistance sur le périmètre livré.','mois','mensuel',9000,25000),
 ('setup-crm','relation_client','Mise en place d’un suivi client / CRM','Organisation des contacts, étapes commerciales, modèles de relance et tableau de suivi.','forfait','ponctuel',50000,150000),
 ('modeles-documents-commerciaux','relation_client','Modèles de devis et documents commerciaux','Création et mise en forme de modèles de devis, e-mails et documents récurrents.','forfait','ponctuel',18000,45000),
 ('organisation-reponses-email','relation_client','Organisation des réponses clients par e-mail','Mise en place de modèles de réponse, règles de tri et processus de traitement.','forfait','ponctuel',25000,70000),
 ('verification-administrative-entreprise','relation_client','Identification et vérification administrative d’entreprise','Aide à la collecte et à l’organisation d’informations publiques et justificatifs (ex. extrait Kbis).','dossier','ponctuel',8000,25000),
 ('accompagnement-operationnel','relation_client','Accompagnement opérationnel','Suivi des demandes, coordination et aide à l’utilisation des outils définis au devis.','heure','ponctuel',4500,8500)
) as v(code,category_code,name,description,billing_unit,billing_frequency,min_cents,max_cents)
on conflict(code) do nothing;
