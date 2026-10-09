# Publications — publisher Google Business Profile réel (Lot 4.3 P12)

Implémentation du contrat de publication P10 pour les **fiches d’établissement Google Business Profile** (posts
« Nouveautés »). Comme pour Meta (P11-b), le code est complet mais **n’est déclenché par rien** : aucune route, aucun
bouton « publier », aucun cron, aucun worker permanent. Le moteur P10 vérifie avant tout appel les interrupteurs
globaux (`emergency_stop = true`, `publishing_enabled = false` aujourd’hui) : tant qu’ils sont fermés, **aucune
requête** n’atteint Google. Aucun appel réel n’a été fait pendant le développement (transports simulés dans les tests).

## Disponibilité de l’API (vérifiée le 2026-10-09, documentation officielle)

- Méthode `accounts.locations.localPosts.create` de la **My Business API v4** : documentée et disponible
  (référence mise à jour en avril 2026), sans avis de dépréciation.
- Calendrier officiel des abandons (`developers.google.com/my-business/content/sunset-dates`) : seule la méthode
  `accounts.locations.localPosts.reportInsights` (v4.9) a été arrêtée (2023-02-20). `localPosts` (create / get /
  list / patch / delete) n’y figure pas. Aucune API de remplacement n’est annoncée pour les posts.
- Les posts « Produit » ne peuvent pas être créés par l’API (documentation officielle) : non utilisés.
- **Prérequis d’accès Google** (manuels, hors code) : fiche vérifiée et active depuis 60 jours ou plus, site web
  associé, demande « Application for Basic API Access » via le formulaire de contact GBP API. Tant que le projet
  Google Cloud a un quota de **0 QPM**, il n’est pas approuvé (300 QPM une fois approuvé) : toute requête échoue
  (403 / 429), ce qui donne une delivery bloquée (`auth`) ou à réessayer (`rate_limit`), jamais une publication.

## Endpoint et contenu

- `POST https://mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/localPosts` — scope OAuth
  `https://www.googleapis.com/auth/business.manage` (déjà demandé par P11-a, aucun nouveau consentement).
- Corps : `{languageCode: "fr", summary, topicType: "STANDARD", media?: [{mediaFormat: "PHOTO", sourceUrl}]}`.
  `sourceUrl` est l’URL signée Supabase de courte durée du média de la révision (accessible publiquement pendant
  l’appel ; jamais de bucket public).
- Le compte publié est la fiche synchronisée par P11-a : `external_account_id = accounts/{a}/locations/{l}`.
- Réponse : la ressource `LocalPost` ; son `name` (`accounts/{a}/locations/{l}/localPosts/{id}`) devient le
  `remote_id` de la delivery. `state` : `LIVE`, `PROCESSING` (revue Google en cours, acceptée) ou `REJECTED`.
- Contrôles avant tout appel : texte non vide et **1500 caractères maximum** (limite de l’éditeur de posts Google ;
  la référence v4 ne donne pas de nombre, la limite retenue est donc prudente), une seule photo au plus,
  **JPG ou PNG** (contraintes MediaItem v4 : 10 Ko à 5 Mo, 250 px minimum sur le petit côté ; les dérivés P8 sont
  des JPEG 1080×1080), URL `https`.
- Lecture pour la réconciliation : `GET …/localPosts/{id}` et `GET …/localPosts?pageSize=100` (100 au maximum par
  page, ordre non documenté).
- Toutes les requêtes : jeton dans l’en-tête `Authorization` (jamais dans l’URL), corps JSON, délai de 20 s, aucune
  redirection, réponse bornée à 1 Mo, aucune nouvelle tentative au niveau du transport. Liste blanche stricte :
  seulement `localPosts` (create / get / list) d’une fiche ; méthodes autres que GET / POST refusées.

## Jeton d’accès

Un jeton d’accès Google vit environ une heure. S’il est expiré (ou expire dans la minute), il est **renouvelé en
mémoire** avec le jeton de rafraîchissement du coffre P11-a, via le transport OAuth en lecture seule, **avant** la
création du post. Le nouveau jeton n’est ni stocké ni journalisé. Un renouvellement impossible a lieu avant toute
écriture : aucun post ne peut exister (révoqué → `auth` / `token_revoked`, quota → `rate_limit`, panne →
`provider_unavailable`).

## Au plus une fois (at-most-once)

`localPosts.create` n’offre **aucune clé d’idempotence**. La garantie repose sur P10 : delivery unique par variante
et compte, marqueur `dispatched_at` posé avant l’appel, un seul appel `create`, puis réconciliation.

| Situation | Résultat P10 |
|---|---|
| Validation locale, jeton absent / expiré sans renouvellement possible | `invalid_payload` / `auth` (aucun appel) |
| 401 `UNAUTHENTICATED` | `auth` / `token_invalid` → delivery bloquée |
| 403 `PERMISSION_DENIED` (API non approuvée, quota 0 QPM, accès retiré) | `auth` / `permission_missing` |
| 404 `NOT_FOUND` (fiche supprimée ou plus accessible) | `auth` / `location_unavailable` |
| 429 `RESOURCE_EXHAUSTED` (quota GBP) | `rate_limit` |
| 400 `INVALID_ARGUMENT` / `FAILED_PRECONDITION` | `invalid_payload` |
| Post créé mais `REJECTED` par Google | `invalid_payload` / `post_rejected` (le contenu doit changer) |
| Délai dépassé, coupure réseau, 5xx, 409 / `ABORTED`, réponse sans `name` de la fiche | **`uncertain`** — jamais de nouvelle tentative automatique |

Les messages d’erreur Google ne sont jamais conservés : seuls une classe et un code court sont enregistrés.

## Réconciliation (delivery `uncertain`)

Même action administrateur que Meta (« Vérifier chez le fournisseur », lecture seule) :
- nom de post connu → `GET` : trouvé → `published` ; 404 ou `REJECTED` → « absente » ; autre → reste `uncertain` ;
- sinon liste des posts de la fiche (5 pages de 100 au plus) et recherche du **texte exact** créé après le marqueur
  d’envoi (±120 s) : 1 résultat → `published` avec le nom Google ; 0 après lecture de toutes les pages → « absente » ;
  plusieurs, lecture impossible ou plus de pages que la borne → reste `uncertain`.

La migration `20261013000000_publications_gbp_publisher.sql` adapte uniquement `publication_delivery_reconcile` :
le format de l’identifiant est désormais vérifié **par plateforme** (Meta inchangé) et un nom de post Google doit
appartenir à la fiche de la delivery. Après « absente », l’administrateur peut confirmer « non publiée » (delivery
`failed`) puis « Réessayer ». Aucun identifiant n’est jamais inventé.

## Limites connues

- Posts « Nouveautés » (`STANDARD`) uniquement : pas d’événement, d’offre, de bouton d’action, d’alerte ni de vidéo.
- Une seule photo par post.
- `languageCode` fixé à `fr`.
- La réconciliation par texte suppose un texte unique sur la période.
- Le déclenchement réel (worker) reste à décider : `runOnePublicationJobInProduction` existe, aucun appelant.
