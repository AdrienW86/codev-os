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

1. **Paramètres → Connexions → « Tester la connexion IA »** : indique le fournisseur et le modèle retenus par le déploiement en cours (environnement + commit), puis vérifie la clé par `GET /v1/models/{modèle}` — aucune génération, aucun coût. La clé n’est jamais affichée.
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

<a id="search-console"></a>
## Google Search Console — Agent SEO

- **Variables** : `GOOGLE_SEARCH_CONSOLE_CLIENT_ID`, `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`, `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN`.
- **Scope** : `https://www.googleapis.com/auth/webmasters.readonly` (lecture seule).
- **Callback** : aucun dans l’application. Le jeton de rafraîchissement s’obtient une fois (OAuth Playground ou script local) avec un compte ayant accès aux propriétés des clients.
- **Par client** : fiche client → Agents → Sources de données → propriété (`sc-domain:exemple.fr` ou `https://www.exemple.fr/`).
- **Vérifier** : Automatisation « Analyse SEO » sur un client → Exécuter maintenant → résumé « Search Console : N clics » ; Observabilité sans erreur de synchronisation.

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
## Vercel — déploiements (lecture)

- **Variables** : `VERCEL_TOKEN` (jeton en lecture), facultatif `VERCEL_TEAM_ID`.
- **Par client** : sources de données → projet Vercel (`prj_…` ou nom).
- **Vérifier** : un dernier déploiement en échec ouvre l’incident « Dernier déploiement Vercel en échec ».

<a id="github"></a>
## GitHub — derniers changements (lecture)

- **Variables** : `GITHUB_TOKEN` — jeton à granularité fine, **lecture seule** (`Contents: read`, `Metadata: read`) sur les dépôts concernés.
- **Par client** : sources de données → dépôt `organisation/depot`.
- CODE-V OS ne modifie jamais un dépôt client et n’y installe rien.

<a id="google-ads"></a>
## Google Ads — lecture seule

- **Variables** : `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN` ; facultatif `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (compte gestionnaire).
- **Scope** : `https://www.googleapis.com/auth/adwords`. Le jeton développeur doit être approuvé (niveau « Basic » minimum pour les comptes réels).
- **Par client** : fiche client → Agents → Google Ads (identifiant client à 10 chiffres). Voir [google-ads-read-only.md](google-ads-read-only.md).
- **V1** : surveillance uniquement (coûts, conversions, anomalies). **Aucune modification de campagne** : les optimisations sont des actions manuelles à valider.

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
