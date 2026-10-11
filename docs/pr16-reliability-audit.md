# Audit de fiabilité de la PR #16

Audit du 11 octobre 2026, `feature/ads-recurring-recommendations`, comparée à `master` `c98e3fb`. La référence Git `refs/pull/16/head` était `67317ad`, identique à la branche à l'ouverture de l'audit. La PR existante est conservée ; aucun merge, nouvelle fonctionnalité majeure, campagne Ads modifiée, secret changé, cron activé, migration distante ou communication réelle.

## Défauts corrigés

1. **Notification sans rapport** : le trigger récurrent produisait `/notifications`, refusé par la contrainte de `admin_notifications.href`. Une préparation échouée ou un envoi bloqué avant publication peut maintenant créer une notification valide et dédupliquée.
2. **Écritures tardives du worker** : les mises à jour d'échec et de transport étaient faites sans vérifier le bail. La RPC `codev_record_ads_report_outcome` impose occurrence/client/révision/job/type/worker/bail vivant sous verrou. Une préparation annulée ne publie plus après son retour réseau. Les verrous suivent l'ordre settings → occurrence → job.
3. **Destinataire figé contournable en manuel** : le champ de l'écran était modifiable et la réservation manuelle ne contrôlait pas l'occurrence. Champ en lecture seule pour les rapports récurrents et refus SQL d'un autre destinataire, même si le formulaire est falsifié.
4. **Ancienne approbation après changement de configuration** : modifier destinataire, campagnes, cadence ou pause invalide les approbations des rapports récurrents non envoyés. Une nouvelle version est enregistrée et doit être relue. Les snapshots d'occurrence restent figés ; les anciens jobs sont suspendus. Un transport déjà réservé/en cours ou incertain reste irrévocable et figé, sans réessai aveugle.
5. **Nouvelle approbation impossible dans l'UI** : `MutationForm` conservait son état de succès désactivé après changement de version. Le formulaire d'approbation est maintenant identifié par la version ; la v2/v3 peut être approuvée sans recharger manuellement.
6. **Fuseau Ads changé silencieusement** : préparation, aperçu et régénération refusent un changement du fuseau des données du compte, avant l'analyse/publication. Reconfigurer une nouvelle série est nécessaire. Les dates historiques de chaque occurrence utilisent son propre fuseau, même après un changement du fuseau de planification.
7. **Confirmation UI devenue obsolète** : tout changement de configuration efface la confirmation et l'aperçu. Les erreurs d'enregistrement/pause restent visibles sans annoncer un succès non confirmé.
8. **Sender invalide reconnu trop tard** : `emailSendingStatus` bloque un `EMAIL_FROM` invalide/control chars avant réservation. Un nom d'affichage valide reste accepté. Cela ne vérifie pas le DNS ou le domaine chez Resend.
9. **Worker Ads dépendant de Clerk** : le chemin système réutilisait un transport qui exigeait une session navigateur. Il vérifie maintenant le job de préparation/client/type/worker/bail avant les accès OAuth et avant chaque requête Ads, y compris après OAuth et pendant la pagination. Le chemin interactif conserve son contrôle administrateur. Un test utilise le vrai transport applicatif, avec réponses HTTP simulées, et sans session Clerk.
10. **Harnais natif incomplet** : deux suites dépendaient de rôles PostgreSQL préexistants ; la vérification du nombre de réservations supposait une sortie psql non formatée. Bootstrap explicite et assertion SQL corrigés.

Les migrations historiques et celles de `master` sont inchangées. La correction SQL est additive dans **`20261021000000_ads_recurring_hardening.sql`**, après les sept fichiers attendus. Les seuls `DROP` du lot remplacent des contraintes dans une transaction ; aucun DROP de table/colonne, TRUNCATE ou effacement de données lors de l'application. Les fonctions historiques de configuration peuvent supprimer des associations lorsqu'elles sont appelées ; aucune de ces opérations n'est déclenchée par cette procédure de migration.

