# Intégrations

Toutes les intégrations sont **côté serveur** ; les secrets ne transitent jamais par le navigateur. L’état réel est visible dans **Paramètres → Connexions** (✓ configuré, ○ à configurer, ! configuration partielle ou dernière synchronisation en erreur). Chaque appel passe par `providerJson` (hôtes en liste blanche, délai, erreurs normalisées : `not_configured`, `unauthorized`, `rate_limited`, `timeout`, `unavailable`, `malformed`, `blocked`, `not_found`) ou par `safeGet` pour les URL non maîtrisées.

Pour chaque intégration : variables, callback, scopes, vérification.

<a id="openai"></a>
## OpenAI — assistant, transcription, Publications

- **Variables** : `OPENAI_API_KEY` ; facultatif `ASSISTANT_OPENAI_MODEL` (défaut `gpt-4.1-mini`), `ASSISTANT_STT_MODEL` (défaut `whisper-1`), `AI_PROVIDER=openai`.
- **Callback / scopes** : aucun (clé API).
- **Vérifier** : Paramètres → Connexions → OpenAI ✓ ; sur l’accueil, « Quelles sont mes urgences ? » répond sans la mention « mode simplifié ».
- Sans clé : l’assistant fonctionne en mode déterministe ; la dictée se replie sur la reconnaissance vocale du navigateur.

### Diagnostiquer « IA indisponible »

1. **Paramètres → Connexions → « Tester la connexion IA »** : indique le fournisseur et les modèles retenus par le déploiement en cours (environnement + commit), puis exécute **les mêmes requêtes que l’usage réel** — une réponse minimale de l’assistant et la transcription d’une seconde de silence (coût négligeable). Lire la liste des modèles ne suffit pas : une clé peut lire `GET /v1/models` sans avoir le droit d’appeler un modèle. La clé n’est jamais affichée.
   - `invalid_api_key` : OpenAI ne reconnaît pas la clé.
   - `missing_scope` (HTTP 401, portée indiquée, ex. `api.model.audio.request`) : clé reconnue mais sans la permission d’appeler le modèle — permission « Model capabilities » de la clé, ou rôle insuffisant (Reader) sur le projet OpenAI. Remplacer la clé ne change rien tant que le rôle ou la permission ne sont pas corrigés.
2. Le message de l’assistant précise désormais la raison du repli : quota épuisé (`insufficient_quota` → facturation du compte OpenAI), clé refusée, modèle inaccessible, requête refusée (`unsupported_parameter`…), délai, indisponibilité.
3. Logs Vercel (Functions) : ligne `[assistant] Fournisseur IA en échec` avec `provider`, `model`, `kind`, `status`, `code` — jamais la clé, les en-têtes ni le corps des réponses. Une ligne `[assistant] Outil en échec` signale au contraire une erreur de données, sans lien avec l’IA.
4. Une variable ajoutée ou modifiée dans Vercel ne s’applique qu’aux **nouveaux déploiements** : redéployer la production après tout changement.

<a id="anthropic"></a>
## Anthropic (Claude) — assistant

- **Variables** : `ANTHROPIC_API_KEY` ; facultatif `ASSISTANT_ANTHROPIC_MODEL` (défaut `claude-sonnet-5-5`), `AI_PROVIDER=anthropic`.
- **Vérifier** : comme OpenAI. Si les deux clés sont présentes, `AI_PROVIDER` choisit ; sinon OpenAI est utilisé en premier.

<a id="voix"></a>
## Voix

- Dictée : `MediaRecorder` → `/api/assistant/transcribe` (OpenAI). Audio ≤ 4 Mo, 60 s maximum, ni stocké ni journalisé.
- Repli : `SpeechRecognition` du navigateur (Chrome, Edge, Safari). Firefox : saisie au clavier.
- Lecture : `speechSynthesis` (voix française si disponible ; message explicite sinon).
- **Vérifier** : bouton micro → autoriser → parler → la demande s’affiche et part ; micro refusé → message « Accès au micro refusé ».

- **Diagnostiquer un 502 de `/api/assistant/transcribe`** : Paramètres → Connexions → « Tester la connexion IA » vérifie aussi le modèle de transcription (`ASSISTANT_STT_MODEL`, défaut `whisper-1`), sans audio ni coût. Logs Vercel : `[voice] Transcription en échec` avec `model`, `mime`, `container`, `size`, `kind`, `status`, `code` (jamais la clé, l’audio ni la transcription). L’interface affiche la raison (quota, clé, modèle, format…).

<a id="search-console"></a>
## Google Search Console — Données et performances, Agent SEO, rapports

Un compte Google (celui de l’agence) est autorisé **une fois** en OAuth 2.0 ; chaque client est ensuite associé à **une** propriété de ce compte. Une propriété ne peut être associée qu’à un seul client.

