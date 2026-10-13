# Tableau de supervision des publications (socle Publications, lot 7)

Page : **Publications → Supervision** (`/publications/supervision`), réservée à l'administrateur.

## Ce qu'elle montre

- **Synthèse** : publications à valider, programmées, publiées (30 jours), en erreur ; comptes connectés et à reconnecter. Les interrupteurs globaux sont rappelés : arrêt d'urgence, préparation automatique, diffusion.
- **À valider** : les 5 premières cartes de la file de validation existante, et un lien vers la file complète.
- **En erreur** : diffusions en échec, bloquées, à réessayer ou à vérifier. La relance et la vérification restent sur la fiche de la publication.
- **Programmées** : créneaux à venir, avec l'état de la publication et de sa diffusion.
- **Publiées récemment** : diffusions confirmées par la plateforme (identifiant distant).
- **Clients**, pour chaque client concerné par les Publications :
  - ses comptes, connectés ou **à reconnecter** (connexion expirée, révoquée ou inactive ; compte indisponible ou désactivé) ;
  - sa photothèque : photos disponibles, à revoir et rejetées ;
  - l'alerte **« Trop peu de photos »** sous 6 photos disponibles ;
  - son mode de préparation.
  - « Disponibles » applique exactement les règles de sélection de l'agent (lots 4-5). Le compte est plafonné à 30.
- **Prochaines tâches de l'agent** : créneaux vides des 14 prochains jours, avec la date de préparation (créneau − avance du client) ou « En attente de Générer maintenant ».

Aucun secret n'est lu : ni référence de coffre ni jeton, seulement les statuts et dates d'expiration.

## Actions

| Action | Effet | Chemin |
| --- | --- | --- |
| Approuver / Refuser / Modifier (carte) | Décision sur la version actuelle ; une modification crée une version soumise à validation | Cartes de validation existantes |
| Modifier (programmée) | Ouvre l'éditeur ; une modification après approbation repasse en brouillon et bloque la diffusion | Éditeur existant |
| Générer maintenant | Agent v2 sur le projet, avec autorisation explicite de l'appel IA ; brouillons seulement | Formulaire Agent v2 existant |
| Reprogrammer | Nouvelle publication sur un créneau libre (même projet et plateforme, 4 semaines). L'ancienne est archivée. **L'approbation est remise à zéro** | `publication_reschedule` (nouvelle RPC) |
| Suspendre (publication) | Annule les diffusions pas encore envoyées. Le planificateur ne les recrée pas pour cette révision | `publication_delivery_cancel` (existante) |
| Suspendre la préparation (client) | Coupe la préparation automatique du client, sans toucher ses autres réglages ; reprise depuis la fiche client | `publication_client_settings_save` (existante) |

Aucune action de cette page ne publie. La diffusion reste celle du lot 6 : approbation humaine, interrupteurs, `PUBLICATIONS_SCHEDULED_DELIVERY`.

## Reprogrammer : règles serveur

Les liaisons créneau ↔ publication restent immuables. Comme la planification d'un brouillon (#34), la fonction crée une **nouvelle** publication sur le créneau choisi, avec la logique de création unique, le même texte et les mêmes médias. L'ancienne publication est archivée : elle reste consultable, son créneau reste consommé, et le journal fait le lien (`publication.rescheduled`).

**Refusé** :
- une publication refusée ou archivée ;
- une révision obsolète (`40001`) ;
- un créneau d'une autre plateforme ou d'un autre projet, le même créneau, un créneau passé, ignoré ou pris ;
- une diffusion en cours, envoyée ou à vérifier (aucun double envoi possible).

**Approbation** :
- une publication approuvée ou en attente repasse « À valider » ;
- un brouillon reste brouillon ;
- les diffusions non envoyées sont annulées, avec leurs jobs.

## Migration

`supabase/migrations/20261031000000_publications_supervision.sql` (**non appliquée**) ajoute uniquement `publication_reschedule`. La fonction est réservée au serveur (invoker, `search_path` fixe) et ne crée ni ne modifie aucune table.

