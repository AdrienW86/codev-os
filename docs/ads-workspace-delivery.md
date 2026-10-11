# Livraison : campagnes, voix, rapports et notifications

Complément du lot suivant : [recommandations directes et rapports récurrents par client](ads-recurring-delivery.md), avec audit distant actualisé, nouvelle migration et procédure d’envoi.

Branche `feature/ads-workspace-voice-notifications`, depuis `ed8f39e`. Les six phases utilisent les services existants. Aucune migration distante, modification Google Ads, activation d’agent/cron, modification de secrets Vercel, ni envoi réel d’e-mail ou de push pendant ce lot. L’association Protection Nuisibles / `9206382986` reste intacte.

## Fonctionnement

- `/advertising` est accessible depuis les menus desktop/mobile, l’accueil et les clients. Les filtres restent dans l’URL de la page ouverte. Le compte affiché est celui associé au client ; les erreurs et métriques indisponibles restent explicites.
- Le suivi persistant est distinct de la connexion et des filtres. Une sélection vide suit zéro campagne ; une sélection historique non configurée conserve toutes les campagnes. Dashboard, assistant, analyses et veille planifiée utilisent ce suivi par défaut. L’option « Consulter aussi les autres campagnes du compte » est explicite. L’inventaire Google Ads vérifie l’appartenance avant la transaction PostgreSQL ; unicité compte/campagne, révision et verrou empêchent les contradictions entre clients. Une association portant un suivi ne peut plus être déplacée silencieusement.
- Contexte commercial et instructions globales/client sont consultables depuis la page centrale. Le budget publicitaire est distinct du budget agent historique, qui reste une indication enregistrée sans plafond d’appels imposé.
- L’IA facultative réutilise le fournisseur de l’assistant. Un appel de 25 secondes maximum, entrée de 40 000 caractères maximum, cinquante campagnes maximum, réservation par client et délai minimum d’une minute. Sortie structurée validée, preuves connues et chiffres assemblés côté serveur. Faits, hypothèses, recommandations, données absentes et limites des conversions sont distingués. Search et Local Services sont séparés ; valeur de conversion distincte du chiffre d’affaires. Aucune invention de mots-clés ou termes de recherche. Le run conserve périmètre, instructions, contexte, fournisseur/modèle et résultat ou repli déterministe explicite ; l’historique du client ouvre ces instantanés. Les règles déterministes n’utilisent pas les instructions. La simulation ne déclenche pas d’analyse réelle.
- Voix continue depuis l’accueil et le panneau : capture → silence → transcription → réponse → lecture courte → reprise. Micro fermé pendant les appels et la synthèse. Une seule boucle annulable ; arrêt visible, Échap, départ et changement de visibilité interrompent pistes, requêtes et synthèse. Silence sans phrase : douze secondes ; capture continue : trente secondes ; dictée manuelle : soixante secondes ; quatre Mo maximum. Toute erreur arrête la boucle sans réessai automatique. Le push-to-talk reste disponible, avec repli navigateur manuel. « oui » ne confirme aucune écriture. La transcription brute et l’audio ne sont pas journalisés.
- Les rapports gardent leur périmètre propre. Nouvelles versions enregistrées dans la transaction ; approbation invalidée après modification. Prévisualisation de l’e-mail en texte brut à partir des seuls champs client autorisés, adresse unique confirmée explicitement, approbation puis envoi distinct. La réservation PostgreSQL précède Resend : double clic, concurrence et retries ne renvoient pas la même version. « Accepté par Resend » ne signifie pas livré. Une réponse incertaine ou un processus interrompu laisse la tentative figée ; vérifier Resend avant une intervention manuelle. Une réponse explicitement refusée autorise une correction en nouvelle version après vérification. Aucun nouvel essai automatique.
- Notifications persistantes, cloche, compteur, lecture, préférences internes/push séparées et déduplication : rapport prêt, analyse terminée/échouée, incident important, envoi échoué/incertain. Abonnements par appareil, révocation et nettoyage 404/410 côté serveur. Dix appareils maximum. Le planificateur existant traite dix push au plus par passage ; événements de plus d’une heure ignorés. Aucun cron ajouté ou rendu plus fréquent. Notification d’écran verrouillé générique sans nom de client ni métrique, lien conservé après connexion.
- PWA : manifest, icônes, installation, état hors connexion et mise à jour volontaire. Le service worker conserve uniquement `/offline.html`, publique ; aucun cache de pages privées, API, RSC, données client ou secrets. Les exemptions d’authentification portent sur six fichiers publics exacts, en GET/HEAD seulement.

