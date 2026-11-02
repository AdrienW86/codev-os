# Publications — Snapchat

Snapchat est le cinquième réseau du circuit Publications : même agent de rédaction, même validation humaine
obligatoire, même diffusion programmée. CODE-V OS publie sur le **profil public** (Public Profile) Snapchat du client :

| Média de la publication | Ce qui est publié sur Snapchat | Texte |
|---|---|---|
| Une photo (JPEG 1080 × 1080) | une **Story** du profil public (visible 24 h) | non affiché par Snapchat |
| Une vidéo MP4 (par exemple créée dans le **Studio vidéo**) | un **Spotlight** (permanent) | description, 160 caractères au plus |

Une publication Snapchat porte toujours un seul média (contrôle en base).

## Ce que fait CODE-V OS

1. **Connexion par client** (onglet Publications du client ou Configuration du projet) : Snap OAuth 2.0, scope
   `snapchat-profile-api`. Jeton d’accès court (environ 1 h) rafraîchi en mémoire, jeton de rafraîchissement chiffré
   dans le coffre comme pour Meta, Google et TikTok. Les comptes proposés sont les profils publics de l’organisation
   Snap de la personne connectée ; on en affecte un au canal Snapchat du projet.
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
3. **Accès à la Public Profile API** : l’API est sur liste d’autorisation. Demander à Snap l’accès pour cette
   application (scope `snapchat-profile-api`, gestion du contenu des profils publics). Sans cet accord, la connexion
   échoue avec « accès refusé ».
4. Renseigner `SNAPCHAT_CLIENT_ID` et `SNAPCHAT_CLIENT_SECRET` dans Vercel (Production), puis redéployer.

## Par client

- Le client doit avoir un **profil public** Snapchat (compte créateur ou entreprise ; un compte personnel ne peut
  pas publier par l’API) et vous donner un rôle sur ce profil dans son organisation Snap.
- Connecter Snapchat depuis la page du client, activer le canal Snapchat du projet, choisir les jours / heures, puis
  affecter le profil public.

## À vérifier avec la documentation officielle

Les chemins et champs suivants suivent la documentation Snap (Public Profile API, *Profile Asset Management*) telle
qu’elle était accessible au moment de l’écriture ; ils sont isolés dans
`lib/integrations/publications-snapchat-publish.ts`, `lib/publications/delivery/snapchat-publisher.ts` et
`lib/integrations/publications-oauth/http.ts` :

- découverte des profils : `GET https://adsapi.snapchat.com/v1/me` puis `/v1/organizations/<id>/public_profiles` ;
- média : `POST https://businessapi.snapchat.com/v1/public_profiles/<profil>/media` (`type`, `name`, `key`, `iv`)
  → `media_id`, `add_path`, `finalize_path` ; envoi `multipart/form-data` (`action=ADD`, `part_number`, `file`)
  puis `action=FINALIZE` ;
- Story : `POST …/stories` (`media_id`) ; Spotlight : `POST …/spotlights` (`media_id`, `description`, `locale`).
