# Livraison reporting et pilotage — 15 octobre 2026

## Périmètre et état Git

Base réellement récupérée : `master` / `468f0e602b9c44b811f202d351d67decb5eedd5e` (PR #88). La PR #89 a été récupérée par sa référence Git `e98b37305c15b2d195a87f5a7fd042730f20c5be`, dont cette branche conserve les commits PDF et e-mail. Les modifications de l'ancienne branche PR #16 n'ont pas été fusionnées aveuglément.

Branche de livraison : `feat/client-reporting-and-operations`. L'accès Git natif, le fetch et le push fonctionnent. L'API GitHub était initialement refusée par le proxy (CONNECT 403), puis est redevenue accessible pendant la validation finale. La lecture authentifiée confirme #89 ouverte, fusionnable, avec `verify` et Vercel réussis sur `e98b373`. Les livraisons sans migration peuvent donc poursuivre leurs contrôles et leur fusion ; le lot dépendant des migrations reste bloqué avant déploiement.

Un brouillon d'environnement conserve les domaines existants et ajoute seulement `api.github.com`. Son enregistrement est confirmé ; sa publication n'a pas été observée. L'accès réel à l'API a ensuite été vérifié avec l'authentification existante. Aucun secret n'a été changé.

## Fonctionnalités terminées dans la branche

### Reporting client et PDF

Parcours complet : sélection du client, période et sources → préparation confirmée → aperçu client/interne → correction ou actualisation → approbation de version → téléchargement PDF ou confirmation séparée du destinataire pour l'envoi existant. Familles : Ads, SEO, site, activité, global. Les semaines/mois clos préexistants sont conservés.

Le PDF A4 réutilise le logo CODE-V, mesure le texte avant repli, conserve les accents et les longues données, répète les en-têtes de tableaux et limite explicitement les pages et le poids. Les données client seulement alimentent le document. La préparation valide les exports PDF et e-mail avant toute insertion ou nouvelle version. Un document trop long conserve l'ancienne version et son approbation.

La clé de préparation est la clé primaire du rapport : quatre soumissions concurrentes ne créent qu'une ligne et un instantané de version. Les scopes sont immuables en SQL. L'actualisation reçoit la version attendue et utilise le scope stocké. Modifier ou actualiser invalide l'approbation. Les réservations d'envoi existantes continuent à figer les versions en cours/incertaines et à empêcher les doubles tentatives.

Les états de collecte, périodes et dates de fraîcheur sont explicites. Search/Local Services restent séparés ; les données Ads restent en lecture seule. Les propriétés SEO et projets Analytics ne sont pas interchangés. Une publication simplement approuvée ne devient pas une diffusion. Un contrôle de site n'est pas une mesure continue d'uptime. Les données absentes ne deviennent jamais des métriques inventées.

### Directeur IA

Le bouton « Analyser tous mes clients » et les commandes transversales utilisent un outil enregistré en lecture seule. Les cartes priorisent les incidents, tâches, validations et recommandations avec faits, hypothèses, impact qualitatif, confiance, preuves datées et limites de couverture. Les propositions de tâches réutilisent la confirmation existante ; proposer ou annuler ne crée rien. Les anciennes preuves SEO ne sont pas présentées comme une lecture en direct de la propriété actuelle.

### Automatisations

La liste et l'historique individuel montrent les jobs réellement associés, leur statut et les rapports liés dans leur version actuelle. La mise en file n'est plus présentée comme une réussite. Les états distinguent notamment jamais exécutée, planifiée, en cours, réussie, échouée, en retard et validation nécessaire.

Correctifs moteur : insertion du job et avancement de l'échéance dans la même transaction ; contrôle du bail avant traitement et clôture ; absence de faux succès d'agent après perte du bail ; réservation manuelle du seul job demandé. Le bouton « Exécuter maintenant » ne traite plus trois jobs globaux pouvant appartenir à d'autres parcours.

## Migrations

| Fichier | Validation | Production |
| --- | --- | --- |
| `20261110000000_professional_client_reports.sql` | PostgreSQL 17 natif, scopes, contraintes, grants privés, données historiques conservées, quatre soumissions concurrentes | Non appliquée |
| `20261111000000_atomic_automation_enqueue.sql` | PostgreSQL 17 natif, rollback, quatre ticks, quatre workers, clé historique, pause et grants | Non appliquée |
| `20261109000000_seo_keyword_opportunities.sql` | Rejouée uniquement dans les bases synthétiques locales pour vérifier les dépendances | Non appliquée par cette mission |

Les deux nouvelles migrations ajoutent des fonctions/triggers et élargissent une contrainte de type ; elles ne suppriment aucune table, colonne ni donnée. Aucun `db push`, aucune réparation d'historique et aucune lecture/application Supabase distante n'ont été effectués dans cette mission. L'état distant courant n'est pas affirmé.

**Déploiement bloqué sans la migration `20261111000000`** : le moteur exige les RPC atomiques ; il ne revient pas au comportement historique dangereux. Le reporting personnalisé reste explicitement indisponible sans `20261110000000`. Une nouvelle autorisation de migration de production est requise par la mission avant toute application distante. Prévoir audit de la cible, sauvegarde/restauration testée, puis migration unitaire dans l'ordre et vérification des objets/grants/données. N'activer aucun cron ou envoi pour valider ces migrations.

## Vérifications exécutées

- `npm test` : **1 099 tests, 1 056 réussis, zéro échec, 43 ignorés**. Les tests facultatifs nécessitant des services non configurés restent distincts des tests SQL exécutés ci-dessous.
- `npm run lint` : réussi, avec deux avertissements préexistants dans `provider-contracts.ts` et `approved-mutations.ts` ; aucune erreur.
- `npm run typecheck` et build Next.js standard Turbopack : réussis.
- PostgreSQL **17.11 natif**, exclusivement sur loopback et bases jetables : **9 tests réussis, aucun ignoré**. Rejeu de migrations, invariants SQL du noyau, versions et approbations, races de réservation, quatre ticks/quatre workers, unicité des rapports et conservation des lignes vérifiés. Le test SQL historique du noyau a été actualisé pour exiger une nouvelle version et vérifier les instantanés transactionnels plutôt qu'une édition désormais interdite.
- PDF : tests purs, lecture Poppler et rendu raster réels sur contenu synthétique, y compris 500 tâches, français, tableaux, titres très longs, marges et pagination.
- Chromium/Next réels, Clerk et données simulés : reporting desktop 1 440 px/mobile 375 px (génération, aperçu, PDF, approbation, édition invalidante, actualisation, absence de migration) ; Directeur IA desktop/mobile (double clic, preuves, proposition/annulation, panne d'une source). L'extension du parcours navigateur couvre également la lecture des états et de l'historique d'automatisation sans créer de job.

Les comptes de tests ci-dessus correspondent aux commandes exécutées, pas à des essais de production. Le script E2E natif général nécessitant PostgREST n'a pas été exécuté. Aucun test avec vraie session Clerk, vrai client Supabase distant, vraie API IA/Ads/Search Console/Analytics/Resend, vrai micro, smartphone physique ou imprimante n'a été réalisé.

Les workflows existants sont complétés pour exécuter ces vérifications après création de la PR : build et Chromium desktop/mobile dans `verify.yml`, neuf tests SQL/concurrence dans le service PostgreSQL isolé existant. Ces ajouts de CI sont préparés ; leur exécution sur GitHub reste à observer. Aucun service de production ni secret n'est nécessaire à ces nouveaux parcours simulés.

Reproduction :

```sh
npm run lint
npm run typecheck
npm test
NEXT_TELEMETRY_DISABLED=1 npm run build
E2E_CHROMIUM=/usr/bin/chromium NODE_USE_ENV_PROXY=0 node scripts/test-professional-report-ui.mjs
E2E_CHROMIUM=/usr/bin/chromium NODE_USE_ENV_PROXY=0 node scripts/test-director-ui.mjs
```

Les tests SQL utilisent `CODEV_CORE_TEST_DATABASE_URL` limité à une base jetable locale `codev_core_test[_suffixe]` et `CODEV_CORE_TEST_PSQL`. Ne jamais leur fournir une URL distante.

## Livraison et suites manuelles

Les commits sont poussés sur la branche ; les descriptions de PR sont préparées dans `docs/pr-reporting-operations.md`. L'API GitHub bloquée empêche la création automatique de PR, l'attente des checks GitHub/Vercel et le merge. Le lien de comparaison est : https://github.com/AdrienW86/codev-os/compare/master...feat/client-reporting-and-operations . Ce lien ouvre un formulaire ; ce n'est pas une PR déjà créée.

Aperçus locaux synthétiques dans les chemins ignorés : `.local/pdf-preview/report.pdf`, `e2e/output/professional-reports/*-generation.png`, `*-review.png`, `*-automation-history.png`, et `e2e/output/director-ui/`. Aucune preview Vercel ni fonctionnalité de production n'est déclarée vérifiée.

1. Appliquer/publier l'ajout réseau, puis vérifier accès API, état réel de #89 et checks obligatoires. Éviter de livrer deux fois les mêmes commits PDF si #89 est fusionnée séparément ; réintégrer le nouveau master avant revue finale.
2. Examiner les deux migrations locales et autoriser séparément leur application de production après audit de la cible et sauvegarde. La migration SEO V2 conserve sa propre exigence d'autorisation.
3. Déployer une preview autorisée, vérifier session, connexions réelles et collecte en préparation seule. Confirmer les états vides et les erreurs fournisseur avec l'administrateur.
4. Fusionner seulement après checks nécessaires verts et stratégie de déploiement compatible avec les migrations. Le cron, les envois et toute modification Ads restent des décisions séparées.

**État actuel : code et validations locales livrés ; NO-GO pour un merge/déploiement aveugle sans checks distants et migrations autorisées.** Aucun envoi réel, prospection, publication externe, mutation Ads, secret ou cron n'a été activé.
