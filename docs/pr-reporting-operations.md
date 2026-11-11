# Rapports personnalisés multi-sources et mise en file planifiée atomique

Les rapports existants se limitent aux semaines et mois clos. Cette branche ajoute une préparation par client, période et sources Ads/SEO/site/activité, puis réutilise l'aperçu, l'approbation de version, le PDF et les confirmations d'envoi existants. Les exports sont validés avant stockage ; les préparations sont dédupliquées et une modification invalide l'approbation. Les périodes, sources indisponibles et limites de fraîcheur restent visibles, sans métrique inventée ni mutation Google Ads.

Le scheduler existant insère le job et avance son échéance dans une transaction via la RPC privée `codev_enqueue_automation`. La réservation manuelle conditionnelle et les protections de bail déjà fusionnées dans #91 sont conservées ; elles ne nécessitent aucune nouvelle RPC.

Les PDF (#89), le Directeur IA (#90) et la supervision des automatisations (#91) sont déjà fusionnés dans `master` après checks GitHub/Vercel réussis. Ils ne sont pas des nouveautés de cette PR.

**PR à conserver en brouillon.** Deux migrations locales sont nécessaires : `20261110000000_professional_client_reports.sql` et `20261111000000_atomic_automation_enqueue.sql`. Elles n'ont pas été appliquées à distance et l'état réel de Supabase n'a pas été lu. La seconde est obligatoire avant le déploiement du moteur. Audit distant, autorisation explicite et contrôles unitaires sont requis avant application ; aucun `db push` global. La migration SEO V2 conserve son autorisation de production distincte.

Validation finale après réintégration de `master` : **1 121 tests, 1 077 réussis, zéro échec, 44 ignorés** ; lint sans erreur (deux avertissements existants), typecheck et build réussis ; **15 tests PostgreSQL 17 natifs réussis, aucun ignoré** ; Chromium desktop/mobile réussi pour rapports, Directeur IA et supervision. Les essais navigateur utilisent une session et des données simulées ; les tests SQL utilisent des bases locales jetables avec plusieurs connexions réelles. Les checks et la preview de cette PR doivent être vérifiés sur son SHA final.

La revue a également corrigé les compteurs Analytics malformés devenant de faux zéros (anciens caches exclus des nouveaux rapports) et les opportunités SEO actives masquées par des lignes fermées avant la limite de requête. Les contraintes SQL imposent des sources uniques cohérentes avec la famille et une période de 1 à 366 jours.

Aucun envoi réel, prospection, publication externe, changement de secrets, activation de cron ou modification de campagne Ads. Le pilote Protection Nuisibles avec identifiants réels reste à réaliser en préparation seule. **NO-GO pour merge ou déploiement avant validation des migrations et checks finaux.** Bilan détaillé : [livraison et limites](2026-10-15-reporting-operations-delivery.md).
