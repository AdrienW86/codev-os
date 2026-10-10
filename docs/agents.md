# Agents — registre, capacités, permissions

Source unique : [`lib/agents/registry.ts`](../lib/agents/registry.ts). Ajouter un agent, une capacité ou un type d’exécution = **une entrée dans le registre** (+ un handler dans `lib/runs/handlers.ts` pour un nouveau type d’exécution). Aucun `if (agent === …)` ailleurs dans le code.

## Trois questions distinctes

| Question | Où | Exemple |
| --- | --- | --- |
| **Que SAIT faire l’agent ?** | `agentDefinitions[type].capabilities` | L’Agent Google Ads sait `read_campaigns`, `detect_ads_anomalies`, `propose_ads_optimization`, `modify_campaign`. |
| **A-t-il le DROIT ?** | `lib/permissions/engine.ts` → `authorize()` | Agent activé et « Actif », fournisseurs configurés, pas d’écriture en simulation. |
| **Son AUTONOMIE le permet-elle ?** | `authorize()` → `mode` | Lecture / préparation : automatiques. Exécution : **toujours `approval_required` en V1** (autonomie plafonnée à 1, `V1_MAX_AUTONOMY`). Tout effet externe (`externalEffect`) exige une validation humaine, quelle que soit l’autonomie. |

Refus possibles : `unknown_capability`, `not_capable`, `agent_disabled`, `simulation`, `provider_not_configured` (avec la liste des connexions manquantes).

## Agents V1

| Agent | Type | Portée | Services | Par défaut | Exécutions planifiables |
| --- | --- | --- | --- | --- | --- |
| Agent Rapport | `report` | client | reporting (+ **rattaché d’office à tous les clients actifs**) | Actif, autonomie 0 | `report.generate` |
| Agent Veille | `veille` | global | — | Actif, autonomie 0 | `news.fetch` |
| Agent SEO & Site | `seo` | client, projet | seo | **En pause** | `seo.analyze` |
| Agent Google Ads | `google-ads` | client | google-ads | **En pause**, lecture seule | `ads.monitor` |
| Agent Monitoring Technique | `monitoring` | client, projet | maintenance, website | **En pause** | `monitoring.check_sites` |
| Agent Publications | `publications` | projet | social | moteur Publications existant (inchangé) | — |
| Agent Automatisation | `automation` | client | automation | **En pause** | — |

Aucun agent n’est créé ni activé au niveau 2 ou 3. Les agents en pause s’activent depuis /agents.

## Services → Agents

`client_services.service_key` + `lifecycle` (`active`, `to_configure`, `paused`, `ended`). Activer un service rattache les agents correspondants au client (`agent_client_assignments.source = 'service'`) ; le désactiver les détache pour ce client **sans supprimer l’historique**. L’Agent Rapport est rattaché à tous les clients actifs (`source = 'global'`), à la création du client et à chaque passage du planificateur.

## Sorties d’un agent

Un agent ne produit jamais d’effet externe directement. Il écrit (via `lib/agents/outputs.ts`, acteur explicite) :

- `agent_runs` : trace d’exécution ;
- `recommendations` : constat + justification (dédupliquées tant qu’elles sont en attente) ;
- `actions` : proposition **à valider** (`pending_approval`), payload validé par le registre des actions (zod strict) ;
- `incidents` : dédupliqués par empreinte tant qu’ils sont ouverts, résolus automatiquement quand le problème disparaît ; un nouvel incident est ouvert s’il revient ;
- `metric_snapshots`, `site_checks`, `news_items`, `reports`.

## Cycle de vie d’une action

```
PREPARED (draft) → PENDING_APPROVAL → APPROVED → EXECUTING → SUCCEEDED (executed) | FAILED | UNCERTAIN
                         ↘ REJECTED / CANCELLED
```

- À l’approbation, la base calcule et **fige** l’empreinte SHA-256 du payload (`approved_payload_hash`). Toute modification ultérieure du payload est refusée par un trigger (`55000`) ; `executing` n’est possible que depuis `approved` avec une empreinte inchangée.
- Types : `internal.test` (exécution interne, sans effet externe) ; `seo.site_change`, `ads.optimization`, `monitoring.fix`, `report.send` en **mode manuel** : CODE-V OS ne les exécute pas, l’administrateur les réalise puis confirme (« Marquer comme réalisée »).
- Journal : qui (acteur), quoi, quand, client, projet, agent, empreinte du payload, résultat.

## Assistant

Les outils de l’assistant (`lib/assistant/tools.ts`) passent par le même moteur de permissions. Lectures exécutées directement ; écritures **proposées** puis confirmées par l’administrateur dans une requête distincte. Voir [architecture.md](architecture.md#assistant).