## Migrations : ordre exact

Prérequis : migrations historiques jusqu’à `20261015000000_codev_os_core.sql` incluses. Vérifier l’état distant avant une future application autorisée. Selon le contexte fourni, la migration 16 est encore en attente ; ce lot n’interroge ni ne modifie l’historique des migrations distant.

1. `20261016000000_google_ads_reports.sql` — déjà présente avant ce lot, périmètre des rapports.
2. `20261016000001_whatsapp_drive_ingestion.sql` — import photos WhatsApp, ajouté par la PR #14 ; réception désactivée tant que les accès ne sont pas configurés. Voir `docs/whatsapp-drive.md`.
3. `20261017000000_google_ads_campaign_tracking.sql` — suivi, unicité et révisions.
4. `20261018000000_google_ads_client_context.sql` — contexte commercial et réservations d’analyse.
5. `20261019000000_report_delivery_claims.sql` — versions transactionnelles et réservations d’envoi.
6. `20261020000000_notifications_web_push.sql` — notifications, préférences, abonnements et file push.

Les migrations du lot Ads ont été rejouées avec le schéma historique dans PostgreSQL jetable local. La migration WhatsApp a été vérifiée séparément dans PostgreSQL WASM (PGlite), une seule connexion, sans validation multiworkers. Les rapports historiques restent intacts ; la migration 19 est requise avant la création ou modification de rapports. Aucun `schema_migrations` écrit manuellement. Sauvegarde et vérification sur copie avant toute application future ; ne pas appliquer les migrations depuis cette PR sans validation de l’opération.

## Configuration à compléter

L’analyse réutilise `AI_PROVIDER`, `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` et `ASSISTANT_OPENAI_MODEL`/`ASSISTANT_ANTHROPIC_MODEL`. La transcription existante utilise OpenAI et `ASSISTANT_STT_MODEL`. Accès effectifs, permissions et quotas restent à vérifier sans les confondre avec les tests simulés.

Resend : `RESEND_API_KEY`, `EMAIL_FROM`, domaine vérifié dans Resend et DNS SPF/DKIM/DMARC, puis `EMAIL_SENDING_ENABLED=true` uniquement après validation humaine. La vérification locale porte sur la présence des variables, sans afficher leurs valeurs : les trois sont absentes/non renseignées dans `.env` au moment de la livraison. Aucune vérification du domaine ou des variables Vercel de production n’a été réalisée.

Push : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, puis `PUSH_SENDING_ENABLED=true` après validation humaine. Ces variables sont absentes localement ; seules des clés factices servent aux tests. La clé privée ne quitte pas le serveur. Préférences utilisateur, abonnement et autorisation navigateur restent nécessaires même si le serveur est configuré. Voir [notifications-pwa.md](notifications-pwa.md).

La voix continue exige HTTPS, MediaRecorder, AudioContext, transcription configurée et synthèse autorisée par le navigateur. Pas d’écoute garantie en arrière-plan ou écran verrouillé. Chrome/Android et desktop proposent l’installation selon leurs critères ; iOS/iPadOS 16.4 minimum pour le Web Push d’une application ajoutée à l’écran d’accueil. Safari, appareils physiques et vrai microphone restent à valider.

## Validation réalisée