## État distant exact observé ici

**Non accessible, pas revalidé.** Aucun connecteur Supabase/Resend/Ads/Vercel callable ; aucun binding de ces services, aucune variable correspondante injectée, aucun `.env`, `.env.local` ou projet CLI lié. Le token de l'API GitHub est présent mais `api.github.com` est refusé par le proxy (403 CONNECT). Le push Git fonctionne ; aucune conclusion sur les checks CI ou le statut provider distant n'est déduite de ce succès.

Le document historique `ads-recurring-delivery.md` rapporte une lecture du 10 octobre : 26 migrations, dernière `20261010055802` nommée `20261015000000_codev_os_core`. C'est une preuve historique fournie par le dépôt, **pas une lecture distante effectuée pendant cet audit**. L'état actuel des sept migrations suivantes est **inconnu** :

| Ordre | Fichier local | Distant actuel | Rejeu PostgreSQL local |
|---|---|---|---|
| 1 | `20261016000000_google_ads_reports.sql` | Inconnu | Passé |
| 2 | `20261016000001_whatsapp_drive_ingestion.sql` | Inconnu | Passé |
| 3 | `20261017000000_google_ads_campaign_tracking.sql` | Inconnu | Passé |
| 4 | `20261018000000_google_ads_client_context.sql` | Inconnu | Passé |
| 5 | `20261019000000_report_delivery_claims.sql` | Inconnu | Passé |
| 6 | `20261020000000_notifications_web_push.sql` | Inconnu | Passé |
| 7 | `20261020000001_ads_recurring_reports.sql` | Inconnu | Passé |
| 8 | `20261021000000_ads_recurring_hardening.sql` | Nouveau, non appliqué par cet audit | Passé |

Dépendances : rapports et jobs du noyau V1 → scope Ads → claims/versionnement → notifications → récurrence → durcissement. Le fichier WhatsApp ne dépend pas de la récurrence ; il conserve sa place dans l'ordre chronologique. Tous les fichiers ont été rejoués un par un sur une copie synthétique PostgreSQL 17.11 native. Après chaque application : catalogues tables/colonnes/index/contraintes/fonctions, RLS, grants et empreintes des données témoins préexistantes. Cela ne prouve pas la conservation de données distantes non accessibles, ni une restauration d'un backup réel.

## Procédure distante exacte préparée, non exécutée

Ne pas utiliser `supabase db push` global ni réparer l'historique automatiquement : les versions historiques distantes diffèrent des préfixes locaux. Ne jamais appliquer `supabase/local/remote-schema.sql`, `e2e/harness/seed.sql` ou les tests mutateurs à une base distante.

Depuis la racine du dépôt :

```bash
node scripts/prepare-ads-migrations.mjs
```

