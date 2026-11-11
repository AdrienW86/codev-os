# Livraison reporting et pilotage — 15 octobre 2026

## État de livraison

Trois lots indépendants, sans nouvelle migration de production, ont été fusionnés dans `master` après réussite des checks GitHub et Vercel sur leur SHA exact :

| PR | Fonctionnalité | Commit de fusion |
| --- | --- | --- |
| [#89](https://github.com/AdrienW86/codev-os/pull/89) | PDF client et pièce jointe du rapport approuvé | `2ac810f56aa2aef45b2a9e32141bb25dc8991af3` |
| [#90](https://github.com/AdrienW86/codev-os/pull/90) | Directeur IA avec preuves et couverture explicites | `f3085bc8f98ca827c5d4ad378ea91aabfd517268` |
| [#91](https://github.com/AdrienW86/codev-os/pull/91) | Supervision des automatisations et réservation manuelle ciblée | `62fd3d9ffb66e77d427809c0f10529e686e0b32d` |

Le lot restant, sur `feat/client-reporting-and-operations`, est livré séparément en **PR brouillon** : rapports personnalisés multi-sources et mise en file planifiée atomique. Il dépend de deux migrations locales non appliquées à distance. Le nouveau `master` est réintégré pour conserver les corrections livrées séparément.

L'accès authentifié GitHub, le fetch et le push fonctionnent. Aucun secret n'a été changé. Un brouillon de configuration d'environnement a été enregistré ; sa publication et sa restauration dans un nouvel environnement n'ont pas été vérifiées.

## Fonctionnalités fusionnées

### PDF et envoi existant — PR #89

Le PDF A4 réutilise le logo CODE-V, mesure le texte avant repli, conserve les accents et les longues données, répète les en-têtes de tableaux et limite explicitement les pages et le poids. Seules les données destinées au client alimentent le document. Le téléchargement reste authentifié et privé.

Le parcours d'envoi existant joint le PDF de la version approuvée et conserve les confirmations, réservations et protections contre les doubles tentatives. Aucun véritable e-mail n'a été envoyé pour cette validation ; aucune activation de `EMAIL_SENDING_ENABLED` n'a été effectuée. Le statut accepté par le fournisseur ne constitue pas une preuve de livraison au destinataire.

### Directeur IA — PR #90

Le bouton « Analyser tous mes clients » et les commandes transversales utilisent un outil enregistré en lecture seule. Les cartes priorisent incidents, tâches, validations et recommandations avec faits, hypothèses, impact qualitatif, confiance, preuves datées et limites de couverture. Les propositions de tâches réutilisent la confirmation existante ; proposer ou annuler ne crée rien.

Les sources indisponibles restent signalées et les anciennes preuves SEO ne sont pas présentées comme une lecture en direct de la propriété actuelle. Ce parcours n'appelle pas de fournisseur et n'effectue aucune écriture métier automatique.

### Automatisations — PR #91

La liste et l'historique individuel montrent les jobs réellement associés, leur statut et les rapports liés dans leur version actuelle. Une mise en file ne vaut plus réussite. Les états distinguent notamment jamais exécutée, planifiée, en cours, réussie, échouée, en retard et validation nécessaire.

« Exécuter maintenant » réserve uniquement le job demandé par une mise à jour conditionnelle des tables existantes. Cette réservation manuelle utilise les primitives déjà déployées ; elle ne dépend d'aucune nouvelle RPC ni migration. Les contrôles du bail avant traitement et clôture empêchent un worker ayant perdu son bail de publier un faux succès. L'échec d'une écriture d'observation après traitement ne relance pas le handler déjà exécuté.

Le moteur et le scheduler existants sont conservés. Aucun second scheduler ni cron de production n'a été activé. La faiblesse historique de la mise en file planifiée, qui séparait insertion et avancement de l'échéance, est traitée dans le lot brouillon ci-dessous.

## Lot restant en brouillon

### Rapports personnalisés multi-sources

Parcours : sélection du client, de la période et des sources → préparation confirmée → aperçu client/interne → correction ou actualisation → approbation de version → téléchargement PDF ou confirmation séparée du destinataire dans le parcours d'envoi existant. Familles : Ads, SEO, site, activité, global. Les semaines et mois clos préexistants sont conservés.

La préparation valide les exports PDF et e-mail avant toute insertion ou nouvelle version. Un document trop long conserve l'ancienne version et son approbation. La clé de préparation déduplique les soumissions ; le scope client/période/sources est immuable en SQL. L'actualisation utilise le scope stocké et la version attendue. Modifier ou actualiser invalide l'approbation. Les réservations d'envoi continuent à figer les versions en cours ou incertaines.

Les états de collecte, périodes et dates de fraîcheur sont explicites. Search et Local Services restent séparés ; Google Ads reste en lecture seule. Les propriétés SEO et projets Analytics sont vérifiés. Une publication approuvée ne devient pas une diffusion ; un contrôle ponctuel de site n'est pas une mesure continue d'uptime. Les données absentes ne deviennent jamais des métriques inventées.

Deux défauts ont été corrigés pendant la revue finale : le fournisseur Vercel convertissait les compteurs absents ou malformés en faux zéros ; il les refuse désormais et conserve les vrais zéros. Les nouveaux instantanés passent en version 3 ; le reporting personnalisé refuse les anciens caches non vérifiables. Les dimensions complémentaires peuvent échouer séparément. La recherche d'opportunités SEO filtre maintenant les statuts actifs avant sa limite : 51 opportunités fermées récentes ne masquent plus une opportunité active plus ancienne.

### Mise en file planifiée atomique

La RPC privée `codev_enqueue_automation` verrouille l'automatisation, insère le job et avance l'échéance dans une transaction. Le lot conserve les protections de bail et la réservation manuelle conditionnelle de `master`. Aucun nouvel RPC de réservation manuelle n'est nécessaire.

Le déploiement du moteur de ce lot dépend de la migration `20261111000000`. Sans cette fonction, la mise en file échoue explicitement plutôt que de reprendre le comportement historique non atomique.

## Migrations et état distant

| Fichier | Objet | État distant vérifié |
| --- | --- | --- |
| `20261110000000_professional_client_reports.sql` | Type de rapport personnalisé, scopes, contraintes, immutabilité et fonction privée de disponibilité | Non lu ; migration non appliquée par cette mission |
| `20261111000000_atomic_automation_enqueue.sql` | Mise en file planifiée atomique via `codev_enqueue_automation` | Non lu ; migration non appliquée par cette mission |
| `20261109000000_seo_keyword_opportunities.sql` | Dépendance SEO V2, avec autorisation de production distincte | Non lu ; migration non appliquée par cette mission |

Les deux nouvelles migrations ne suppriment aucune table, colonne ni donnée. La première remplace la contrainte de type par un sur-ensemble, impose des sources uniques cohérentes avec la famille et limite la période à 366 jours. La seconde ne crée que la mise en file atomique et notifie PostgREST ; la réservation manuelle utilise le mécanisme déjà livré. Les fichiers ont été rejoués sur PostgreSQL 17 local avec contrôle des données historiques et des grants. Aucun `supabase db push`, aucune réparation d'historique, aucune lecture Supabase distante et aucune application distante n'ont été effectués. L'état réel de la production et des migrations antérieures n'est donc pas affirmé.

Contrôle non destructif de cet environnement : aucune variable Supabase d'URL, de clé de service, de token d'accès ou de connexion SQL n'est présente dans le processus ; seul `.env.example` existe à la racine. La CLI Supabase et le lien local `supabase/.temp/project-ref` sont absents. Aucune valeur secrète n'a été affichée. Ces constats expliquent l'absence de lecture distante ; ils ne décrivent pas la configuration de Vercel ou l'état de la production.

Avant application : autorisation explicite pour la cible, lecture de son historique réel, comparaison des fichiers et dépendances, vérification de la sauvegarde/restauration, puis application unitaire dans l'ordre avec contrôle après chaque migration des tables, colonnes, index, contraintes, fonctions, RLS, grants et données. Aucun envoi ni cron n'est nécessaire à cet audit.

## Vérifications et limites

Les trois PR fusionnées ont leurs checks GitHub et Vercel réussis sur leur commit de tête exact avant fusion. Pour #91, la CI PostgreSQL isolée a également validé les six tests natifs de réservation ciblée.

| PR | Commit vérifié | Preview ayant déclaré son déploiement réussi |
| --- | --- | --- |
| #89 | `a90336e99a4b43c03a25930039efba130b94de1d` | [PDF](https://codev-aaj7wvf8t-adrienw86s-projects.vercel.app) |
| #90 | `cab37b914f5379d07eefa49355a27dc749d06534` | [Directeur IA](https://codev-vsrov3yyh-adrienw86s-projects.vercel.app) |
| #91 | `5fe938dc868815e8dc917203c1533f7d3fd28b05` | [Automatisations](https://codev-pw8yh9bz3-adrienw86s-projects.vercel.app) |

Aucun parcours métier avec connexions réelles n'a été testé sur ces previews. Un déploiement réussi ne valide pas le fonctionnement métier en production.

La validation locale de #91 a exécuté **1 091 tests : 1 049 réussis, zéro échec, 42 ignorés**, ainsi que lint, typecheck et build. Les six tests PostgreSQL 17 natifs utilisent plusieurs connexions réelles et couvrent notamment huit réservations simultanées pour un seul gagnant, les tentatives périmées, les budgets modifiés, les échéances futures et les retries. Chromium et Next réels ont validé les parcours desktop 1 440 px et mobile 375 px avec session et stockage simulés, y compris les états, l'historique, les liens de rapport et le contenu long.

Le PDF a été analysé avec Poppler et rasterisé sur contenu synthétique. Les parcours Directeur IA ont été exécutés dans Chromium avec doubles clics, preuves, proposition/annulation et panne de source.

Validation finale du lot brouillon après réintégration :

- `npm test` : **1 121 tests, 1 077 réussis, zéro échec, 44 ignorés**. Les tests facultatifs absents de cette commande restent distincts des tests natifs exécutés ci-dessous.
- Lint : aucune erreur, deux avertissements préexistants (`provider-contracts.ts` et `approved-mutations.ts`). Typecheck et build Next.js Turbopack : réussis.
- PostgreSQL **17.11 natif**, loopback et bases jetables : **15 tests réussis, zéro échec ou ignoré**. Rejeu des migrations, données historiques, RLS/grants, contraintes de scope, versions et approbations, réservations d'envoi SQL sans fournisseur, quatre ticks concurrents, huit connexions de réservation manuelle, rollback d'insertion et de violation de contrainte, budgets de retries et dates vérifiés.
- Chromium/Next réels, session et stockage simulés : parcours rapports, Directeur IA et supervision sur desktop **1 440 px** et mobile **375 px** réussis. Rapports : préparation, PDF, approbation, correction invalidante, actualisation en version 3 et blocage sans migration. Directeur : preuves, double clic, proposition/annulation et panne d'une source. Supervision : navigation administrateur, états, historiques, rapports liés et absence d'écriture ou de débordement horizontal.

La CI de la PR brouillon rejoue le build, les trois parcours navigateur et les vérifications PostgreSQL isolées. Son statut et sa preview sont à consulter sur la PR associée à la branche ; ce document n'assimile pas les résultats locaux à des checks distants ni à une validation métier de production.

Les tests PostgreSQL utilisent exclusivement des bases jetables locales. Les simulations navigateur n'utilisent ni vraie session Clerk ni vraie API Ads, Search Console, Analytics, IA ou Resend. Aucun test avec smartphone physique, vrai micro, imprimante ou parcours complet de production n'a été réalisé. Le pilote Protection Nuisibles reste à exécuter avec vérification préalable des identifiants réels, en préparation seule et sans réservation d'envoi réel.

Reproduction des vérifications applicatives :

```sh
npm run lint
npm run typecheck
npm test
NEXT_TELEMETRY_DISABLED=1 npm run build
E2E_CHROMIUM=/usr/bin/chromium NODE_USE_ENV_PROXY=0 node scripts/test-professional-report-ui.mjs
E2E_CHROMIUM=/usr/bin/chromium NODE_USE_ENV_PROXY=0 node scripts/test-director-ui.mjs
E2E_CHROMIUM=/usr/bin/chromium NODE_USE_ENV_PROXY=0 node scripts/test-automation-ui.mjs
```

Les tests SQL généraux utilisent `CODEV_CORE_TEST_DATABASE_URL` et `CODEV_CORE_TEST_PSQL`. Les tests de réservation ciblée utilisent séparément `CODEV_SCOPED_TEST_DATABASE_URL`. Les scripts n'acceptent que leurs bases de test locales ; ne jamais leur fournir une URL distante.

## Décision et prochaines étapes

Les PR #89, #90 et #91 sont livrées dans `master`. Le lot rapports personnalisés/mise en file atomique reste **NO-GO pour merge ou déploiement** tant que son audit de migration, l'autorisation d'application et les vérifications finales ne sont pas terminés.

1. Vérifier les checks au SHA exact et la preview de la PR brouillon ; ne pas la fusionner automatiquement.
2. Rétablir l'accès sécurisé à Supabase, auditer la base distante en lecture seule, puis obtenir l'autorisation explicite de migration. Conserver l'autorisation SEO V2 séparée et ne pas utiliser de `db push` global.
3. Après application autorisée et contrôlée, vérifier le parcours réel avec une session administrateur et les connexions disponibles, puis exécuter le pilote Protection Nuisibles en préparation seule.
4. Décider séparément de toute activation d'envoi ou de cron de production. Aucune mutation Google Ads n'entre dans ce lot.

Aucun e-mail réel, prospection, publication externe, changement de secrets, mutation Google Ads ou activation de cron n'a été effectué.
