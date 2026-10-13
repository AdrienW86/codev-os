# Publications — simulation complète du pipeline (PR #44)

Outil **administrateur** pour voir, de bout en bout et sans risque, ce que ferait l'application pour un client :
photo → analyse IA → choix éditorial → déclinaisons → brouillon → approbation simulée → créneau → diffusion simulée.

Accès : **Paramètres → Simulation UX**, section « Simulation du pipeline Publications » (même page que le Scenario
Lab existant, protégée par `requireAdmin()`). Aucune migration : tout se passe en mémoire, le temps d'une requête.

## Garanties

- **Aucune écriture en base** : le module `lib/publications/simulation/**` n'a aucun client Supabase, aucun `.rpc(`,
  aucun `.from(`. Rien n'est écrit dans les publications, diffusions, tentatives, jobs, usages de photos ou
  notifications ; aucun « succès » n'apparaît dans l'historique réel de diffusion.
- **Aucun appel aux API de publication** : les publishers Meta / Google, le registre de production et le moteur
  `executeClaimedPublicationJob` ne sont jamais chargés (test du graphe de modules). Le publisher est toujours simulé
  et ne renvoie que des identifiants `simulated-…`, que la normalisation du moteur refuse d'enregistrer comme « publiée ».
- **Modèle IA simulé par défaut**, déterministe. L'option « Rédaction par l'IA réelle » n'est proposée que si une clé
  serveur existe ; elle ne concerne que la rédaction, sur les données fictives du scénario. L'analyse des photos reste
  toujours simulée (les fixtures n'ont pas de vraie image).
- Les garde-fous réels (arrêt d'urgence, `PUBLICATIONS_SCHEDULED_DELIVERY`, approbation humaine) ne sont **ni lus ni
  modifiés** ; le rapport le rappelle explicitement.

## Règles réellement appliquées

La simulation n'a pas de logique métier propre : elle appelle les fonctions pures existantes avec des adaptateurs simulés.

| Étape | Fonction réelle |
| --- | --- |
| Analyse des photos | `classificationInstructions`, `classificationContext`, `classificationSchema`, `normalizeAssessment` (`lib/media-intelligence/model.ts`) |
| Photos candidates | `libraryCandidates`, `isPublicationCandidate` (`agent-v2/library-pool.ts`) |
| Créneaux | `normalizeScheduleSlots`, `sortScheduleSlots`, `localInstant`, puis `futureOccurrences` / `selectIdeaBatch` (Agent v2) |
| Rédaction | contrat `PublicationsAgentV2Generator` (mock, ou `openaiAgentV2Generator` sur option) |
| Validation | `validateGeneratorOutput` (anti-invention, rotation `repeatsService`, répétition, règles des plateformes, photo autorisée) |
| Déclinaisons | `PLATFORM_TEXT_RULES`, `platformRuleViolation` |
| Brouillon / approbation | `canTransitionPublication`, `approvalMatchesRevision`, `channelsWithoutMedia`, `missingMediaMessage` |
| Diffusion | `getChannelPublishability`, contrat `PublicationPublisher`, `outcomeOf`, `outcomePayload`, `nextRetryDelaySeconds`, `canTransition` |

Le contexte de rédaction a la même forme que `loadAgentV2Context` (faits stockés, 3 dernières publications, thèmes
prioritaires, jamais de légende d'expéditeur). Les améliorations éditoriales de l'Agent v2 (PR #42 : historique,
rotation, justification) s'appliquent donc automatiquement à la simulation après fusion.

Le moteur de diffusion n'est volontairement pas branché (garde P10 : il n'est jamais câblé à l'application) ; sa chaîne
de décision est rejouée avec ses fonctions pures, et le statut final suit la même table que `publication_job_complete`
(`completedStatus` : simulée, nouvelle tentative, échec, bloquée, incertaine — jamais « publiée »).

## Scénarios prêts (fictifs)

| Scénario | Ce qu'il montre | Diffusion par défaut |
| --- | --- | --- |
| CODE-V — parcours nominal | Photo de maquettes retenue ; écran (confidentiel) et photo floue écartés | Succès partout |
| JRenov — diffusion contrastée | Visage écarté, photo d'une publication récente écartée | Facebook succès, Instagram refusé, Google indisponible |
| Couverture Catalane — rotation | 3 démoussages récents : le 4ᵉ est refusé (`repetition`), relance sur le faîtage acceptée | Google : connexion expirée (bloquée avant envoi) |
| Protection Nuisibles — **négatif** | Facture jugée « pertinente » par le modèle simulé, forcée confidentielle par la règle ; proposée quand même au 1ᵉʳ essai, refusée (`invalid_media`) ; aucune photo → « Photo manquante », approbation impossible | Aucune diffusion |

Les résultats de diffusion sont modifiables pour chaque plateforme : succès, refusée par la plateforme, connexion
expirée, plateforme indisponible.

Le modèle de rédaction simulé suit les consignes de l'Agent v2 ; au premier essai, un scénario peut lui faire commettre
une erreur typique (reprendre la même prestation, choisir une photo interdite) pour montrer le garde-fou. Une seule
relance est simulée, comme l'administrateur le ferait après un refus.

## Rapport

Photos analysées (avis du modèle, verdict après règles, motif d'exclusion), photo retenue et raison, sujet choisi,
historique pris en compte, essais du modèle, déclinaisons Facebook / Instagram / Google Business Profile avec longueur
et hashtags, validations requises, créneaux planifiés, résultat simulé par plateforme (statut, motif, prochaine
tentative).

## Fichiers

- `lib/publications/simulation/model.ts` — types, libellés, lecture du formulaire (client-safe).
- `lib/publications/simulation/fixtures.ts` — les quatre scénarios fictifs.
- `lib/publications/simulation/adapters.ts` — vision, rédaction et publisher simulés.
- `lib/publications/simulation/runner.ts` — `runPublicationSimulation`, `completedStatus`, `simulatedOccurrences`.
- `app/(cockpit)/settings/simulation/actions.ts` — action serveur (admin d'abord).
- `components/simulation/publication-pipeline-lab.tsx` — formulaire et rapport (reçoit l'action en propriété).
- `tests/publications-simulation.test.mjs` — 11 tests (scénarios, isolement, action, interface).

## Décisions prudentes

- Pas de migration ni de table de simulation : aucune persistance du rapport (relancer la simulation suffit).
- Connexion expirée : traitée par la publiabilité du canal (bloquée avant tout envoi), comme le ferait la préparation réelle.
- Un publisher simulé qui prétendrait « publier » est requalifié « incertain » : jamais de faux succès réel.
