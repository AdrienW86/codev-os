-- Agent SEO V2 : opportunités de mots-clés, historique des analyses et mesure des interventions.
-- Additive uniquement : aucune table, colonne, donnée ou contrainte existante n'est modifiée ou supprimée.
--
-- Modèle :
--  * seo_opportunity_analyses : historique des analyses (quotidienne, hebdomadaire, manuelle) par client.
--  * seo_keyword_opportunities : une opportunité par client et empreinte (requête, page ou sujet), dédupliquée d'une
--    analyse à l'autre, avec son cycle de vie (détectée → à examiner → approuvée → en cours → réalisée | écartée).
--    Elle RÉFÉRENCE la recommandation existante (public.recommendations) : aucun workflow parallèle.
--  * seo_opportunity_interventions : situation avant modification, PR, date de déploiement et mesures à 7/28/60 jours.
-- Les métriques sont celles de Search Console ; une hypothèse (contexte métier) n'a aucune métrique (verified=false).

-- 1. Historique des analyses.
create table public.seo_opportunity_analyses(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 depth text not null check(depth in('daily','weekly')),
 trigger text not null check(trigger in('schedule','manual','assistant','system')),
 analysis_date date not null,
 status text not null default 'running' check(status in('running','succeeded','failed')),
 property text check(property is null or char_length(property) between 12 and 300),
 period_start date, period_end date, previous_start date, previous_end date,
 sources jsonb not null default '{}' check(jsonb_typeof(sources)='object' and pg_column_size(sources)<=8192),
 counts jsonb not null default '{}' check(jsonb_typeof(counts)='object' and pg_column_size(counts)<=4096),
 summary text check(summary is null or char_length(summary)<=2000),
 error_kind text check(error_kind is null or error_kind ~ '^[a-z_]{1,40}$'),
 agent_run_id uuid references public.agent_runs(id) on delete set null,
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 check((status='running')=(finished_at is null)),
 check(period_start is null or period_end is null or period_start<=period_end),
 check(previous_start is null or previous_end is null or previous_start<=previous_end)
);
-- Une analyse planifiée par client, profondeur et jour (un échec n'empêche pas de réessayer).
create unique index seo_opportunity_analyses_scheduled_once on public.seo_opportunity_analyses(client_id,depth,analysis_date) where trigger='schedule' and status<>'failed';
create index seo_opportunity_analyses_recent on public.seo_opportunity_analyses(client_id,started_at desc);

-- 2. Opportunités.
create table public.seo_keyword_opportunities(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 fingerprint text not null check(char_length(fingerprint) between 3 and 500),
 category text not null check(category in('striking_distance','page_two','declining_page','low_ctr','emerging_query','content_gap','local_gap','cannibalization')),
 keyword text not null check(char_length(keyword) between 1 and 300),
 keywords text[] not null default '{}' check(cardinality(keywords)<=20),
 target_url text check(target_url is null or (char_length(target_url)<=1000 and target_url ~ '^(https?://|/)')),
 target_status text not null check(target_status in('existing','missing','multiple')),
 intent text not null check(intent in('transactional','local','commercial','informational','navigational','unknown')),
 intent_basis text check(intent_basis is null or char_length(intent_basis)<=300),
 priority text not null check(priority in('high','medium','low')),
 confidence text not null check(confidence in('high','medium','low')),
 data_source text not null check(data_source in('search_console','business_context')),
 verified boolean not null,
 period_start date, period_end date, previous_start date, previous_end date,
 metrics jsonb check(metrics is null or (jsonb_typeof(metrics)='object' and pg_column_size(metrics)<=2048)),
 previous_metrics jsonb check(previous_metrics is null or (jsonb_typeof(previous_metrics)='object' and pg_column_size(previous_metrics)<=2048)),
 potential_clicks integer check(potential_clicks is null or potential_clicks>=0),
 factors text[] not null default '{}' check(cardinality(factors)<=12),
 rationale text not null check(char_length(rationale) between 1 and 4000),
 recommended_action text not null check(char_length(recommended_action) between 1 and 4000),
 action_kind text not null check(action_kind in('optimize_page','improve_snippet','internal_linking','add_content','create_page','consolidate','investigate')),
 evidence jsonb not null default '{}' check(jsonb_typeof(evidence)='object' and pg_column_size(evidence)<=32768),
 status text not null default 'detected' check(status in('detected','to_review','approved','in_progress','done','dismissed')),
 status_reason text check(status_reason is null or char_length(status_reason)<=2000),
 status_changed_at timestamptz not null default now(),
 significant_change boolean not null default false,
 recommendation_id uuid references public.recommendations(id) on delete set null,
 last_analysis_id uuid references public.seo_opportunity_analyses(id) on delete set null,
 detection_count integer not null default 1 check(detection_count>=1),
 first_detected_at timestamptz not null default now(),
 last_detected_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(client_id,fingerprint),
 -- Aucune hypothèse ne porte de métrique Google ; une donnée Search Console porte toujours ses métriques.
 check(verified = (data_source='search_console')),
 check(verified or (metrics is null and previous_metrics is null and potential_clicks is null)),
 check(not verified or metrics is not null),
 -- Écarter une opportunité exige une justification conservée.
 check(status<>'dismissed' or char_length(coalesce(btrim(status_reason),''))>0)
);
create index seo_keyword_opportunities_client_status on public.seo_keyword_opportunities(client_id,status,priority);
create index seo_keyword_opportunities_recommendation on public.seo_keyword_opportunities(recommendation_id) where recommendation_id is not null;

-- Cycle de vie : transitions autorisées uniquement, horodatage du changement de statut.
create function codev_private.seo_opportunity_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 new.updated_at := clock_timestamp();
 if tg_op='UPDATE' then
  if new.client_id is distinct from old.client_id or new.fingerprint is distinct from old.fingerprint or new.first_detected_at is distinct from old.first_detected_at then
   raise exception 'Opportunity identity is immutable' using errcode='55000';
  end if;
  if new.status is distinct from old.status then
   if not ((old.status='detected' and new.status in('to_review','approved','dismissed'))
     or (old.status='to_review' and new.status in('approved','dismissed'))
     or (old.status='approved' and new.status in('in_progress','done','dismissed'))
     or (old.status='in_progress' and new.status in('approved','done','dismissed'))
     or (old.status in('done','dismissed') and new.status='to_review')) then
    raise exception 'Invalid opportunity status transition % -> %', old.status, new.status using errcode='23514';
   end if;
   new.status_changed_at := clock_timestamp();
  end if;
 end if;
 return new;
end $$;
create trigger seo_keyword_opportunity_guard before insert or update on public.seo_keyword_opportunities
 for each row execute function codev_private.seo_opportunity_guard();

-- 3. Interventions et mesure des résultats.
create table public.seo_opportunity_interventions(
 id uuid primary key default gen_random_uuid(),
 opportunity_id uuid not null references public.seo_keyword_opportunities(id) on delete cascade,
 client_id uuid not null references public.clients(id) on delete cascade,
 action_id uuid references public.actions(id) on delete set null,
 pull_request_url text check(pull_request_url is null or pull_request_url ~ '^https://github\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}/pull/[0-9]{1,10}$'),
 keyword text not null check(char_length(keyword) between 1 and 300),
 target_url text check(target_url is null or char_length(target_url)<=1000),
 baseline jsonb check(baseline is null or (jsonb_typeof(baseline)='object' and pg_column_size(baseline)<=2048)),
 baseline_start date, baseline_end date,
 deployed_at date,
 measurements jsonb not null default '{}' check(jsonb_typeof(measurements)='object' and pg_column_size(measurements)<=16384),
 measured_at timestamptz,
 created_by text not null check(char_length(created_by) between 1 and 200),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(baseline_start is null or baseline_end is null or baseline_start<=baseline_end)
);
create index seo_opportunity_interventions_opportunity on public.seo_opportunity_interventions(opportunity_id,created_at desc);
create index seo_opportunity_interventions_to_measure on public.seo_opportunity_interventions(client_id) where deployed_at is not null;
-- La situation de référence est figée ; la date de déploiement ne s'enregistre qu'une fois.
create function codev_private.seo_intervention_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 new.updated_at := clock_timestamp();
 if (new.opportunity_id,new.client_id,new.keyword,new.target_url,new.baseline,new.baseline_start,new.baseline_end,new.created_by,new.created_at)
   is distinct from (old.opportunity_id,old.client_id,old.keyword,old.target_url,old.baseline,old.baseline_start,old.baseline_end,old.created_by,old.created_at)
  or (old.deployed_at is not null and new.deployed_at is distinct from old.deployed_at)
  or (old.pull_request_url is not null and new.pull_request_url is distinct from old.pull_request_url) then
  raise exception 'Intervention baseline and deployment are immutable' using errcode='55000';
 end if;
 return new;
end $$;
create trigger seo_opportunity_intervention_guard before update on public.seo_opportunity_interventions
 for each row execute function codev_private.seo_intervention_guard();

-- 4. Accès : serveur uniquement (rôle service), comme les autres tables de CODE-V OS.
alter table public.seo_opportunity_analyses enable row level security;
alter table public.seo_keyword_opportunities enable row level security;
alter table public.seo_opportunity_interventions enable row level security;
revoke all on public.seo_opportunity_analyses,public.seo_keyword_opportunities,public.seo_opportunity_interventions from public,anon,authenticated,service_role;
grant select,insert,update on public.seo_opportunity_analyses,public.seo_keyword_opportunities,public.seo_opportunity_interventions to service_role;
revoke all on function codev_private.seo_opportunity_guard(),codev_private.seo_intervention_guard() from public,anon,authenticated;

comment on table public.seo_opportunity_analyses is 'Historique des analyses d''opportunités SEO (quotidiennes, hebdomadaires, manuelles).';
comment on table public.seo_keyword_opportunities is 'Opportunités de mots-clés dédupliquées par client ; référencent la recommandation existante.';
comment on table public.seo_opportunity_interventions is 'Interventions SEO : situation de référence, PR, déploiement et mesures 7/28/60 jours.';
