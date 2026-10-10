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
# Voix continue

Une seule boucle annulable alterne capture, pause détectée, transcription serveur, demande, lecture courte et reprise. Le micro est fermé avant tout appel serveur et pendant la synthèse. Arrêt visible depuis l’accueil et le panneau, Échap, changement de visibilité, navigation et démontage annulent les ressources. Silence sans phrase pendant douze secondes arrête la session ; capture continue limitée à trente secondes, dictée manuelle à soixante secondes et quatre Mo. Une erreur arrête la boucle sans nouvelle tentative automatique. Le repli navigateur reste manuel.

La voix continue exige HTTPS, MediaRecorder, AudioContext, une transcription configurée et une synthèse vocale autorisée par le navigateur. Aucun fonctionnement en arrière-plan ou écran verrouillé n’est garanti. « oui » ne confirme jamais une écriture. Les tests unitaires utilisent des énergies et une synthèse simulées ; ils ne valident pas un vrai microphone.

# Rapports et e-mail

La migration `20261019000000_report_delivery_claims.sql` suit la migration 18. Les nouvelles versions sont enregistrées dans la transaction du rapport ; les versions historiques restent intactes. Toute modification requiert une nouvelle version et invalide l’approbation. La prévisualisation utilise uniquement une liste autorisée de champs de `client_content`, en texte brut. L’administrateur confirme une adresse unique et la version affichée, approuve, puis envoie séparément.

Le verrou PostgreSQL réserve une tentative avant Resend. Aucun nouvel essai automatique pour cette version : double clic, concurrence et réessai après délai ne renvoient rien. Une réponse incertaine ou un processus interrompu laisse le rapport figé, à vérifier dans Resend avant intervention. La clé Resend complète ce verrou, mais sa conservation limitée à vingt-quatre heures ne suffit pas à assurer l’unicité permanente ([documentation Resend](https://resend.com/changelog/idempotency-keys)). Le statut « accepté » ne confirme pas la livraison. Une erreur explicitement refusée permet de corriger en nouvelle version après vérification.

Configurer hors dépôt `RESEND_API_KEY`, un `EMAIL_FROM` dont le domaine est vérifié dans Resend (DNS SPF/DKIM et DMARC), puis `EMAIL_SENDING_ENABLED=true` seulement après validation humaine. Aucun secret, domaine, e-mail réel ou paramètre de production n’a été modifié. Tests : concurrence et délais avec transport simulé, garde des versions et réservation en PostgreSQL jetable local.

