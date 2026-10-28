# Plan de développement : moteur de missions (P1 « Harness »)

Rédigé le 28 octobre 2026 pour la reprise du travail par un autre agent (Codex) pendant une indisponibilité.
Langue de l'interface et des messages : **français**. Destinataire : agent de code travaillant sur ce dépôt.

## 0. À lire avant de commencer

- `AGENTS.md` : cette version de Next.js a des changements incompatibles ; lire le guide dans
  `node_modules/next/dist/docs/` avant d'écrire du code Next (routes, server actions, cache).
- Conventions du dépôt (à respecter, elles sont vérifiées par les tests) :
  - code serveur : `import "server-only"` ; toute lecture/écriture privilégiée après `requireAdmin()`
    (`lib/require-admin.ts`), ou acteur système explicite (`lib/core/actor.ts`) pour le planificateur ;
  - écritures métier **atomiques avec leur journal** : RPC PostgreSQL. Pour clients/projets/tâches/actions,
    utiliser `auditedMutation` (`lib/core/audited-mutation.ts`, RPC `audited_mutation`, PR #113). Pour les
    nouvelles tables de missions : RPC dédiées qui écrivent la ligne **et** l'événement dans la même transaction ;
  - migrations dans `supabase/migrations/AAAAMMJJHHMMSS_nom.sql`, idempotentes quand c'est possible,
    `revoke all … from public, anon, authenticated` + `grant execute … to service_role` sur chaque RPC, RLS
    activée sur chaque table (aucun accès navigateur direct) ;
  - tests Node : `node --test tests/*.test.mjs`, modules TS chargés par `tests/helpers/load-ts.mjs`
    (`loadTs(path, mocks)` : tout import non simulé lève une erreur) ;
  - tests SQL : `supabase/tests/<nom>.sql` (assertions `pg_temp.check_true`) exécutés après rejeu complet du
    schéma de production (`supabase/local/remote-schema.sql`) + toutes les migrations, via
    `tests/codev-core-db.test.mjs` (variable `CODEV_CORE_TEST_DATABASE_URL`, base locale jetable uniquement) ;
  - tests de périmètre : certains répertoires interdisent `fetch(`, `https://`, `process.env` (voir
    `tests/publications.test.mjs`, test « Lot 1 has no external transport… ») ; les transports vont dans
    `lib/integrations/**` avec `import "server-only"`.
- Processus : une branche par lot, PR via `gh api repos/AdrienW86/codev-os/pulls`, CI verte obligatoire
  (jobs `verify`, `Publications PostgreSQL and browser journeys`, `PostgreSQL 17 isolated replay and SQL checks`),
  **la migration n'est appliquée en production qu'après CI verte**, puis fusion (squash). Projet Supabase :
  `lehlbcnpufkllcykvtlg`. Ne jamais appliquer de migration destructive sans accord explicite d'Adrien.
- Ne jamais : publier/diffuser quoi que ce soit au nom d'un client, modifier un budget ou une campagne Google
  Ads, envoyer un message externe, sans validation humaine explicite enregistrée.

## 1. Objectif

Transformer une demande (« Analyse pourquoi Jrenov reçoit peu d'appels malgré les dépenses Google Ads et prépare
les corrections ») en une **mission suivie** :

1. découpée en étapes bornées et typées ;
2. exécutée en arrière-plan par le planificateur existant, **reprenable** après coupure (bail + idempotence) ;
3. qui **attend une validation humaine** avant toute étape à effet externe ;
4. qui **vérifie** le résultat après coup et produit un **compte rendu** avec ses preuves ;
5. entièrement **journalisée** (chaque transition = un événement, atomique avec l'écriture).

Hors périmètre de P1 : agents qui dialoguent librement entre eux, autonomie > 1, actions irréversibles
automatiques, nouvelles intégrations externes. On réutilise l'existant.

## 2. Ce qui existe déjà (à réutiliser, ne pas dupliquer)

| Brique | Fichier(s) | Usage dans les missions |
|---|---|---|
| File de jobs (bail, SKIP LOCKED, fencing par worker, reprises) | `public.jobs`, `codev_claim_jobs`, `lib/scheduler/engine.ts` | Chaque étape de mission = un job `run_type = 'mission.step'` |
| Registre des handlers | `lib/runs/handlers.ts`, `lib/runs/types.ts` (`RunHandler`, `RunError`) | Ajouter le handler `mission.step` |
| Registre agents / capacités / types d'exécution | `lib/agents/registry.ts` | Déclarer le run type et la capacité |
| Moteur de permissions | `lib/permissions/engine.ts` (`authorize`) | Décider automatique / validation requise par étape |
| Planificateur (tick toutes les 15 min) | `app/api/internal/scheduler/tick/route.ts`, `lib/scheduler/heartbeat.ts` | Les jobs `mission.step` passent par l'étape `automations` existante |
| Journal d'audit | `public.audit_logs`, `lib/core/audit.ts` | Événements critiques en plus de `mission_events` |
| Assistant / Directeur IA | `lib/assistant/orchestrator.ts` (`MAX_ROUNDS = 3`), `lib/assistant/tools.ts`, `lib/assistant/director.ts` | Point d'entrée « créer une mission » + suivi |
| Lectures Google Ads | `lib/integrations/google-ads/*` (campagnes, `getClientKeywordSpend`, `getClientConversionDiagnostics`), `lib/ads/diagnostics.ts` (`getClientAdsDiagnostics`, `buildDiagnosticIssues`) | Collecte de preuves Ads |
| Surveillance de site | `lib/monitoring/run.ts`, `lib/monitoring/evaluate.ts` | Collecte de preuves site |
| SEO / Search Console | `lib/seo/*`, `lib/integrations/search-console/*` | Collecte de preuves SEO |
| Actions validées | `public.actions`, `lib/actions/data.ts` (statuts `pending_approval` → `approved` → `executed`) | Les corrections proposées deviennent des actions à approuver |
| Notifications admin | `public.admin_notifications` (clé d'événement idempotente) | « Mission en attente de validation », « Mission terminée » |
| Fournisseur IA | `lib/ai/providers.ts` | Planification et synthèse (sortie structurée validée par zod) |

⚠️ Lectures Google Ads dans un job (pas de session navigateur) : `getClientConversionDiagnostics` et
`getClientKeywordSpend` appellent `requireAdmin()` et `createGoogleAdsReadClient()` exige une session admin par
défaut ; ils sont donc **inutilisables tels quels** dans `mission.step`. Le job existant `ads.monitor`
(`lib/ads/run.ts`) lit via `lib/providers/google-ads` (`campaignMetrics`) sans session : s'en inspirer. Pour les
diagnostics de conversion et les termes de recherche, ajouter des variantes « système » qui reçoivent un acteur
système vérifié (passer `authorize` explicitement à `createGoogleAdsReadClient`), sans affaiblir les versions admin.

## 3. Modèle de données (migration `…_missions.sql`)

```sql
create table public.missions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  kind text not null check (kind ~ '^[a-z][a-z0-9_.]{1,60}$'),          -- ex. 'ads.calls_diagnosis'
  title text not null check (char_length(title) between 3 and 200),
  objective text not null check (char_length(objective) between 3 and 2000),
  status text not null default 'planned'
    check (status in ('planned','running','waiting_approval','waiting_data','succeeded','failed','cancelled')),
  plan_version integer not null default 1,
  created_by text not null check (created_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
  report jsonb,                                                            -- compte rendu final (faits + preuves)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create table public.mission_steps (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  position integer not null check (position between 1 and 50),
  step_type text not null check (step_type ~ '^[a-z][a-z0-9_.]{1,60}$'),  -- clé du registre d'étapes
  input jsonb not null default '{}' check (jsonb_typeof(input)='object' and pg_column_size(input) <= 16384),
  status text not null default 'pending'
    check (status in ('pending','queued','running','waiting_approval','succeeded','failed','skipped','cancelled')),
  requires_approval boolean not null default false,
  approved_by text, approved_at timestamptz, approval_hash text,          -- hash de l'input approuvé
  output jsonb, evidence jsonb not null default '[]'::jsonb,               -- sorties + preuves (source, date, valeur)
  job_id uuid references public.jobs(id) on delete set null,
  attempts integer not null default 0, last_error text check (last_error is null or char_length(last_error) <= 2000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (mission_id, position)
);
create table public.mission_events (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  step_id uuid references public.mission_steps(id) on delete cascade,
  actor_type text not null check (actor_type in ('admin','system')),
  actor_id text, action text not null check (action ~ '^mission[._][a-z0-9_.]{1,100}$'),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
```

- RLS activée, aucun grant `anon`/`authenticated` ; `service_role` uniquement via RPC.
- Index : `missions(client_id, created_at desc)`, `mission_steps(mission_id, position)`, partiel
  `missions(status) where status in ('running','waiting_approval','waiting_data')`.
- Unicité anti-doublon : une seule mission active par `(client_id, kind)` (index unique partiel sur les statuts
  actifs) — même logique que P1-04.
- Garde-fou par trigger : transitions de statut autorisées uniquement (table de transitions ci-dessous),
  `input` d'une étape **immuable** une fois `queued` ; une étape `requires_approval` ne peut passer `queued` que
  si `approved_by`, `approved_at` et `approval_hash = encode(sha256(input::text::bytea),'hex')` sont présents.

### RPC (toutes `security invoker`, `service_role` seulement, ligne + `mission_events` dans la même transaction)

| RPC | Rôle |
|---|---|
| `mission_create(p_client_id, p_project_id, p_kind, p_title, p_objective, p_steps jsonb, p_actor_id)` | Crée la mission et ses étapes (plan validé côté serveur), événement `mission.created` |
| `mission_step_enqueue(p_step_id, p_actor)` | `pending → queued`, insère le job `mission.step` (clé d'idempotence `mission-step:<step_id>:<attempt>`), lie `job_id` |
| `mission_step_complete(p_step_id, p_job_id, p_worker, p_status, p_output, p_evidence, p_error)` | Clôture **fencée** (vérifie que le job appartient bien au worker courant), écrit sortie + preuves, événement |
| `mission_step_approve(p_step_id, p_expected_hash, p_actor_id)` | Validation humaine liée au contenu exact (hash), une seule fois |
| `mission_advance(p_mission_id)` | Calcule l'étape suivante (première `pending` dont les précédentes sont `succeeded`/`skipped`), met la mission en `waiting_approval` si elle exige une validation, `succeeded` si tout est fini |
| `mission_cancel(p_mission_id, p_actor_id)` | Annule la mission, les étapes non terminées et leurs jobs en attente |

### Transitions

- Mission : `planned → running → (waiting_approval | waiting_data) ⇄ running → succeeded | failed | cancelled`.
- Étape : `pending → queued → running → succeeded | failed | skipped` ; `pending → waiting_approval → queued`
  (après `mission_step_approve`) ; toute étape non terminée → `cancelled`.

## 4. Code applicatif (`lib/missions/`)

```
lib/missions/
  types.ts            # MissionKind, StepType, statuts, schémas zod des inputs/outputs de chaque étape
  registry.ts         # registre des étapes : { type, label, capability, agentType, requiresApproval, run(ctx) }
  kinds/ads-calls-diagnosis.ts   # gabarit de plan de la mission Jrenov (section 5)
  planner.ts          # transforme kind + objectif en plan borné (gabarit déterministe ; IA facultative, validée par zod)
  service.ts          # createMission, approveStep, cancelMission, getMission, listMissions (admin, RPC)
  runner.ts           # handler du run type 'mission.step' : charge l'étape, exécute, appelle mission_step_complete puis mission_advance
  evidence.ts         # format commun des preuves { source, collected_at, value, unavailable? } + fraîcheur
  report.ts           # compte rendu final : faits (avec preuves), hypothèses (marquées comme telles), actions proposées
```

- `lib/runs/handlers.ts` : ajouter `"mission.step": async () => (await import("@/lib/missions/runner")).runMissionStep`.
- `lib/agents/registry.ts` : ajouter le `RunType` `mission.step` (scope `client`) et une capacité
  `run_mission_step` (permission `prepare`, sans effet externe). Les étapes à effet externe ne s'exécutent
  **jamais** dans `mission.step` : elles créent une **action** (`public.actions`, `pending_approval`) qu'un humain
  approuve, puis l'exécution passe par le circuit d'actions existant.
- Chaque étape : timeout (`RUN_TIMEOUT_MS`), entrée/sortie validées par zod, erreurs réseau → `RunError`
  réessayable, données manquantes → étape `succeeded` avec preuve `unavailable` (jamais d'invention).
- Planification : **commencer par un gabarit déterministe** par type de mission (section 5). L'IA n'est utilisée
  que pour la synthèse finale (`report.ts`), avec sortie structurée et contrôle « pas de chiffre absent des preuves »
  (s'inspirer de `validateAdsAIOutput` dans `lib/integrations/google-ads/ai-analysis.ts`).

## 5. Première mission : `ads.calls_diagnosis` (Jrenov)

Objectif type : « Analyse pourquoi Jrenov reçoit si peu d'appels malgré les dépenses Google Ads ; identifie les
problèmes et prépare les corrections. »

| # | Étape (`step_type`) | Données / modules | Validation | Sortie |
|---|---|---|---|---|
| 1 | `ads.collect_performance` | campagnes 30 j + période précédente (`lib/integrations/google-ads`), coûts, clics, conversions | auto | métriques + preuves |
| 2 | `ads.collect_conversions` | `getClientConversionDiagnostics` : actions de conversion d'appel, statut, dernières conversions | auto | état du suivi d'appels |
| 3 | `ads.collect_search_terms` | `getClientKeywordSpend` : termes coûteux sans conversion | auto | liste bornée (≤ 50) |
| 4 | `site.collect_signals` | `lib/monitoring` : site joignable, temps de réponse, présence du numéro / formulaire | auto | signaux site |
| 5 | `mission.cross_check` | règles déterministes : distinguer **défaut de mesure** (pas de conversion d'appel active), **ciblage** (termes non pertinents), **site** (indisponible/lent) | auto | constats classés, chacun relié à ses preuves ; une hypothèse n'est jamais présentée comme cause démontrée |
| 6 | `mission.propose_actions` | crée des **actions** `pending_approval` (ex. mots-clés négatifs via `previewNegativeKeyword`, tâche « vérifier la conversion d'appel ») | **humaine** (une par action) | ids d'actions |
| 7 | `mission.report` | synthèse (IA facultative, contrôlée) | auto | `missions.report` + notification |
| 8 | `mission.follow_up` (programmée J+14) | relit les métriques après les actions exécutées ; compare sans attribuer automatiquement la variation | auto | addendum au rapport |

Notes :
- Les mutations Google Ads réelles restent **désactivées** (`applyApprovedNegativeKeyword` lève volontairement) :
  l'étape 6 ne fait que proposer ; elle n'exécute rien.
- Le client Jrenov et son compte Google Ads sont déjà configurés dans CODE-V OS ; ne pas coder d'identifiant en dur,
  la mission prend `client_id` en paramètre.

## 6. Interface (français)

- Fiche client → nouvel onglet **Missions** : liste (statut, date, titre), bouton « Nouvelle mission » (choix du
  type, objectif prérempli).
- Page mission `/missions/[id]` : chronologie des étapes (statut, durée, preuves dépliables), bloc
  **« À valider »** (contenu exact + justification + bouton « Approuver » qui envoie le hash attendu), compte rendu.
- Directeur IA / assistant : outil `mission_create` (proposition → confirmation, comme les autres outils
  d'écriture de `lib/assistant/tools.ts`) et `mission_status`. Ne pas augmenter `MAX_ROUNDS` : la mission
  tourne en arrière-plan, l'assistant ne fait que créer et consulter.
- Notifications : `admin_notifications` avec clés `mission-approval:<step_id>`, `mission-done:<mission_id>`.

## 7. Découpage en PR (une PR par lot, CI verte, migration appliquée après CI)

| Lot | Contenu | Critères d'acceptation |
|---|---|---|
| M1 | Migration tables + RPC + triggers de transition + test SQL `supabase/tests/missions.sql` | transitions interdites refusées ; approbation liée au hash ; une seule mission active par (client, kind) ; clôture fencée refusée pour un autre worker ; tout événement écrit dans la même transaction |
| M2 | `lib/missions/{types,registry,service,runner,evidence}.ts`, run type `mission.step`, handler | reprise après coupure (job relancé après expiration du bail ne rejoue pas une étape `succeeded`) ; donnée indisponible → preuve `unavailable` ; erreurs réseau réessayées, erreurs de validation non |
| M3 | Gabarit `ads.calls_diagnosis` (étapes 1–5 et 7) + tests avec doubles des intégrations | mission complète sur données simulées ; aucun chiffre du rapport absent des preuves |
| M4 | Étape 6 (actions proposées) + validation humaine + UI Missions + notifications | aucune action exécutée sans approbation ; approbation d'un contenu modifié refusée |
| M5 | Outils assistant `mission_create` / `mission_status` + étape 8 de suivi programmée | l'assistant propose puis crée après confirmation ; suivi J+14 programmé une seule fois |

## 8. Tests à écrire (minimum)

- SQL (`supabase/tests/missions.sql`) : droits (anon/authenticated sans accès), transitions, hash d'approbation,
  unicité de mission active, fencing, atomicité ligne + événement (échec de l'événement ⇒ rien d'écrit).
- Concurrence (`tests/codev-core-db.test.mjs`, modèle « concurrent workers never claim the same job ») : deux
  workers ne peuvent pas exécuter la même étape.
- Node : registre d'étapes fermé (type inconnu refusé), validation zod des entrées/sorties, runner (succès,
  échec réessayable, échec définitif, donnée indisponible), rapport sans invention, services admin d'abord
  (`requireAdmin` avant tout accès), simulation = aucune écriture.

## 9. État du projet au moment du passage de relais (28/10/2026)

- Fusionné récemment : #108 (écran de validation TikTok), #109 (TikTok dans agent/config/supervision),
  #110 (validation automatique des publications, activée 12 h pour les 6 clients, jamais TikTok),
  #111/#112 (images manuelles converties en JPEG, ≤ 1080 px de large), #113 (audit P1-03/P1-04 corrigés).
- TikTok : application « CODE-V OS » **en revue** chez TikTok (soumise le 28/10). Vercel utilise encore les clés
  **Sandbox** ; ne passer aux clés Production qu'après validation. Créneaux TikTok de test désactivés.
- Nouveau client « Simplement Monica Institut » (institut de beauté, Perpignan) : fiche, dossier Drive et numéro
  WhatsApp rattachés ; pas encore de réseaux sociaux (Adrien doit les créer).
- 4 brouillons sans photo (Express Nuisibles jeudi, Protection Nuisibles vendredi) attendent des photos.
- Environnement de l'agent précédent : dépendances locales indisponibles ; la CI est la référence.