**Ordre** : après `20261027000000` (#36), `20261028000000` (#37), `20261029000000` (#38) et `20261030000000` (#39). Vérifier d'abord `supabase_migrations.schema_migrations`, puis appliquer après accord.

Aucune nouvelle variable d'environnement.

## Tests

- `tests/publications-supervision.test.mjs` couvre :
  - l'état des comptes, les compteurs de photos et l'alerte, les tâches et créneaux proposés, l'état de diffusion ;
  - la lecture : compteurs, sections, aucune écriture ni secret ;
  - les actions : RPC, messages et entrées invalides ;
  - le câblage de la page et des jetons de design.
- `supabase/tests/publications-supervision-after-delivery-engine.sql` (via `tests/publications-scheduled-flow-db.test.mjs`) s'exécute sur de vraies diffusions du moteur P10. Il vérifie :
  - l'annulation de la diffusion et du job ;
  - l'archivage et la nouvelle liaison ;
  - les mêmes texte et médias ;
  - l'approbation remise à zéro, puis une nouvelle diffusion à l'heure du nouveau créneau après nouvelle approbation ;
  - les refus (révision obsolète, créneau invalide ou pris, publication refusée, diffusion à vérifier) et les droits.

## Limites

- Lecture bornée : 500 publications non archivées, 5 000 photos et 2 000 créneaux sur une fenêtre de −30 à +28 jours. C'est suffisant pour le portefeuille actuel.
- Le créneau quitté reste consommé par la publication archivée : l'agent ne le reprépare pas.
- Un ancien média d'agent encore en cours d'attache sur la publication archivée ne la suit pas : la nouvelle publication garde les médias déjà attachés.

## Compléments (revue du lot 7)

### Reprogrammer et photothèque

- **Photo de la photothèque** : si une photo attachée provient de la photothèque du client (historique `whatsapp_asset_uses`), elle doit être encore publiable (`publications_private.library_asset_publishable`, lot 4-5). Sinon refus `23514` « Library photo no longer publishable ». L'interface affiche « Une photo de la photothèque n’est plus publiable… ». Rien n'est modifié.
- **Historique** : une ligne `whatsapp_asset_uses` est ajoutée pour la nouvelle publication (même photo, même fichier privé). L'ancienne ligne est conservée.
- **« À valider »** : une publication qui repasse en attente crée la notification `publication_review` vers `/publications/review`. Elle est idempotente (`event_key` `publication-review:<nouvelle publication>`), sans texte ni nom de client. Un brouillon n'en crée pas.
- **Groupe éditorial : non repris.** L'index unique (groupe, plateforme) est déjà occupé par l'ancienne publication archivée, et sa liaison est immuable. Rattacher la nouvelle demanderait de modifier le socle. Elle est donc créée sans groupe.

### Supervision

- Bandeau des interrupteurs : arrêt d'urgence, automatisation, génération, diffusion, et **diffusion automatique à l'heure prévue** (`PUBLICATIONS_SCHEDULED_DELIVERY`). La page lit cette variable via `isFlagEnabled` (`lib/system/providers.ts`) et la transmet à `getSupervision(now, { scheduledDelivery })` ; `lib/publications` ne lit jamais l'environnement.
- **En erreur** inclut les publications approuvées dont le créneau est passé sans aucune diffusion (« Créneau manqué »).
- Chaque ligne en erreur affiche sa raison sûre, la même que sur la fiche : classe d'erreur et code court, ou motif de blocage (`deliveryErrorReason`, à partir de `deliveryView`).
- L'en-tête comporte un lien vers le diagnostic technique.

### Diagnostic technique (`/settings/diagnostic`)

Page admin (`requireAdmin`), en lecture seule. On y accède depuis Paramètres › Observabilité et depuis l'en-tête de la supervision. Le module serveur `lib/system/diagnostic.ts` contient une fonction par section. Chaque section échoue seule et s'affiche alors « indisponible » :

| Section | Contenu |
| --- | --- |
| Planificateur | Interrupteurs de publication, drapeau de diffusion automatique, cron configuré, dernier job planifié, battement (voir ci-dessous) |
| Agent Publications | 5 derniers runs v2 (client, statut, erreur, média, coût, dates), échecs sur 7 jours, dernières préparations planifiées (`audit_logs`) |
| Validation | Nombre de publications à valider et lien vers la file |
| Ingestion WhatsApp | Échecs, abandons après 5 tentatives, traitements bloqués, avec libellés français (`inboxErrorLabel`) |
| Connexions et diffusion | Connexions expirées, en erreur ou révoquées (jamais le texte de `last_error` ni de référence), échecs OAuth sur 7 jours, diffusions en échec, bloquées, à réessayer ou à vérifier |
| Tâches bloquées | Bail expiré : `jobs`, `publication_jobs`, runs Agent v2, `whatsapp_inbox` |
| Variables | Présence par module (configuré oui / non) et interrupteurs (activé / désactivé), jamais une valeur ni une longueur |

`lib/system/providers.ts` gagne :
- les entrées `credentials`, `google-drive-import`, `whatsapp-webhook`, `whatsapp-ingestion` et `push` ;
- `featureFlags` et `isFlagEnabled` (`PUBLICATIONS_SCHEDULED_DELIVERY=enabled`, `WHATSAPP_INGESTION_ENABLED`, `PUSH_SENDING_ENABLED`, `EMAIL_SENDING_ENABLED` : `true`).

Aucun interrupteur n'est activé par défaut.

**Battement du planificateur (lot #39)** : la section accepte un chargeur `HeartbeatLoader` (paramètre `heartbeat` de `getDiagnostic`, valeur par défaut `loadSchedulerHeartbeat`, `null` dans ce lot). Pour le brancher, définir `loadSchedulerHeartbeat` dans `lib/system/diagnostic.ts`. Il lit `public.scheduler_heartbeats` (`name='tick'` : `started_at, finished_at, ok, steps, last_success_at, last_failure_at`). `heartbeatView` normalise déjà la ligne (noms d'étapes en échec uniquement) et la page l'affiche.

### Retouches d'interface

- Statuts du tableau en jetons (`warning`, `success`, `danger`, `info`).
- Origine, plateforme, projet et place dans la semaine en libellés.
- Déconnexion repliée dans `<details>`, avec un lien vers Paramètres › Connexions quand OAuth n'est pas configuré.
- Filtres avancés repliés sur mobile.
- Fuseaux horaires lisibles (« Paris (France) »).
- Une ligne « Diffusion : active / bloquée — raison » par canal.
- « Ouvrir le dossier Drive » au lieu d'identifiants tronqués.
- Codes d'échec WhatsApp traduits.

Tests ajoutés :
- `tests/system-diagnostic.test.mjs` ;
- des compléments dans `tests/publications-supervision.test.mjs` ;
- la section 5 de la suite SQL ;
- les notifications des sections 2 et 3.