Cette commande **hors ligne** écrit `.local/pr16-migrations/manifest.json` (ordre, SHA-256, clé d'idempotence), un packet JSON par fichier, et `catalog-audit.json` (`read_only: true`). Aucun secret ni accès réseau dans le générateur. Le script a été exécuté et le SQL de catalogue validé localement.

Prérequis externes : authentification Supabase Management déjà disponible dans un terminal sécurisé (`SUPABASE_ACCESS_TOKEN`), projet réellement vérifié (`SUPABASE_PROJECT_REF`), réseau `api.supabase.com`. Ne pas saisir de valeur secrète en chat, activer le traçage shell ou enregistrer une clé dans les packets. Le projet historiquement documenté est `lehlbcnpufkllcykvtlg` ; le confirmer dans le dashboard avant usage. Lecture de l'état réel :

```bash
: "${SUPABASE_PROJECT_REF:?Projet vérifié requis}"
: "${SUPABASE_ACCESS_TOKEN:?Authentification sécurisée existante requise}"
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/migrations" \
  -o .local/pr16-migrations/remote-history-before.json
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H 'Content-Type: application/json' \
  --data-binary @.local/pr16-migrations/catalog-audit.json \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
  -o .local/pr16-migrations/remote-catalog-before.json
```

Comparer les **noms ET versions** avec le manifeste, récupérer l'entrée complète si le nom est ambigu (`GET /database/migrations/{version}`), vérifier les définitions sur la cible et les doublons éventuels. Une version éloignée du préfixe local n'établit pas qu'une migration manque. Faire un backup sécurisé et vérifier sa restauration sur copie ; appliquer d'abord sur cette copie, un fichier à la fois. L'endpoint d'application officiel enregistre son historique ; aucune écriture manuelle dans `schema_migrations`.

Exemple pour **un seul fichier confirmé manquant**, après contrôle de ses dépendances, copie et backup :

```bash
migration_file=20261016000000_google_ads_reports.sql
migration_key=$(node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(".local/pr16-migrations/manifest.json"));const row=m.find(x=>x.file===process.argv[1]);if(!row)process.exit(1);process.stdout.write(row.idempotencyKey)' "$migration_file")
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: ${migration_key}" \
  --data-binary "@.local/pr16-migrations/${migration_file}.json" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/migrations" \
  -o ".local/pr16-migrations/${migration_file}.application.json"
# Répéter les deux lectures ci-dessus vers des fichiers distincts après CE fichier.
```

Ne pas boucler aveuglément sur les huit fichiers. Après **chacun**, vérifier tables/colonnes/index/contraintes/triggers/RPC, RLS/grants et conservation des données via le backup ; vérifier l'entrée d'historique puis seulement sélectionner le prochain fichier confirmé manquant. En cas de timeout/401/429/500, relire l'historique et le catalogue avant toute reprise ; conserver la même clé d'idempotence. Ne jamais déduire « non appliqué » du seul échec HTTP.

Schéma de ces endpoints et `read_only` vérifiés dans la [spécification officielle Supabase](https://github.com/supabase/supabase/blob/master/apps/docs/spec/api_v1_openapi.json). La procédure distante n'a pas été exercée avec des identifiants réels ici.

## Statuts et pilote

- **Google Ads** : connecteur limité à OAuth et `googleAds:search`, pas de méthode mutate. Tests des refus/quota/timeouts et des données partielles ; Search/hors Local Services et leads Local Services séparés, aucune conversion déduite des leads. Repli déterministe explicitement visible dans le panneau et les rapports. Lecture réelle et droits du compte **non testés ici**.
- **Rapports** : versions transactionnelles, scope immuable, destinataire figé, approbation distincte, preview non approuvable, notification sans rapport corrigée, réapprobation testée. Une ancienne occurrence réapprouvée utilise toujours son ancien destinataire/scope ; la nouvelle configuration ne la réécrit pas.
- **Resend** : `RESEND_API_KEY`, `EMAIL_FROM`, domaine vérifié chez Resend et `EMAIL_SENDING_ENABLED` constituent la configuration attendue. Les trois variables ne sont pas injectées ici ; transport réel désactivé, état du provider et DNS du domaine **inconnus**. Le code/test distingue **accepted** de **delivered** ; aucune preuve de livraison ni webhook de livraison ajouté. Aucune tentative réelle. L'activation factice du transport n'existe que dans le processus isolé du harnais, sous interception réseau refusant tout fournisseur non simulé.
- **Scheduler** : moteur existant et route `/api/internal/scheduler/tick`, authentification Bearer `CRON_SECRET` avec comparaison constante ; idempotence, SKIP LOCKED et baux, quatre ticks/workers testés nativement. Aucun second scheduler, cron prod ou secret activé. Déclencheur externe et plan Vercel réel **non inspectés**. Une cadence minute et une capacité de workers/backlog adaptée sont nécessaires ; cinq jobs séquentiels dans une fonction de 300 secondes ne garantissent pas 18:00. Au-delà du retard autorisé, transport manuel uniquement. 18:00 est une échéance cible, jamais une garantie réseau.
- **Protection Nuisibles réel** : **non exécuté**, IDs non revalidés ; l'association de compte documentée historiquement n'est pas utilisée. Le SQL de lecture du pilote recherche le nom exact et retourne les IDs/état pour contrôle. Ensuite, lire l'inventaire et le fuseau depuis Ads avant toute configuration. Cible : weekly, weekday 5, 18:00 Europe/Paris, leadHours 6, transport prepare_only ; conserver `EMAIL_SENDING_ENABLED` désactivé et aucun cron prod. Utiliser le bouton de confirmation ; ne pas configurer silencieusement un destinataire ou des campagnes. Test d'envoi : réservation sur copie uniquement, aucune API mail réelle.

## Validation finale

Résultats :

| Vérification | Résultat |
|---|---|
| `NODE_USE_ENV_PROXY=0 npm test` | 660 réussis, 0 échec, 30 ignorés (690 cas) |
| Lint | Passé |
| Typecheck | Passé |
| Build production standard Turbopack | Passé (revalidé après la correction du transport worker) |
| SQL / PostgreSQL 17.11 natif | 5 tests réussis, aucun ignoré ; huit migrations une par une, quatre ticks, quatre réservations, workers concurrents, publication unique, guards/grants/RLS |
| Playwright / Chromium | Passé, desktop 1440×900 et mobile 375×812 ; aperçu, modification, nouvelle approbation, destinataire figé, confirmations réinitialisées, recommandations écrites/voix simulée et faux Resend |

Les cinq cas PostgreSQL figurent parmi les 30 ignorés de `npm test` puis sont exécutés séparément : ils ne sont pas comptés deux fois. Les 25 autres cas SQL/infrastructure facultatifs restent non exécutés. Les premières tentatives ont révélé les défauts de bootstrap psql, de label de test et de bouton d'approbation ; ils sont corrigés, les exécutions finales passent.

 Les tests navigateur utilisent Chromium réel (1440×900 et 375×812) mais Clerk, storage, Ads, Resend, IA et voix sont **simulés**. Les tests SQL/concurrence utilisent **PostgreSQL natif**, pas PGlite. Aucun vrai micro ni vraie API Ads/IA/Resend validé.

Commandes reproductibles :

```bash
NODE_USE_ENV_PROXY=0 npm test
npm run lint
npm run typecheck
NEXT_TELEMETRY_DISABLED=1 npm run build
E2E_CHROMIUM=/usr/bin/chromium NODE_USE_ENV_PROXY=0 node scripts/test-recurring-ui.mjs
# Base locale dédiée jetable et psql configurés :
CODEV_CORE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/codev_core_test \
CODEV_CORE_TEST_PSQL=/workspace/.local/pg/usr/lib/postgresql/17/bin/psql \
LD_LIBRARY_PATH=/workspace/.local/pg/usr/lib/x86_64-linux-gnu \
node --test --test-concurrency=1 tests/ads-migrations-db.test.mjs tests/ads-recurring-db.test.mjs tests/ads-workspace-db.test.mjs tests/google-ads-reports-db.test.mjs
```

Le runner E2E natif complet (`npm run test:e2e`) exige aussi PostgREST et des bases de parcours dédiées ; il est distinct du Playwright récurrent isolé. Les suites SQL facultatives non pertinentes, le pilote distant, les migrations distantes, la CI de la PR, DNS/Resend réels et le déploiement ne sont pas implicitement validés.

**Recommandation : NO-GO pour merge sans revue des prérequis distants et du pilote réel.** Le code et les corrections sont vérifiables localement et poussés ; il reste à revalider l'historique/dépendances sur la cible, appliquer uniquement les migrations manquantes sur copie puis cible en contrôlant chacune, faire le pilote préparation seule avec les IDs réellement lus et vérifier les checks de la PR. Aucune activation de transport/cron nécessaire pour ce pilote. L'absence de ces accès limite cet audit ; elle n'est pas remplacée par les tests simulés.
