# CODE-V OS — Acquisition (phase 1)

## Objet
Socle multientreprise indépendant des Publications et Ads : prospection B2B, qualification avec preuves, brouillons de messages et listes d'opposition.

## Inclus dans cette PR
- Migration additive `20261107000000_acquisition_foundation.sql` : espaces par entreprise, prospects catégorisés, preuves, expéditeurs, modèles, brouillons et exclusions.
- Contrôles « arrêt d'urgence », découverte et envoi **désactivés par défaut** dans chaque espace.
- Un expéditeur n'a qu'une référence opaque à ses secrets ; aucun mot de passe SMTP dans les tables.
- Tables avec RLS activé et aucun accès direct `anon`/`authenticated`. Les futures routes devront utiliser l'authentification admin unique Clerk avant tout accès service_role.
- Aucune donnée créée, aucune recherche, aucun e-mail envoyé.

## Ne PAS déployer sans vérification
1. Relire la migration et les politiques RLS avec le modèle exact de permission existant.
2. Exécuter la migration d'abord dans une base isolée, tester schéma, contraintes et protection des données.
3. Ajouter des tests DB : isolation `workspace_id`, statuts et transitions, dédoublonnage, refus avant envoi et défaut sécurisé.
4. Vérifier `npm run typecheck`, lint, test, build sur la branche avant merge.
5. Déployer la migration avant le code qui dépend des tables.

## Suite, PR dédiées
1. Navigation /acquisition, API admin seulement, CRM et configuration des espaces, données CODE-V internes.
2. Découverte par cinq catégories, preuves datées et qualification explicable, respect des règles des sources.
3. Modèles français par catégorie, variantes IA fondées uniquement sur des faits vérifiés, validation humaine.
4. Adaptateurs e-mail SMTP/IMAP/API, secrets chiffrés/stockage sécurisé, vérification DNS, liens d'opposition et rebonds.
5. File durable, unicité d'envoi, quotas comprenant relances, état inconnu après timeout, reprise sûre et kill switch.
6. Tableau de bord, réponses, suivi, mesures et tests e2e.

## Règles métier non négociables
- CODE-V est l'espace pilote ; chacun des futurs clients a son propre expéditeur, sa liste, ses quotas, ses templates et ses campagnes.
- Aucune expédition réelle sans validation du prestataire et conformité RGPD/conditions de la source.
- Les 50 e-mails/jour sont un **objectif maximum**, pas un quota initial. Les relances comptent aussi.
- Adresse collectée = preuve de provenance et pertinence B2B ; pas de message fondé sur un défaut non observé.
- Suppressions et oppositions obligatoires, gestion des rebonds, suspension automatique.
- Ne jamais contourner les quotas par multiplication d'identités.
- Les tables et la migration ne constituent pas un moteur d'envoi fonctionnel.
