# Publications — connexions OAuth (Lot 4.3 P11-a)

Connexion réelle de **Meta** (Pages Facebook + comptes Instagram professionnels liés) et de **Google Business
Profile** depuis l’onglet *Configuration* d’un projet Publications. Aucune publication n’est envoyée : le moteur de
diffusion (P10) n’a aucun publisher réel et les interrupteurs restent fermés (`emergency_stop = true`,
`publishing_enabled = false`).

## Variables d’environnement (serveur uniquement, noms seulement)

| Variable | Rôle |
|---|---|
| `PUBLICATIONS_OAUTH_BASE_URL` | Origine publique du cockpit (`https://…`, sans chemin). `http://localhost…` accepté en développement. |
| `META_APP_ID` | Identifiant de l’app Meta. |
| `META_APP_SECRET` | Secret de l’app Meta. |
| `GOOGLE_BUSINESS_PROFILE_CLIENT_ID` | Client OAuth Google dédié (≠ Drive / Google Ads). |
| `GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET` | Secret du client OAuth Google. |
| `PUBLICATION_CREDENTIALS_KEY` | Clé AES-256 du coffre : 32 octets aléatoires en base64. |
| `PUBLICATION_CREDENTIALS_KEY_ID` | Identifiant de cette clé (`[a-z0-9_-]`, ex. `k2026a`). |
| `PUBLICATION_CREDENTIALS_PREVIOUS_KEY` / `_KEY_ID` | Optionnels, uniquement pendant une rotation de clé. |

Aucune de ces variables n’a le préfixe `NEXT_PUBLIC_`. Une configuration absente ou invalide désactive le provider
concerné (bouton « Connecter » indisponible, message générique) : *fail closed*.

Générer une clé : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Meta (Facebook Login ou Facebook Login for Business — flux manuel)

- **URL de callback exacte** : `<PUBLICATIONS_OAUTH_BASE_URL>/api/publications/oauth/meta/callback`
- Graph API **v26.0** (dialogue `https://www.facebook.com/v26.0/dialog/oauth`, échange
  `https://graph.facebook.com/v26.0/oauth/access_token`, inspection `debug_token`).
- Le code est échangé côté serveur, puis converti en **jeton utilisateur longue durée** (`fb_exchange_token`,
  ~60 jours). Il est prolongé par « Vérifier la connexion » tant qu’il est valide ; au-delà, reconnecter.
- Appels de lecture signés avec `appsecret_proof` (HMAC-SHA256 du jeton avec le secret de l’app).
- Les jetons de Page renvoyés par Meta ne sont **pas** conservés : ils seront redérivés du jeton utilisateur au
  moment d’une publication (P11-b).

### Permissions demandées (référence officielle *Permissions*)

| Permission | Pourquoi | App Review |
|---|---|---|
| `pages_show_list` | Lister les Pages gérées (`/me/accounts`). **Obligatoire** : sans elle la connexion est refusée. | Revue légère |
| `pages_read_engagement` | Lire la Page ; requise pour publier sur Instagram via Facebook Login. | Oui pour l’accès avancé |
| `pages_manage_posts` | Publier sur la Page (P11-b) — demandée maintenant pour éviter un second consentement. | Oui |
| `instagram_basic` | Lire le compte Instagram professionnel lié (`instagram_business_account`). | Oui pour l’accès avancé |
| `instagram_content_publish` | Publier sur Instagram (P11-b). | Oui |

Option `META_PAGE_ROLES_VIA_BUSINESS_MANAGER=true` : ajoute `ads_management` et `ads_read`, exigées par Meta pour
publier sur Instagram **quand ton rôle sur la Page vient d’un Business Manager** (guide officiel *Content
Publishing*). Désactivée par défaut (permissions minimales). `business_management` n’est jamais demandée.

Deux modes de connexion, selon le type d’app :
- **Facebook Login** (paramètre `scope`, liste ci-dessus) — `META_LOGIN_CONFIG_ID` vide ;
- **Facebook Login for Business** (app de type *Business*) — `META_LOGIN_CONFIG_ID` = identifiant de la
  configuration créée dans Meta Developers (type de jeton : *User access token*, mêmes permissions). La
  documentation officielle impose `config_id` **à la place** de `scope`.

