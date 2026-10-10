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

## Analyse personnalisée

Migration suivante : `20261018000000_google_ads_client_context.sql` (contexte commercial et réservations d'analyse). Les instructions globales et celles de l'affectation existante sont réutilisées ; les budgets publicitaire et agent restent distincts. Le champ historique du budget agent est une indication enregistrée, sans plafond d'appels actuellement imposé.

L'IA est déclenchée explicitement ; elle réutilise `selectAIProvider` et les modèles serveur de l'assistant (`AI_PROVIDER`, `ASSISTANT_OPENAI_MODEL`, `ASSISTANT_ANTHROPIC_MODEL`). Un seul appel de 25 secondes maximum, entrée limitée à 40 000 caractères, campagnes limitées à 50, réservation par client et délai minimum d'une minute. La sortie cite uniquement des preuves connues ; les valeurs affichées sont assemblées côté serveur. Le run conserve le périmètre, les instructions, le contexte, le fournisseur/modèle et le résultat ou son repli. Les règles déterministes n'utilisent pas les instructions.

Documentation consultée : [sorties structurées OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat), [contrôle des accès Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security). La validation utilise des fournisseurs simulés ; aucun coût ou accès réel à un fournisseur IA n'est validé ici.
