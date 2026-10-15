-- DÉPENDANCES CIBLÉES extraites en LECTURE SEULE de la production Supabase, 2026-10-15 (PostgreSQL 17.11).
-- Copie des colonnes, types, valeurs par défaut et clés primaires des quatre tables référencées par la migration SEO V2.
-- EXCLUS : données client, FK sortantes vers d'autres tables, triggers métier, index secondaires, politiques RLS historiques.
-- Ceci N'EST PAS un dump complet de production. Ne JAMAIS appliquer ce fichier sur une base existante.
-- Utilisation uniquement sur une base postgres:17 jetable, isolée.
CREATE SCHEMA IF NOT EXISTS codev_private;

CREATE TABLE public.actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recommendation_id uuid,
  agent_id uuid NOT NULL,
  client_id uuid NOT NULL,
  action_type text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'::text,
  requires_approval boolean NOT NULL DEFAULT true,
  approved_at timestamp with time zone,
  executed_at timestamp with time zone,
  result jsonb,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  project_id uuid,
  payload_hash text,
  approved_payload_hash text,
  approved_by text,
  prepared_by text,
  execution_mode text NOT NULL DEFAULT 'internal'::text,
  incident_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE public.agent_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  client_id uuid,
  status text NOT NULL DEFAULT 'running'::text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  summary text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_eur numeric(12,6),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  project_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company_name text,
  activity text,
  email text,
  phone text,
  website text,
  geographic_area text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.recommendations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  client_id uuid NOT NULL,
  title text NOT NULL,
  reason text,
  severity text NOT NULL DEFAULT 'info'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  project_id uuid,
  PRIMARY KEY (id)
);

-- Reproduction de l'indicateur RLS observé sur les quatre tables de production.
ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