- **Scope** : `https://www.googleapis.com/auth/webmasters.readonly` uniquement (lecture seule). La demande utilise `include_granted_scopes=false` : le jeton Search Console ne cumule jamais les scopes Business Profile ou Drive, et ceux-ci ne sont pas modifiés.
- **URI de redirection à ajouter** dans Google Cloud Console → API et services → Identifiants → client OAuth Web « CODE-V OS » → *URI de redirection autorisés* (ne pas supposer qu’elles existent déjà) :
  - production : `https://os.code-v.fr/api/integrations/search-console/callback`
  - développement local (facultatif) : `http://localhost:3000/api/integrations/search-console/callback` (avec `PUBLICATIONS_OAUTH_BASE_URL=http://localhost:3000` en local)
  - L’URI exacte attendue est aussi affichée dans Paramètres → Connexions → Google Search Console.
- **Variables** (Vercel → Settings → Environment Variables, environnement Production) :
  - `PUBLICATIONS_OAUTH_BASE_URL=https://os.code-v.fr` (déjà utilisée par les connexions Publications) ;
  - `PUBLICATION_CREDENTIALS_KEY` / `PUBLICATION_CREDENTIALS_KEY_ID` (clé AES-256-GCM existante ; domaine de chiffrement distinct pour Search Console) ;
  - `GOOGLE_SEARCH_CONSOLE_CLIENT_ID` / `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET` : **facultatives**. Absentes, le client OAuth Web déjà configuré pour Google Business Profile (`GOOGLE_BUSINESS_PROFILE_CLIENT_ID/SECRET`, même projet Google Cloud) est réutilisé. Une seule des deux définie : connexion désactivée (jamais complétée par l’autre client).
  - `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN` : ancien mode (jeton serveur), utilisé seulement tant qu’aucune connexion OAuth n’est établie.
  - `CRON_SECRET` + tâche planifiée vers `/api/internal/scheduler/tick` (voir automation.md) pour la synchronisation quotidienne.
- **Migration** : `supabase/migrations/20261022000000_search_console_integration.sql` (additive) à appliquer sur Supabase avant usage.
- **Connexion** : Paramètres → Connexions → « Connecter Google Search Console » → consentement Google → retour avec la liste des propriétés validées (propriétaire, accès complet ou restreint). État OAuth à usage unique (empreinte seule en base, 10 min, même administrateur), PKCE S256, jeton de rafraîchissement chiffré (`integration_credential_secrets`, rôle serveur uniquement), jetons d’accès jamais stockés.
- **Par client** : fiche client → Agents → Sources de données → propriété choisie parmi celles découvertes (`sc-domain:exemple.fr` ou `https://www.exemple.fr/`).
- **Synchronisation** : quotidienne (7, 30 et 90 jours, au plus une fois par client et par jour, 3 essais max) ; à la demande depuis « Données et performances » (« Synchroniser maintenant ») ; automatique à l’ouverture si l’instantané a plus de 6 h. Données `final` uniquement (≈ 2-3 jours de retard) : la période affichée est alignée sur le dernier jour consolidé, comparée à la période précédente de même durée. Historique quotidien dans `search_console_daily_metrics` (au-delà des 16 mois conservés par Google).
- **Agrégation** : CTR = clics ÷ impressions ; position moyenne pondérée par les impressions. Les requêtes anonymisées par Google ne figurent pas dans le tableau des requêtes (les totaux les incluent).
- **Révocation** : « Déconnecter » supprime le jeton de CODE-V OS sans appeler Google, car le client OAuth peut être partagé avec Google Business Profile et une révocation Google retirerait aussi cet accès pour ce compte. Révocation complète, en connaissance de cause : https://myaccount.google.com/permissions. Un accès révoqué côté Google est détecté (`invalid_grant`) et affiché « Accès révoqué » ; il suffit de reconnecter.
- **Vérifier** : Paramètres → Connexions → statut « Connecté » et propriétés listées ; Données et performances → onglet « Référencement · Google Search Console » ; Automatisation « Analyse SEO » → résumé « Search Console : N clics ».

<a id="pagespeed"></a>
## PageSpeed Insights

- **Variables** : facultatif `PAGESPEED_API_KEY` (quota plus élevé). Fonctionne sans clé.
- **Vérifier** : l’analyse SEO d’un client avec site renseigné affiche « PageSpeed mobile : N/100 ».

<a id="monitoring"></a>
## Contrôles HTTP — Agent Monitoring

- **Variables** : aucune. Seules les URL publiques (site renseigné sur la fiche client) sont contrôlées ; adresses privées refusées.
- Clients concernés : services Maintenance ou Site web actifs.
- **Vérifier** : automatisation « Contrôle des sites » → Exécuter maintenant → « N en ligne » ; un site en panne ouvre un incident et une action « Correctif technique » à valider.

