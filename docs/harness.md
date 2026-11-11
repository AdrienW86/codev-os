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
