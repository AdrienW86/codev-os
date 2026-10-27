# Publications — TikTok

TikTok est le quatrième réseau du circuit Publications : même agent de rédaction, même photo carrée 1080 × 1080,
même validation humaine obligatoire, même diffusion programmée. TikTok publie des **posts photo** (carrousel d’une
ou plusieurs images, musique ajoutée automatiquement par TikTok).

## Ce que fait CODE-V OS

1. **Connexion par client** (onglet Publications du client ou Configuration du projet) : TikTok Login Kit,
   scopes `user.info.basic` (nom du compte) et `video.publish` (publication directe). Jeton d’accès 24 h, jeton de
   rafraîchissement 365 jours, chiffrés dans le coffre comme pour Meta et Google. Le compte publié est celui de la
   personne qui a donné son accord (un compte TikTok par client).
2. **Canal TikTok** par projet : planning (jours / heures), règles éditoriales, compte affecté.
3. **Agent** : texte natif TikTok (première phrase courte = titre, 3 à 5 hashtags).
4. **Diffusion** (après approbation) : lecture des niveaux de confidentialité autorisés, publication directe
   publique (`PUBLIC_TO_EVERYONE`), puis suivi du statut jusqu’à `PUBLISH_COMPLETE`. Un statut encore en cours après
   environ 40 s reste « à vérifier » (jamais renvoyé automatiquement).
5. **Images** : TikTok n’accepte que des images hébergées sur un domaine vérifié. CODE-V OS les sert lui-même via
   `https://<domaine>/api/publications/media/<jeton>.jpg` (jeton signé et daté, une seule image, aucun accès sans
   jeton valide).

## Variables d’environnement (serveur)

| Variable | Rôle |
|---|---|
| `TIKTOK_CLIENT_KEY` | Client key de l’application TikTok for Developers. |
| `TIKTOK_CLIENT_SECRET` | Client secret de l’application. |
| `TIKTOK_VERIFICATION_FILE` / `TIKTOK_VERIFICATION_CONTENT` | Facultatifs : nom et contenu du fichier de vérification de préfixe d’URL fourni par TikTok (méthode « fichier »). |

Réutilisées : `PUBLICATIONS_OAUTH_BASE_URL`, `PUBLICATION_CREDENTIALS_KEY`, `PUBLICATION_CREDENTIALS_KEY_ID`.

## Mise en place côté TikTok (une seule fois, compte CODE-V)

1. Créer un compte sur **developers.tiktok.com** puis une application « CODE-V OS » (catégorie Business).
2. Produits : **Login Kit** (plateforme Web) et **Content Posting API** avec l’option **Direct Post** activée.
3. Scopes : `user.info.basic`, `video.publish`.
4. URL de redirection : `<PUBLICATIONS_OAUTH_BASE_URL>/api/publications/oauth/tiktok/callback`
   (ex. `https://os.code-v.fr/api/publications/oauth/tiktok/callback`).
5. **Vérifier la propriété du domaine des images** (Content Posting API → « URL properties ») :
   - soit le domaine `os.code-v.fr` par enregistrement DNS TXT ;
   - soit le préfixe `https://os.code-v.fr/api/publications/media/` par fichier : renseigner
     `TIKTOK_VERIFICATION_FILE` (nom exact du fichier) et `TIKTOK_VERIFICATION_CONTENT` (contenu) dans Vercel.
6. Renseigner `TIKTOK_CLIENT_KEY` et `TIKTOK_CLIENT_SECRET` dans Vercel (Production), redéployer.
7. **Audit TikTok** : soumettre l’application à la revue (démonstration vidéo du parcours : connexion, aperçu du
   post, choix de confidentialité, publication). Tant que l’audit n’est pas validé, TikTok n’autorise que des
   publications privées : CODE-V OS refuse alors la diffusion avec le motif « application non auditée » plutôt que
   de publier en privé.

## Par client

- Le client se connecte avec **son** compte TikTok (idéalement un compte Business) depuis la page client.
- Activer le canal TikTok du projet, choisir les jours / heures, puis affecter le compte.
- Limites TikTok : quelques publications par jour et par compte, 6 requêtes par minute et par jeton.
