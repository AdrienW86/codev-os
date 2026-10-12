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
