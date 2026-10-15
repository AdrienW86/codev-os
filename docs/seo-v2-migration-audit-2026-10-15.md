# Audit avant activation — Migration SEO V2 (15 octobre 2026)

**Périmètre :** migration `supabase/migrations/20261109000000_seo_keyword_opportunities.sql`, aucune modification de la production.

## Production Supabase : lectures seules

Projet CODE-V OS `lehlbcnpufkllcykvtlg`, PostgreSQL `17.11` lors du contrôle.

- `public.clients`, `public.agent_runs`, `public.recommendations` et `public.actions` existent et leur clé `id` est de type `uuid` : les clés étrangères prévues par la migration ont leurs références.
- Le schéma `codev_private` existe.
- Les trois nouvelles tables `seo_opportunity_analyses`, `seo_keyword_opportunities`, `seo_opportunity_interventions` sont **absentes**.
- L'historique distant contient `whatsapp_media_library` sous la version d'exécution `20261012063738`, distincte de son ancien nom de fichier local. La migration SEO utilise un préfixe distinct `20261109000000`.
- Aucune branche Supabase de développement préexistante : **aucun coût de branche ni écriture SQL distante** n'a été engagé.

## Replay automatisé réellement exécuté

Workflow [SEO V2 isolated SQL validation](../.github/workflows/seo-v2-isolated.yml) — run GitHub Actions `38707514813` : **success** le 15 octobre 2026.

Le test démarre un conteneur `postgres:17` temporaire sur GitHub Actions et utilise une URL exclusivement `127.0.0.1` avec une base dédiée `codev_core_test_seo_opportunities`. Il rejoue :

1. le schéma de référence **sans données client** dans `supabase/local/remote-schema.sql` (capture datée du 5 octobre 2026) ;
2. les migrations SQL du dépôt ;
3. `tests/seo-opportunities-db.test.mjs`, qui exécute `supabase/tests/seo-opportunities.sql` sous transaction annulée et exige au moins 19 assertions SQL ;
4. `tests/supabase-migration-versions.test.mjs`, qui refuse les doublons de versions.

**Résultat observé :** les trois tests Node ciblés réussissent, zéro échec et zéro test ignoré. Le SQL couvre notamment la déduplication, les contraintes de métriques réelles vs hypothèses, le cycle de vie des opportunités, les données immuables d'intervention, le RLS, les privilèges et l'interdiction de suppression par `service_role`.

L'exécution est indépendante des identifiants Supabase de production. Les secrets du conteneur PostgreSQL sont des identifiants de test locaux, jetables.

## Portée et limites

- **Validé :** le replay et les tests fonctionnels de cette migration sur le schéma de référence du dépôt enrichi des migrations versionnées, sous PostgreSQL 17.
- **Validé par le catalogue distant (lecture seule) :** les principales références SQL sont présentes et typées correctement.
- **Non validé :** équivalence complète du schéma reconstruit avec *toutes* les modifications réelles survenues en production depuis le 5 octobre. Les versions historiques ont été appliquées à des dates différentes de leurs préfixes, donc un `supabase db push` global ne doit PAS être tenté sans réconciliation.
- **Non validé :** la capacité des connexions réelles, des agents planifiés et des intégrations tierces à exécuter les nouveaux flux dans la production.
- **Non fait :** aucune migration sur la production, aucune activation de cron, aucune mise à jour des secrets ou des campagnes.

## Avant autorisation du SQL en production

1. Vérifier et figer une sauvegarde, ainsi qu'une procédure de restauration testée.
2. Rapprocher les versions historiques locales et distantes, *par contenu et objets réellement présents* (voir [réconciliation](supabase-migration-reconciliation.md)).
3. Réexécuter le diff et la migration sur une **copie de préproduction dérivée du schéma actuel** ; conserver les contrôles RLS et les tests de bout en bout.
4. Faire approuver explicitement **cette migration additive précise**, et non un push de toutes les migrations.
5. Après application approuvée : confirmer les trois tables, les politiques RLS, les droits du rôle serveur, le comportement de repli, puis effectuer une analyse SEO manuelle contrôlée avant la programmation de tâches.

Ce rapport est un *go technique pour poursuivre les validations en préproduction*, **pas une autorisation de déployer la migration en production**.
