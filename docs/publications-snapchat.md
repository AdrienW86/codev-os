# Publications — Snapchat

Snapchat est le cinquième réseau du circuit Publications : même agent de rédaction, même validation humaine
obligatoire, même diffusion programmée. CODE-V OS publie sur le **profil public** (Public Profile) Snapchat du client :

| Média de la publication | Ce qui est publié sur Snapchat | Texte |
|---|---|---|
| Une photo (JPEG 1080 × 1080) | une **Story** du profil public (visible 24 h) | non affiché par Snapchat |
| Une vidéo MP4 (par exemple créée dans le **Studio vidéo**) | un **Spotlight** (permanent) | description, 160 caractères au plus |

Une publication Snapchat porte toujours un seul média (contrôle en base).

## Ce que fait CODE-V OS

1. **Connexion par client** (onglet Publications du client ou Configuration du projet) : Snap OAuth 2.0, scopes
   `snapchat-profile-api` (publication) et `snapchat-marketing-api` (lecture de l’organisation Snap uniquement). Jeton d’accès court (environ 1 h) rafraîchi en mémoire, jeton de rafraîchissement chiffré
   dans le coffre comme pour Meta, Google et TikTok. Les comptes proposés sont le profil public de la personne
   connectée et ceux de son organisation Snap auxquels elle a accès ; on en affecte un au canal Snapchat du projet.
2. **Canal Snapchat** par projet : planning (jours / heures), règles éditoriales, compte affecté.
3. **Agent** : une phrase courte et visuelle (160 caractères au plus, 1 à 3 hashtags).
4. **Studio vidéo** : « Créer une publication Snapchat » prépare un brouillon (non planifié) avec la vidéo ; vous le
   planifiez et le validez dans Publications. Rien n’est publié depuis le Studio.
5. **Diffusion** (après approbation) : le fichier est lu dans le stockage privé du projet, chiffré en AES-256-CBC
   (clé et IV aléatoires, propres à l’envoi, exigés par Snap), envoyé à Snap puis finalisé ; ensuite seulement la Story
   ou le Spotlight est créé. Une réponse perdue à cette dernière étape rend la diffusion « à vérifier » (jamais renvoyée
   automatiquement).

## Variables d’environnement (serveur, Vercel)

| Variable | Rôle |
|---|---|
| `SNAPCHAT_CLIENT_ID` | OAuth Client ID de l’application Snap de CODE-V. |
| `SNAPCHAT_CLIENT_SECRET` | OAuth Client Secret de cette application. |

Réutilisées : `PUBLICATIONS_OAUTH_BASE_URL`, `PUBLICATION_CREDENTIALS_KEY`, `PUBLICATION_CREDENTIALS_KEY_ID`.
Tant que les deux variables manquent, Snapchat reste « non configuré » (aucune connexion ni diffusion possible).

## Mise en place côté Snap (une seule fois, compte CODE-V)

1. **Business Manager** (business.snapchat.com) : organisation CODE-V, puis *Business Details* → **OAuth Apps** →
   créer une application « CODE-V OS ».
2. **URL de redirection** : `<PUBLICATIONS_OAUTH_BASE_URL>/api/publications/oauth/snapchat/callback`
   (ex. `https://os.code-v.fr/api/publications/oauth/snapchat/callback`).
3. **Accès à la Public Profile API** : l’API est sur liste d’autorisation. Pour vérifier l’accès sans contact Snap,
   connecter un client puis lire le code d’audit `publication.oauth_completed` : en cas d’échec de la découverte il
   porte `m<statut>a<statut>o<statut>p<statut>[_code]` (my_profile, identité Marketing, profils de l’organisation —
   `o0` = non tenté —, recherche publique) puis le premier code d’erreur Snap.
4. Renseigner `SNAPCHAT_CLIENT_ID` et `SNAPCHAT_CLIENT_SECRET` dans Vercel (Production), puis redéployer.

## Par client

- Le client doit avoir un **profil public** Snapchat (compte créateur ou entreprise ; un compte personnel ne peut
  pas publier par l’API) et vous donner un rôle sur ce profil dans son organisation Snap.
- Connecter Snapchat depuis la page du client, activer le canal Snapchat du projet, choisir les jours / heures, puis
  affecter le profil public.

## Appels Snap (documentation Public Profile API, vérifiée le 2026-11-02)

Isolés dans `lib/integrations/publications-oauth/http.ts`, `lib/integrations/publications-snapchat-publish.ts` et
`lib/publications/delivery/snapchat-publisher.ts` :

- profil porté par la personne connectée : `GET https://businessapi.snapchat.com/v1/public_profiles/my_profile`
  → `{ public_profile: { id, organization_id, display_name, snap_user_name } }` ; refusé (403) quand la personne gère un
  profil d’entreprise sans en porter un ;
- sinon identité Marketing : `GET https://adsapi.snapchat.com/v1/me` → `{ me: { id, organization_id } }` (scope
  `snapchat-marketing-api`) ;
- profils de l’organisation accessibles à la personne : `GET https://businessapi.snapchat.com/v1/organizations/<id>/public_profiles` ;
- média : `POST https://businessapi.snapchat.com/v1/public_profiles/<profil>/media` (`type`, `name`, `key`, `iv` en
  base64) → `media_id`, `add_path`, `finalize_path` ; envoi `multipart/form-data` (`action=ADD`, `part_number`, `file`,
  morceaux de 32 Mo au plus) puis `action=FINALIZE` ; un média expire 24 h après sa création ;
- Story : `POST …/stories` (`media_id`) → `{ request_id, request_status }` seulement (l’id du média sert de référence) ;
- Spotlight : `POST …/spotlights` (`media_id`, `description` ≤ 160, `locale`) → `spotlight_id` ; vidéo MP4 de 6 à
  60 s, 540 × 960 px au moins ; statut initial `SUBMITTED` (modération Snap avant `LIVE`).
- `MEDIA_POSTING_ALREADY_IN_PROGRESS` : diffusion « à vérifier », jamais renvoyée.
