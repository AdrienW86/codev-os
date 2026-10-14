# Historique des migrations Supabase — état contrôlé le 15 octobre 2026

Ce document accompagne le test statique `tests/supabase-migration-versions.test.mjs`. Il ne déclenche aucune migration distante.

## Constat en lecture seule

L'historique réel du projet CODE-V OS a été consulté par l'API de migrations Supabase. Le nom `whatsapp_media_library` y figure comme **appliqué**, sous la version distante `20261012063738`. Or le dépôt actuel contient toujours le fichier local `20261023000000_whatsapp_media_library.sql`.

D'autres migrations ont également été enregistrées côté Supabase sous des versions correspondant à leur date d'application plutôt qu'à leur préfixe de fichier Git. Ne supposez donc jamais que les historiques distants et locaux sont alignés uniquement par leur numéro.

## Conséquence pour les anciennes PR

- La PR #28 (SEO V2) ajoute `20261023000000_seo_keyword_opportunities.sql`, qui entre en collision avec le préfixe actuel de la migration WhatsApp : ne pas la fusionner telle quelle.
- La PR #30 propose de renommer le fichier WhatsApp en `20261024000000`, mais sa description affirme à tort que cette migration n'a jamais été appliquée. Une simple renumérotation sans réconciliation de l'historique n'est pas une preuve qu'un `db push` est sans danger.
- Le nouveau test CI bloque les doublons de versions **dans la branche fusionnée**, mais ne prouve pas l'alignement avec les bases distantes.

## Procédure de réconciliation exigée

1. Avant tout déploiement SQL, lister les migrations distantes actuelles et les fichiers locaux sur le `master` à jour.
2. Associer les migrations par contenu et nom fonctionnel, pas uniquement par préfixe, puis vérifier les tables, RPC, contraintes et politiques RLS déjà présentes sur la cible.
3. Comparer le SQL exact d'une migration à l'état réel du schéma dans une **copie isolée**, et vérifier le résultat d'un nouveau déploiement sur cette copie.
4. Préparer un plan différentiel explicite avec sauvegarde et restauration testée ; demander une approbation distincte avant toute écriture sur la production.
5. Ne jamais modifier manuellement la table `supabase_migrations.schema_migrations` pour masquer un désaccord d'historique.

État ponctuel du 15 octobre 2026 uniquement : refaire la lecture de la production au moment de l'intervention.
