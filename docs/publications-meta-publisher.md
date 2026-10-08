# Publications — publisher Meta réel (Lot 4.3 P11-b)

Implémentation du contrat de publication P10 pour **Facebook (Pages)** et **Instagram (comptes professionnels)**.
Le code est complet mais **n’est déclenché par rien** : aucune route, aucun bouton « publier », aucun cron, aucun
worker permanent. Le moteur P10 vérifie en plus, avant tout appel, les interrupteurs globaux
(`emergency_stop = true`, `publishing_enabled = false` aujourd’hui) : tant qu’ils sont fermés, **aucune requête**
n’atteint Meta. Aucun appel réel n’a été fait pendant le développement (transports simulés dans les tests).

## Version et endpoints (documentation officielle Meta)

- **Graph API v25.0** — hôte `https://graph.facebook.com/v25.0/`.
- **Jeton de Page** : `GET /{page-id}?fields=access_token` avec le jeton utilisateur longue durée (coffre P11-a).
  Le jeton de Page reste en mémoire le temps de la requête : jamais stocké, jamais journalisé.
- **Facebook, texte** : `POST /{page-id}/feed` — paramètre `message`. Réponse `id` (`{page-id}_{post-id}`).
- **Facebook, photo** : `POST /{page-id}/photos` — paramètres `url` (URL signée courte du média de la révision)
  et `caption` (`message` est déprécié pour ce endpoint). Réponse `id` et `post_id` (conservé en priorité).
- **Instagram** (Instagram API avec Facebook Login, jeton de Page) :
  1. `POST /{ig-user-id}/media` — `image_url`, `caption` → identifiant de **conteneur** (ce n’est pas une publication) ;
  2. `GET /{container-id}?fields=status_code` — `IN_PROGRESS`, `FINISHED`, `ERROR`, `EXPIRED`, `PUBLISHED`
     (attente bornée : 10 vérifications espacées de 3 s au plus) ;
  3. `POST /{ig-user-id}/media_publish` — `creation_id` → identifiant du média publié.
- Lecture pour la réconciliation : `GET /{page-id}/published_posts`, `GET /{ig-user-id}/media`, `GET /{post-id}`.
- Toutes les requêtes : jeton dans l’en-tête `Authorization` (jamais dans l’URL), `appsecret_proof`
  (HMAC-SHA256 du jeton avec le secret de l’app), délai de 20 s, aucune redirection, réponse JSON bornée à 1 Mo,
  aucune nouvelle tentative au niveau du transport. Liste blanche stricte des chemins.

## Permissions

`pages_show_list`, `pages_read_engagement`, `pages_manage_posts` (Facebook) et `instagram_basic`,
`instagram_content_publish` (Instagram), toutes demandées dès la connexion OAuth (P11-a). La personne qui autorise
doit pouvoir effectuer la tâche **CREATE_CONTENT** sur la Page. En mode Live, `pages_manage_posts` et
`instagram_content_publish` exigent l’**App Review** (et la vérification d’entreprise pour l’accès avancé).

## Contraintes Instagram (vérifiées avant tout appel)

- Image **obligatoire**, **JPEG uniquement** (les dérivés P8 sont des JPEG 1080×1080), 8 Mo maximum,
  largeur 320–1440 px, ratio 4:5 à 1.91:1, URL **accessible publiquement au moment de l’appel** : URL signée
  Supabase de courte durée (jamais de bucket public).
- Légende : 2 200 caractères, 30 hashtags, 20 mentions au maximum.
- Compte professionnel lié à la Page (le compte Instagram synchronisé porte l’identifiant de sa Page).
- Limite Meta : 100 publications par API sur 24 h glissantes (erreur de quota → `rate_limit`).

## Au plus une fois (at-most-once)

Meta ne fournit **aucune clé d’idempotence**. La garantie repose sur P10 :
une delivery unique par variante et compte, le marqueur `dispatched_at` posé **avant** l’appel, et la réconciliation.

| Situation | Résultat P10 |
|---|---|
| Échec du jeton de Page, du conteneur ou de son statut (aucune publication possible) | `retryable` / `provider_unavailable` / `rate_limit` |
| Délai dépassé, coupure réseau, 5xx ou réponse sans identifiant **après** `feed`, `photos` ou `media_publish` | **`uncertain`** — jamais de nouvelle tentative automatique |
| Jeton expiré / révoqué / invalide (190), permission manquante (10, 200–299), Page ou compte indisponible | `auth` → delivery **bloquée** |
| Contenu ou média refusé (100, 368, 9004, 36000–36010, sous-codes 2207xxx), conteneur en `ERROR` | `invalid_payload` → échec |
| Quotas (4, 9, 17, 32, 613, 80001–80014, HTTP 429) | `rate_limit` |

Les messages d’erreur Meta ne sont jamais conservés : seuls une classe et un code court sont enregistrés.

## Réconciliation (delivery `uncertain`)

Action administrateur « Vérifier chez le fournisseur » (lecture seule) :
- identifiant connu → `GET /{post-id}` ;
- sinon recherche parmi les publications récentes de la Page / du compte Instagram du **texte exact** publié
  après le marqueur d’envoi : 1 résultat → `published` avec l’identifiant Meta ; 0 → « absente » ; plusieurs ou
  lecture impossible → reste `uncertain`.

Après un résultat « absente », l’administrateur peut confirmer « non publiée » (delivery `failed`), puis
« Réessayer ». Aucun identifiant n’est jamais inventé ; aucune nouvelle publication n’est envoyée automatiquement.

## Limites connues

- Pas de rafraîchissement automatique du jeton utilisateur pendant une publication : un jeton expiré bloque la
  delivery (`auth`) ; « Vérifier la connexion » (P11-a) le prolonge tant qu’il est valide.
- Une seule image par publication (pas de carrousel, pas de vidéo, pas de Reels, pas de Stories).
- La réconciliation par texte suppose un texte unique sur la période : deux publications identiques simultanées
  restent `uncertain`.
- Le déclenchement réel (worker) reste à décider : `runOnePublicationJobInProduction` existe, aucun appelant.