Accès **Standard** (automatique, sans App Review) : les permissions ne peuvent être accordées que par les
personnes ayant un **rôle sur l’app**. CODE-V OS n’a qu’un utilisateur humain, l’administrateur : s’il est
admin de l’app et gère les Pages de ses clients, l’accès Standard suffit. L’accès **Avancé** (App Review +
vérification d’entreprise) n’est nécessaire que si des personnes **sans rôle sur l’app** (par exemple un client)
devaient se connecter elles-mêmes.

### Configuration Meta Developers (à faire par l’administrateur)

1. Créer une app (type *Business* avec **Facebook Login for Business** + une configuration, ou produit
   **Facebook Login** classique).
2. *Valid OAuth Redirect URIs* : l’URL de callback exacte ci-dessus (sans variante ; en local
   `http://localhost:3000/...`, voir `docs/publications-meta-setup.md`).
3. Activer *Enforce HTTPS* et *Use Strict Mode for redirect URIs*.
4. Ajouter les comptes de test comme rôles de l’app tant que l’app est en Development.
5. Prérequis Instagram : compte **professionnel** (Business ou Creator) lié à la Page Facebook ; une Page sans
   Instagram reste connectable (Facebook seulement).

## Google Business Profile

- **Redirect URI exacte** : `<PUBLICATIONS_OAUTH_BASE_URL>/api/publications/oauth/google-business-profile/callback`
- Flux OAuth 2.0 *web server* : `https://accounts.google.com/o/oauth2/v2/auth`, `access_type=offline`,
  `prompt=consent`, **PKCE S256** (vérificateur dérivé côté serveur, jamais stocké ni envoyé au navigateur),
  échange sur `https://oauth2.googleapis.com/token`.
- **Scope unique** : `https://www.googleapis.com/auth/business.manage` (aucun scope Google Ads / Drive).
- Comptes : *My Business Account Management API* v1 (`accounts.list`, 20 par page) ; fiches : *My Business
  Business Information API* v1 (`accounts.locations.list`, `readMask=name,title`, 100 par page).
- Expiration de la connexion : le jeton d’accès Google (≈ 1 h) est renouvelé depuis le jeton de rafraîchissement ;
  la connexion enregistre donc `expires_at = null` quand un jeton de rafraîchissement existe (sinon la readiness P10
  bloquerait toute publication une heure après la connexion).

### Configuration Google Cloud (à faire par l’administrateur)

1. Demander l’accès aux API Business Profile (formulaire officiel ; quota initial à 0 tant que non approuvé).
2. Activer **My Business Account Management API** et **My Business Business Information API** (la publication de
   posts, P12, utilise aussi l’API Google My Business v4 — `mybusiness.googleapis.com`).
3. Écran de consentement OAuth : type *External* ou *Internal* selon l’organisation, scope `business.manage`,
   utilisateurs de test tant que l’app n’est pas publiée.
4. Créer un client OAuth **Web application** dédié ; *Authorized redirect URIs* : l’URI exacte ci-dessus.
5. Prérequis : le compte Google qui autorise doit gérer les fiches (propriétaire ou gestionnaire).

## Coffre des credentials

- Table `publication_credential_secrets` : chiffré AES-256-GCM (IV aléatoire de 96 bits, référence et provider liés
  comme données authentifiées). RLS sans policy, rôle serveur uniquement, lignes immuables.
- La base métier (`client_connections.credential_reference`) ne contient que `vault:connection/<uuid>`.
- **Rotation de clé** : nouvelle clé dans `PUBLICATION_CREDENTIALS_KEY` / `_KEY_ID`, ancienne dans
  `PUBLICATION_CREDENTIALS_PREVIOUS_KEY` / `_KEY_ID` ; les secrets réécrits (« Vérifier la connexion », reconnexion)
  passent sur la nouvelle clé ; retirer l’ancienne quand plus aucun secret ne l’utilise.
- « Déconnecter » supprime le secret du coffre ; la connexion et les comptes restent pour l’historique.
- La révocation distante (Meta `DELETE /me/permissions`, Google `oauth2.googleapis.com/revoke`) n’est **pas**
  appelée automatiquement (P11-b).

## Sécurité du flux

- Démarrage par Server Action (même origine), état aléatoire de 256 bits dont seule l’empreinte SHA-256 est
  stockée : usage unique, 10 minutes, lié au provider, au client CODE-V, à l’admin et au projet.
- Callback derrière le proxy Clerk admin et `requireAdmin` ; l’état est consommé **avant** tout échange de code ;
  redirection 303 vers un chemin interne fixe, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.
- Journaux : provider, étape, classe d’erreur. Jamais de jeton, code, état, référence ni réponse provider.