<a id="vercel"></a>
## Vercel — déploiements + Web Analytics (lecture)

- **Variables** : `VERCEL_TOKEN` (jeton en lecture), facultatif `VERCEL_TEAM_ID`.
- **Par client** : fiche client → Agents → Sources de données → projet Vercel (`prj_…` ou nom).
- **Web Analytics** : CODE-V OS récupère les pages vues, visiteurs, pages/routes principales, référents, pays, appareils, systèmes, navigateurs et événements personnalisés via l’API publique Vercel. Les données sont agrégées et stockées par période dans `metric_snapshots`.
- **Comparaison** : chaque synchronisation compare les totaux de trafic à la période précédente de même durée et prépare des signaux factuels (hausse/baisse, concentration du trafic, absence de conversions instrumentées).\n- **Cockpit** : le bloc Audience & conversions est interactif et sépare Vue d’ensemble, Pages, Acquisition, Audience et Conversions.\n- **Rapports** : lors de la génération d’un rapport hebdomadaire ou mensuel, CODE-V OS tente de récupérer une photographie Vercel correspondant exactement à la période du rapport, avec pages principales, acquisition, appareils et événements. Une panne Vercel n’empêche pas la génération du reste du rapport.
- **Événements métier** : les formulaires, clics téléphone, WhatsApp, CTA, etc. apparaissent uniquement si le site envoie déjà des événements personnalisés avec `@vercel/analytics` (par exemple `lead_form_submit`, `phone_click`, `whatsapp_click`).
- **Vérifier** : lancer « Contrôler le site maintenant » sur la fiche client ; le bloc **Audience & conversions Vercel** doit afficher le dernier instantané.
- **Speed Insights** : les données temps réel Vercel restent consultables dans Vercel. CODE-V OS conserve actuellement PageSpeed Insights pour les mesures de performance automatisées côté serveur ; l’ingestion Speed Insights réelle nécessite un flux Vercel Metrics/Drain séparé et n’est pas assimilée à PageSpeed.

<a id="github"></a>
## GitHub — derniers changements (lecture)

- **Variables** : `GITHUB_TOKEN` — jeton à granularité fine, **lecture seule** (`Contents: read`, `Metadata: read`) sur les dépôts concernés.
- **Par client** : sources de données → dépôt `organisation/depot`.
- CODE-V OS ne modifie jamais un dépôt client et n’y installe rien.

<a id="google-ads"></a>
## Google Ads — lecture seule

- **Variables** : `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN` ; facultatif `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (compte gestionnaire).
- **Scope** : `https://www.googleapis.com/auth/adwords`. Le jeton développeur doit être approuvé (niveau « Basic » minimum pour les comptes réels).
- **Par client** : fiche client → Agents → Google Ads (identifiant client à 10 chiffres) ; exploration dans l’onglet **Campagnes**. Voir [google-ads-read-only.md](google-ads-read-only.md).
- **Lecture seule** : tableau de bord par campagne, rapports Google Ads à périmètre figé, analyse déterministe (sans IA). **Aucune modification de campagne ni de budget**.

<a id="email"></a>
## E-mail (Resend) — envoi des rapports

- **Variables** : `RESEND_API_KEY`, `EMAIL_FROM` (domaine vérifié), `EMAIL_SENDING_ENABLED=true` pour activer.
- Tant que l’envoi n’est pas activé : seul « Marquer comme envoyé manuellement » est proposé. Seule la version **approuvée** d’un rapport peut être envoyée ; clé d’idempotence par version.
- **Vérifier** : rapport approuvé → « Envoyer par e-mail » visible ; journal `report.sent`.

<a id="veille"></a>
## Veille tech & IA (RSS)

- **Variables** : aucune. Sources publiques définies dans `lib/news/sources.ts` (https uniquement).
- Pipeline : récupération bornée (SSRF, 2 Mo, 10 s) → analyse RSS/Atom tolérante → normalisation (paramètres de suivi retirés) → déduplication → score (récence, poids de la source, pertinence) → stockage. L’accueil affiche **3 actualités au plus**.
- **Vérifier** : automatisation « Veille tech & IA » → Exécuter maintenant → « N nouvelle(s) actualité(s) ».

## Publications (Meta, Google Business Profile, Google Drive)

Inchangé dans ce lot : voir [publications-oauth.md](publications-oauth.md), [publications-meta-setup.md](publications-meta-setup.md), [publications-architecture.md](publications-architecture.md). Les kill switches et la validation humaine avant publication restent en vigueur.

## Planificateur

`CRON_SECRET` : voir [automation.md](automation.md).
