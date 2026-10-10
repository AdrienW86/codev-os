# Campagnes, voix et notifications — travail depuis ed8f39e

## Phases et points de validation

1. Page centrale `/advertising`, navigation desktop/mobile et liens : réutiliser le dashboard, vérifier la conservation de l'URL et les états sans connexion.
2. Affectation persistante : migration additive, unicité compte/campagne, contrôle d'appartenance côté serveur, tests SQL locaux et services simulés. Les rapports gardent leur périmètre figé.
3. Contexte commercial et IA facultative : réutiliser les instructions agent et affectation, valider la sortie et enregistrer le contexte du run. Tester les sorties invalides et le repli explicite.
4. Conversation continue : réutiliser transcription et synthèse du navigateur, borner le cycle et annuler sur arrêt/départ. Tester au navigateur avec micro simulé ; distinguer du vrai microphone.
5. Rapports : prévisualisation, destinataire explicite, verrouillage de la version approuvée avant l'appel Resend, tests de concurrence avec fournisseur simulé.
6. Notifications, PWA, Web Push : centre persistant, préférences, déduplication, abonnements protégés, transport simulé, aucun cache de données authentifiées.

## Garde-fous

Aucune migration distante, modification de campagne Google Ads, modification de secrets Vercel ou activation d'automatisation. Aucun e-mail ni push réel pendant la validation. L'association Protection Nuisibles / 9206382986 n'est pas modifiée. Les données de test utilisent uniquement des identifiants factices et une base locale jetable.

Les résultats de validation, migrations et prérequis de mise en production seront consignés ici à la livraison.

## Validation intermédiaire — affectation

39 tests unitaires/simulés Google Ads et suivi passent ; typecheck réussi. PostgreSQL 17 local : les migrations sont rejouées depuis le schéma historique, les 17 contrôles du suivi et les contrôles des rapports existants passent. Aucun appel Google Ads réel. La migration de suivi est créée par la CLI puis renommée pour suivre la migration de rapports déjà présente : `20261016000000_google_ads_reports.sql`, puis `20261017000000_google_ads_campaign_tracking.sql`.

Un compte portant une sélection persistante ne peut pas être réaffecté silencieusement (clé étrangère). Un changement de compte nécessitera un parcours explicite de retrait du suivi ; aucune association existante n'est changée par ce lot.
