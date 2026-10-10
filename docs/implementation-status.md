# État d’implémentation — CODE-V OS V1 (branche `feature/codev-os-functional-v1`)

Légende : **DONE** fonctionnel et testé · **PARTIAL** fonctionnel avec limites connues · **BLOCKED** dépend d’un élément externe · **MANUAL SETUP** action humaine requise · **NEXT** prochaine étape.

## Socle

| Domaine | État | Détail |
| --- | --- | --- |
| Migration noyau `20261015000000_codev_os_core.sql` | DONE (local) · MANUAL SETUP (distant) | Rejouée sur le schéma de production + toutes les migrations (`tests/codev-core-db.test.mjs`, 45+ contrôles SQL, concurrence 4 workers). **Non appliquée au projet distant** : voir l’ordre exact dans [setup.md](setup.md#3-migrations-ordre-exact). |
| Registre d’agents / capacités / types d’exécution | DONE | `lib/agents/registry.ts`, aucun branchement par nom d’agent. |
| Moteur de permissions (sait / droit / autonomie) | DONE | `lib/permissions/engine.ts`, autonomie plafonnée à 1, effets externes toujours validés. |
| Services ↔ Agents | DONE | Activation / désactivation réelles, historique conservé ; Agent Rapport attaché à tous les clients. |
| Garde de portée des sorties d’agents | DONE | Respecte la règle en base (`context_allowed`) : job client ignoré avec la raison si l’agent n’est pas rattaché ou est en portée projet. |
| Actions à empreinte figée | DONE | Trigger SHA-256 ; refus, annulation, exécution interne, réalisation manuelle confirmée. |
| Audit | DONE | Acteur explicite (admin / assistant / system), expurgation des secrets. |
| Simulation / Scenario Lab | DONE | Conservé ; toute écriture réelle refusée côté serveur pendant une simulation ; l’assistant ne lit rien de réel. |

## Fonctionnalités

| Module | État | Détail |
| --- | --- | --- |
| Planificateur (automations → jobs → exécution → audit) | DONE · MANUAL SETUP | Idempotent, SKIP LOCKED, bail + fencing, backoff, fuseaux IANA + heure d’été. Cron Vercel **documenté, non activé** ([automation.md](automation.md)). Requiert `CRON_SECRET`. |
| Paramètres → Automatisations | DONE | Modèles recommandés, création, pause / reprise / archivage, « Exécuter maintenant ». |
| Rapports | DONE | Génération versionnée, interne / client, approbation, édition (invalide l’approbation), archivage, envoi manuel consigné. Envoi e-mail : BLOCKED tant que Resend n’est pas configuré et `EMAIL_SENDING_ENABLED=true`. |
| Agenda | DONE | Éléments récurrents (DST), échéances des tâches, exécutions planifiées ; annulation sans suppression. |
| Travail | DONE | Tâches, recommandations, actions (approuver / refuser / réaliser), incidents (prise en charge / résolution). |
| Assistant | DONE (mode déterministe) · PARTIAL (mode IA) | Outils : urgences, clients à surveiller, point client, agenda du jour, actions à valider, rapports, veille (lecture) ; générer un rapport, lancer ou **planifier** une analyse, créer une tâche (écritures proposées puis confirmées). Mode IA testé avec fournisseurs simulés ; **non vérifié contre une vraie API** faute de clé (MANUAL SETUP : `OPENAI_API_KEY` ou `ANTHROPIC_API_KEY`). |
| Voix V1 | DONE (repli navigateur) · PARTIAL (transcription serveur) | Push-to-talk, annulation, erreurs explicites, lecture vocale. Transcription serveur nécessite `OPENAI_API_KEY`. |
| État du système / Observabilité | DONE | ✓ / ○ / ! par présence de variables (jamais de valeur), jobs, incidents, échecs, synchronisations. |
| Sources de données par client | DONE | Search Console, Vercel, GitHub (identifiants seulement) ; Google Ads via le panneau existant. |
| Veille tech & IA | DONE · MANUAL (réseau) | Pipeline complet, 3 actualités max sur l’accueil, exemples en repli. Dépend de l’accès sortant aux flux publics en production. |
| Agent Monitoring | DONE | Contrôles HTTP (SSRF bloqué), incidents dédupliqués, recommandation + action « Correctif technique » à valider. Vercel / GitHub : BLOCKED sans `VERCEL_TOKEN` / `GITHUB_TOKEN`. |
| Agent SEO | PARTIAL · BLOCKED | Analyse testée sur données simulées ; Search Console BLOCKED sans OAuth (`GOOGLE_SEARCH_CONSOLE_*`). PageSpeed fonctionne sans clé. |
| Agent Google Ads | PARTIAL · BLOCKED | Lecture seule, anomalies testées ; BLOCKED sans jeton développeur approuvé + OAuth. Aucune modification de campagne. |
| Agent Publications | DONE (existant) | Moteur Publications inchangé (kill switches, validation humaine). Intégration au planificateur : NEXT (aucun type d’exécution `publications.*` dans ce lot, volontairement). |
| Agent Automatisation | NEXT | Déclaré au registre, en pause, sans type d’exécution. |

## Intégrations externes

| Intégration | Codé | Testé | Variables | Configuration manuelle | Vérifier |
| --- | --- | --- | --- | --- | --- |
| Clerk | existant | oui | `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `AUTHORIZED_ADMIN_USER_ID` | identifiant admin | connexion → accueil |
| Supabase | oui | oui (local) | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` | appliquer 2 migrations | Paramètres → Automatisations sans bandeau « indisponible » |
| Planificateur | oui | oui (E2E tick 401/200) | `CRON_SECRET` | `vercel.json` (exemple dans automation.md) | Observabilité → « Dernier job planifié » |
| OpenAI | oui | simulé | `OPENAI_API_KEY` (+ modèles facultatifs) | — | réponse assistant sans « mode simplifié » |
| Anthropic | oui | simulé | `ANTHROPIC_API_KEY`, `AI_PROVIDER` | — | idem |
| Search Console | oui | simulé | `GOOGLE_SEARCH_CONSOLE_CLIENT_ID/SECRET/REFRESH_TOKEN` | OAuth `webmasters.readonly`, propriété par client | analyse SEO « N clics » |
| PageSpeed | oui | simulé | `PAGESPEED_API_KEY` (facultatif) | — | « PageSpeed mobile : N/100 » |
| Google Ads | oui (lecture) | simulé | `GOOGLE_ADS_CLIENT_ID/SECRET/REFRESH_TOKEN/DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | jeton développeur approuvé, scope `adwords`, identifiant client | veille Ads → métriques hebdomadaires |
| Vercel | oui (lecture) | simulé | `VERCEL_TOKEN`, `VERCEL_TEAM_ID` | projet par client | incident sur déploiement en échec |
| GitHub | oui (lecture) | simulé | `GITHUB_TOKEN` (lecture seule) | dépôt par client | métrique « recent_commits » |
| E-mail (Resend) | oui | simulé | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SENDING_ENABLED` | domaine vérifié | bouton « Envoyer par e-mail » |
| Meta / GBP / Drive | existant | existant | voir docs Publications | OAuth par projet | voir docs Publications |

Aucun callback OAuth nouveau n’est introduit : Search Console et Google Ads utilisent un jeton de rafraîchissement serveur ; les callbacks Publications existants (`/api/publications/oauth/*/callback`) sont inchangés.

## Tests

- `npm test` : unitaires, intégration (faux Supabase), sécurité (SSRF, rebinding DNS, origine, taille, débit, injection d’outil), chaos (401/403/404/429/5xx, délai, réseau, JSON invalide, panne partielle, épuisement des reprises, bail perdu, ticks concurrents).
- `CODEV_CORE_TEST_DATABASE_URL=… node --test tests/codev-core-db.test.mjs` : migration sur Postgres réel + concurrence.
- `node scripts/e2e.mjs` : parcours Playwright 1440 / 820 / 375 sur base réelle locale (voir l’en-tête du script).

## NEXT

1. Appliquer les deux migrations au projet distant (sauvegarde préalable).
2. Renseigner `CRON_SECRET`, puis activer le cron Vercel.
3. Ajouter une clé IA et vérifier l’assistant en mode IA.
4. Connecter Search Console / Google Ads / Vercel / GitHub selon les clients.
5. Types d’exécution `publications.prepare` (préparation planifiée via le moteur existant) et digest de veille hebdomadaire.
