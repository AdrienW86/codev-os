# Migration distante du calendrier — 5 octobre 2026

Seule la migration `20261005205057_publications_editorial_calendar.sql` a été
appliquée au projet Supabase **codev-os** (`lehlbcnpufkllcykvtlg`), conformément
à l’autorisation. SHA-256 du fichier appliqué :
`8B83119619022042B7465860453D5A2C62F5B5212AEB51C3E70EBFECA8AE3821`.

L’historique passe de neuf à dix entrées ; les neuf entrées précédentes restent
inchangées. Nom enregistré : `20261005205057_publications_editorial_calendar` ;
version attribuée par le connecteur : **20261005212641**.

## Contrôles distants

- Tables créées : `publication_cadences`, `publication_calendar_slots`,
  `publication_planning_jobs`. Elles contiennent chacune **zéro ligne**.
- RLS active sur les trois tables ; aucune policy ; aucun accès anon/authenticated.
  service_role possède SELECT/INSERT/UPDATE, sans DELETE. Les protections
  contre DELETE/TRUNCATE sont présentes.
- RPC `publication_save_cadence` et `publication_ensure_calendar` présentes,
  SECURITY INVOKER, exécutables uniquement par le backend privilégié.
- Treize index, sept FK et dix triggers sur les nouvelles tables vérifiés.
  Les autres objets prévus sont inclus dans le SQL exact appliqué.
- `generation_enabled=false`, `automation_enabled=false`,
  `publishing_enabled=false`, `emergency_stop=true`, avant et après application.
- Zéro job Publications, zéro delivery et zéro job de planification.
  Extension pg_cron absente ; aucun worker/cron lancé.
- Empreintes des publications historiques inchangées en excluant le nouveau
  champ `creation_origin`, initialisé à `manual`. Empreintes des deux anciennes
  reviews strictement identiques avant/après.

## Calendrier et REST

La véritable fonction serveur de la page `/publications/calendar` et sa couche
de données ont été exécutées avec les données distantes, puis rendues en HTML.
Le script de contrôle autorise exclusivement les requêtes GET vers le REST du
projet confirmé et remplace la garde admin uniquement dans ce processus de
test, sans modifier l’authentification de l’application.

- Lectures `publication_cadences` et `publication_calendar_slots` : HTTP 200.
- Toutes les lectures REST réussissent ; aucun PGRST205 ni erreur journalisée.
- Vue par défaut rendue sans message « Calendrier indisponible ».
- Période vide du 7 janvier 2030 : message « Aucun créneau pour ces critères »
  réellement rendu, sans créer de cadence, slot ou publication.

Ce contrôle est un rendu serveur utilisant le vrai REST distant, pas une session
E2E dans un navigateur authentifié avec Clerk.

## Tests après application

- `npm run test:publications` : **18/18 réussis**.
- Suite complète Node et intégrations SQL : **148/148 réussis**, zéro échec,
  zéro test ignoré.
- Calendrier SQL : **78 contrôles par reconstruction**, deux reconstructions
  réussies ; concurrence entre deux planificateurs et entre formulaire manuel
  et planificateur vérifiée sans doublon ni deadlock.
- Les cinq autres suites SQL historiques ont également été exécutées localement.
- `npm run lint`, `npm run typecheck`, `npm run build` : réussis.

Les tests SQL utilisent uniquement un cluster PostgreSQL 17.11 temporaire sur
127.0.0.1 avec données synthétiques. Aucun test d’écriture n’a été exécuté sur
le distant après la migration.

Aucune autre migration ou modification distante hors effets du fichier autorisé.
Aucun contenu IA, aucune publication externe, aucun Lot 4.
