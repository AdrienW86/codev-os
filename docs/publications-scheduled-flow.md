# Préparation planifiée, validation et diffusion à l'heure prévue (socle Publications, lot 6)

## Parcours

1. **Préparer à l'avance.** À chaque passage du planificateur (`/api/internal/scheduler/tick`), `runScheduledPreparation` (`lib/publications/automation/scheduled.ts`) traite les clients dont la préparation automatique est activée (onglet Publications, lot 1).
   - Il crée les créneaux de l'horizon choisi par le client (1 à 14 jours) avec `publication_channel_occurrences_ensure`. La **fréquence** reste celle des créneaux configurés par canal : aucune occurrence n'est inventée.
   - Il appelle l'**Agent Publications v2** (seul moteur) sur les occurrences ouvertes de cet horizon. Il n'existe pas de second moteur.
   - Bornes : 10 clients et 2 tentatives de préparation par passage. Un refus de contenu compte comme une tentative, pour borner les appels IA. Le budget mensuel de l'agent s'applique toujours.
2. **« À valider ».** Les brouillons complets (photo attachée) passent en `pending_review` via `publication_submit_manual`. L'administrateur reçoit une notification **« Publication à valider »** qui ouvre la file de validation (`/publications/review`), une par préparation, sans texte ni nom de client.
   - Un brouillon sans photo reste brouillon : son approbation est impossible, et la notification « Photo manquante » (lots 4-5) est envoyée.
3. **Approbation explicite.** Rien n'est jamais approuvé automatiquement : seul un humain approuve, dans l'écran existant.
4. **Diffusion à l'heure prévue** (uniquement si `PUBLICATIONS_SCHEDULED_DELIVERY=enabled`).
   - `prepareApprovedDeliveries` prépare la diffusion des publications **approuvées**, non archivées et liées à un créneau, au nom de l'humain qui a approuvé la révision courante (`publication_reviews`).
   - `processScheduledDuePublications` envoie au plus **une** diffusion due par passage. Le pire cas Instagram (~290 s) tient dans les 300 s du tick.
   - Le moteur P10-P13 est inchangé. Il re-vérifie à l'envoi l'arrêt d'urgence, la publication globale et client, le compte, la connexion et l'approbation.
   - Une publication dont le créneau est passé depuis plus de 2 h n'est jamais envoyée en retard sans un humain : bouton « Préparer la diffusion » sur sa fiche.

## Invariants (vérifiés en base)

- **Modification après approbation** : `publication_save_draft` repasse la publication en brouillon, bloque ses diffusions et annule les envois en attente. Une nouvelle approbation est nécessaire.
- **Refus** : une publication refusée, ou en attente de validation, ne peut pas recevoir de diffusion (`publication_prepare_delivery` exige `approved`).
- **Reprises idempotentes** : une clé d'idempotence par variante et par compte, et une file avec bail. Une diffusion n'est jamais renvoyée si l'envoi a pu atteindre le fournisseur (état « à vérifier »).
- **Succès** : uniquement avec confirmation de la plateforme (identifiant distant).
- **Échecs** : chaque tentative reste dans l'historique (`publication_attempts`). La relance manuelle passe par la fiche publication. Nouveau : une notification **« Échec ou incertitude d'envoi »** par diffusion en échec ou à vérifier (déclencheur en base), vers la fiche de la publication.

## Délégation

Le planificateur agit au nom de l'administrateur qui a **enregistré en dernier** les réglages du client avec la préparation automatique activée (`publication_events`, action `publication.client_settings_saved`).

- Cet utilisateur doit toujours être l'administrateur autorisé (`AUTHORIZED_ADMIN_USER_ID`). Sinon rien n'est préparé.
- Chaque tentative est journalisée dans `audit_logs` (`system:publications-scheduler`, `metadata.delegated_actor`, run, publications créées et soumises), sans texte généré.
- Désactiver la préparation automatique d'un client arrête immédiatement toute préparation pour lui.

## Interrupteurs

| Étape | Conditions |
| --- | --- |
| Préparation | `publication_settings` : arrêt d'urgence levé, `automation_enabled` et `generation_enabled` ; client : préparation automatique et génération ; projet : agent activé, droits médias confirmés, canaux configurés |
| Diffusion | `PUBLICATIONS_SCHEDULED_DELIVERY=enabled`, arrêt d'urgence levé, `publishing_enabled` global et client, compte et connexion actifs, approbation humaine de la révision courante |

En production aujourd'hui : arrêt d'urgence actif et aucun compte connecté. Rien ne part.

## Migration

`supabase/migrations/20261030000000_publications_scheduled_flow.sql` (**non appliquée**) :

- catégorie de notification `publication_review` (préférences, compteur non lus) ;
- liens `/publications/<id>` et `/publications/review` ;
- déclencheur de notification des diffusions en échec ou à vérifier.

**Ordre** : après `20261027000000` (#36), `20261028000000` (#37) et `20261029000000` (#38). Avant d'appliquer, vérifier dans `supabase_migrations.schema_migrations` qu'aucune de ces versions n'est présente. Appliquer après accord uniquement.

**Variable d'environnement** : `PUBLICATIONS_SCHEDULED_DELIVERY` (vide par défaut, diffusion planifiée désactivée). La préparation planifiée suit les interrupteurs en base et ne publie jamais.

Le cron Vercel vers `/api/internal/scheduler/tick` reste à activer volontairement (voir `docs/automation.md`).

## Tests

- `tests/publications-scheduled-flow.test.mjs` couvre :
  - les interrupteurs, la délégation (échec fermé), l'horizon et la soumission ;
  - l'absence de photo, les bornes par passage et la notification ;
  - les diffusions : drapeau, approbateur, révision obsolète, retard, refus serveur ;
  - l'envoi unique par passage et le câblage du tick.
- `supabase/tests/publications-socle-4-scheduled-flow.sql` vérifie les catégories et les liens de notification, ainsi que le déclencheur (invoker, réservé au serveur).
- `tests/publications-scheduled-flow-db.test.mjs` rejoue la suite P10 du moteur de diffusion (206 vérifications) après toutes les migrations. Il vérifie en plus :
  - une notification par échec ou incertitude, aucune pour un succès ;
  - aucune diffusion possible pour une publication en attente ou refusée.

## Limites

- La préparation est séquentielle et bornée. Un client avec beaucoup de créneaux est rattrapé au fil des passages. Au-delà de 10 clients en préparation automatique, seuls les 10 premiers (par identifiant) sont traités : rotation à prévoir si le portefeuille grandit.
- La notification « Publication à valider » renvoie à la file de validation, pas à chaque publication.
- Le tableau de supervision (statuts, actions Approuver / Refuser / Reprogrammer / Suspendre) relève du lot 7.
