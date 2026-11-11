# Organisation harness des agents

Objectif : CODE-V OS fonctionne comme une agence autonome, chaque agent étant un expert cantonné à sa mission, sous le contrôle d’un chef de projet par client.

## Les briques

| Brique | Fichier | Rôle |
| --- | --- | --- |
| Charte des agents | `lib/harness/charter.ts` | Mission, niveau d’expertise, périmètre, interdits, déclencheurs et lieu des réglages client de chaque agent. Source unique. |
| Cadre de mission | `withCharter()` | Ajouté en tête de chaque appel IA (Publications, Blog, Visuels, Vidéo, Photothèque, Google Ads, SEO) : rester dans sa mission, ne jamais inventer, ne jamais exécuter une action non demandée. |
| Supervision | `lib/agents/coverage.ts` | Un agent actif sans exécution planifiée est signalé (/agents, accueil) ; les planifications manquantes se créent en un clic, rien n’est réactivé sans l’administrateur. |
| Santé de l’équipe | `lib/harness/health.ts` | État réel de chaque agent d’après le dernier passage du planificateur et les derniers jobs. Jamais « opérationnel » sans preuve. |
| Chef de projet | `lib/harness/client-plan.ts` | Par client : agents attendus selon les services souscrits, ce qui travaille, ce qui est à régler, ce qui attend l’administrateur (fiche client → Agents). |

## Équipes

Pilotage (Chef de projet, Rapport) · Contenu (Publications, Blog, Visuels, Vidéo, Photothèque) · Site et SEO (SEO, Monitoring) · Publicité (Google Ads) · Prospection · Veille.

L’ancien « Agent Automatisation » n’a jamais eu d’exécution : il n’a pas de charte.

## Réparer plutôt que jeter (Agent Publications)

Une phrase (hors accroche) portant une formulation récurrente ou un terme non confirmé est retirée si le texte garde deux phrases et 60 % de sa longueur. Rien n’est ajouté ni reformulé ; sinon le refus habituel s’applique.

## Ajouter un agent

1. Une entrée dans `harnessCharters` (mission, interdits, déclencheur, réglages client).
2. Ses appels IA passent par `withCharter("<id>", instructions)`.
3. S’il dépend d’une exécution planifiée du registre, l’ajouter à `expectedSchedules` (`lib/agents/coverage.ts`).
4. Sa place dans `buildClientPlan` s’il dépend d’un service client.

## Chef d'orchestre : semaine et contrôle quotidien

- **Semaine du client** (`lib/harness/week-plan.ts`, fiche client → Agents) : les 7 prochains jours, jour par jour, à partir des seules échéances enregistrées (diffusions programmées, articles prévus, exécutions planifiées calculées avec leur récurrence). Les agents à cadence (Visuels, Vidéo, Photothèque) sont listés à part, sans date inventée.
- **Réglages par client** (`settingsOf` dans `lib/harness/client-plan.ts`) : chaque agent affiche ses réglages propres au client (créneaux, validation, cadence, rythme, budget IA, planifications). Rien n'est affiché pour un agent désactivé.
- **Contrôle quotidien** (`lib/harness/control.ts` + `control-service.ts`, étape `harness_control` du planificateur) : une fois par jour à partir de 7 h (Paris), pour chaque client ayant un service actif, chaque écart (agent à régler, semaine sans diffusion alors que la diffusion est active, blog sans article sur 14 jours) ouvre un incident interne `source = system`, empreinte `harness:<client>:<code>`. Un écart disparu est résolu automatiquement. Le contrôle n'active, ne publie et ne réactive rien. Bouton « Lancer le contrôle des clients » sur /agents.

## Budget IA par client

- **Passerelle mesurée** (`lib/ai/metered.ts`) : même signature que `structuredResponse`. Les agents Blog, Visuels et Vidéo travaillent dans un périmètre `withAiScope({ agent, clientId })`. Avant chaque appel, la dépense du mois du client est comparée au plafond (avec une marge de 0,02 €) ; au-delà, l'appel n'a pas lieu (`ai_budget_exceeded`). Chaque appel facturé est journalisé dans `ai_usage`.
- **Dépense du mois** : `ai_usage` + Publications (`agent_runs`) + Photothèque (`client_media_ai_month_spend`), en mois civil de Paris. Publications et Photothèque gardent aussi leur propre garde-fou.
- **Plafond** (`client_ai_budgets`, fiche client → Agents) : 5 € par mois par défaut, de 0 à 200 €. 0 coupe l'IA de ces agents pour le client.
- Migration `20261206000000_ai_usage_budget` à appliquer. Sans elle, rien n'est mesuré ni bloqué (comportement d'avant). Si la dépense est illisible, l'appel est refusé.
- Les assistants Google Ads et SEO (`lib/ai/providers.ts`) ne remontent pas leur consommation : ils ne sont pas comptés.