- `npm test` : 615 réussis, zéro échec, 26 ignorés faute de configuration des suites d’intégration facultatives. Fournisseurs métier simulés ; aucune clé locale chargée par la suite unitaire.
- PostgreSQL 17 local : 45 contrôles du workspace, 19 contrôles des rapports Google Ads, plus une course de deux connexions indépendantes réservant exactement une tentative d’e-mail. Migrations historiques et nouvelles rejouées, permissions, isolation, révisions, versions, déduplication et révocation contrôlées.
- `npm run lint`, `npm run typecheck`, `npm run build` réussis.
- Chrome réel, tailles 1440×900 et 375×812 : 34 parcours réussis, zéro échec (24 existants et 10 nouveaux). Suivi, contexte, analyse/historique, rapport approuvé/modifié/approuvé/envoyé avec faux Resend, lecture persistante, voix continue, mode hors connexion et absence de débordement horizontal contrôlés.
- Voix : microphone, énergie audio et synthèse simulés ; endpoint de transcription intercepté dans le navigateur. Micro fermé pendant la lecture, un seul envoi, arrêt sans reprise et confirmation par bouton vérifiés. Les tests serveur séparés contrôlent formats/limites/permissions. Aucun vrai microphone ou appel réel de transcription, IA, Google Ads, Resend ou Web Push.

Commandes locales reproductibles :

```powershell
npm test
npm run lint
npm run typecheck
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ads-local.ps1
$env:E2E_WORKSPACE_ONLY='1'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-e2e-local.ps1
Remove-Item Env:E2E_WORKSPACE_ONLY
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-e2e-local.ps1
```

Les wrappers Windows nécessitent PostgreSQL local dans `.local/runtime/postgresql17/pgsql/bin`, PostgREST dans `.local/runtime/postgrest16` et Chrome installé. Ces binaires ne sont pas livrés dans Git. La copie E2E exclut `.env`, sauvegardes et fichiers ignorés ; les clés sont factices et les destinations distantes refusées par le transport du serveur de test.

L’audit npm signale une vulnérabilité de `braces` dans la chaîne des outils de lint Next déjà présente. Le correctif proposé rétrograde Next vers une autre version majeure ; cette migration n’est pas appliquée dans ce lot. Aucun paquet ajouté pour le push n’est signalé par cet audit.

## Courte validation après revue et déploiement autorisé

1. Sauvegarder, vérifier les migrations 15–20 et appliquer seulement les fichiers manquants dans l’ordre, sur une opération distincte approuvée. Garder e-mail et push désactivés.
2. Se connecter en administrateur ; vérifier refus d’un autre compte, client Protection Nuisibles et association `9206382986`. Sur desktop/mobile, modifier les filtres sans quitter `/advertising` ; comparer les chiffres avec Google Ads et leurs limites.
3. Choisir le suivi, vérifier sa persistance dans l’assistant et une analyse ; contrôler instructions et périmètre du run. Une analyse IA réelle implique le fournisseur configuré et un coût, à valider séparément.
4. Préparer un rapport, relire uniquement sa version client, approuver puis modifier pour vérifier l’invalidation. Vérifier le destinataire affiché. Aucun envoi réel tant que configuration et autorisation ne sont pas validées.
5. Tester un vrai microphone sur les navigateurs visés : phrase, lecture, reprise, arrêt dans le panneau, masquage, départ, refus micro et panne. Un « oui » reste une proposition sans exécution.
6. Installer la PWA, contrôler le cache contenant uniquement la page hors connexion, vérifier notifications internes et lecture persistante. Après validation séparée des clés et du transport, autoriser un appareil au clic, contrôler notification générique/lien après connexion puis révocation. La fréquence du planificateur existant détermine la latence ; elle n’est pas changée ici.

Références : [sorties structurées OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat), [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [idempotence Resend](https://resend.com/changelog/idempotency-keys), [Web Push iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
