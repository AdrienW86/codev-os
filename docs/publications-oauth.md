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

## Meta (Facebook Login for Business — flux manuel)

- **URL de callback exacte** : `<PUBLICATIONS_OAUTH_BASE_URL>/api/publications/oauth/meta/callback`
- Graph API **v25.0** (dialogue `https://www.facebook.com/v25.0/dialog/oauth`, échange
  `https://graph.facebook.com/v25.0/oauth/access_token`, inspection `debug_token`).
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

Non demandées : `business_management` (seulement si les Pages ne sont accessibles que via Business Manager),
`ads_management`, `ads_read`.

En mode **Development**, seules les personnes ayant un rôle sur l’app (admin, développeur, testeur) peuvent
autoriser ces permissions. En mode **Live**, les permissions marquées « Oui » exigent l’App Review (et la
vérification d’entreprise pour l’accès avancé).

### Configuration Meta Developers (à faire par l’administrateur)

1. Créer une app de type *Business*, produit **Facebook Login for Business**.
2. *Valid OAuth Redirect URIs* : l’URL de callback exacte ci-dessus (HTTPS, sans variante).
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

### Configuration Google Cloud (à faire par l’administrateur)

1. Demander l’accès aux API Business Profile (formulaire officiel ; quota initial à 0 tant que non approuvé).
2. Activer **My Business Account Management API** et **My Business Business Information API** (la publication de
   posts, P11-b, demandera aussi l’API Google My Business v4).
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
