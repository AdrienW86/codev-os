# Studio vidéo et publication de vidéos sur TikTok

Deux activités distinctes :
- **Studio vidéo** (onglet `/studio`) : créer des vidéos motion design pour un client, les garder dans sa bibliothèque, les télécharger. Rien n'est publié depuis le Studio.
- **Publication TikTok** (onglet Publications) : une publication TikTok peut porter une vidéo à la place de photos. Elle suit le circuit habituel (brouillon, validation humaine, programmation, envoi).
Le seul pont entre les deux est volontaire : le bouton « Créer un brouillon TikTok » d'une vidéo du Studio.

## Studio vidéo
- Formulaire : client, titre, accroche, une légende par ligne (une par photo suivante, facultatives), phrase de fin, signature, rythme (Dynamique, Standard, Posé), 1 à 8 photos prises dans la photothèque WhatsApp du client et/ou envoyées depuis l'ordinateur (JPEG, PNG ou WebP, 8 Mo au plus chacune).
- Rendu : vidéo verticale 720×1280, 30 i/s, 30 s au plus : accroche animée, une scène par photo (zoom ou travelling doux, transitions), légendes en incrustation, écran final à la signature, barre de progression, piste audio muette.
- **Rien n'est inventé** : seuls les textes saisis (sans emoji, hashtag ni lien à l'image) et les photos choisies apparaissent.
- Route `POST /api/studio/videos` (administrateur, même origine, 300 s au plus). La vidéo est rangée dans le stockage privé `studio-videos` (`<client>/<vidéo>.mp4`) et la table `studio_videos` (serveur uniquement, RLS active). Création et suppression sont journalisées.
- « Créer un brouillon TikTok » : légende proposée à partir des textes de la vidéo, modifiable. Il faut un projet du client ouvert à TikTok. Le brouillon apparaît dans Publications, sans date, avec la vidéo copiée dans `publication-videos` ; il se programme et se valide comme les autres.

## Publication sur TikTok
- Content Posting API, publication directe : `post/publish/video/init` en `FILE_UPLOAD` (un seul morceau), envoi `PUT` vers l'URL TikTok (`*.tiktokapis.com` uniquement), puis suivi du statut.
- Le fichier est lu dans le stockage privé **avant** toute écriture chez TikTok. Une réponse perdue après l'envoi est « incertaine » (jamais renvoyée automatiquement).
- Légende de 2 200 caractères au plus. Duo et Collage sont désactivés.
- Même portée OAuth que les photos (`video.publish`) : aucune nouvelle autorisation TikTok, aucune variable d'environnement nouvelle.
- Invariant en base : une vidéo n'est rattachée qu'à une variante TikTok, et seule (jamais mélangée à des photos, jamais sur Facebook, Instagram ou Google).

## Technique
- Rendu : `lib/motion/video/` : storyboard pur (`storyboard.ts`), arguments ffmpeg purs (`filtergraph.ts`), rendu (`render.ts`) avec calques dessinés par sharp et la police Montserrat embarquée (OFL, `lib/motion/video/fonts/`), encodage H.264 par le binaire du paquet `ffmpeg-static`. Aucun réseau, dossier temporaire supprimé.
- `next.config.ts` : `ffmpeg-static` hors bundle ; binaire et polices tracés pour la seule fonction qui rend (`/api/studio/videos`).
- Studio : `lib/studio/model.ts` (formulaire, pur), `lib/studio/videos.ts` (serveur), `app/(cockpit)/studio/`, `components/studio/`.
- Migration `20261120000000_publications_motion_video.sql` : stockages `publication-videos` et `studio-videos` (privés, MP4, 64 Mo), type `video/mp4`, invariant vidéo TikTok, table `studio_videos`. Tests SQL : `supabase/tests/publications-socle-7-motion-video.sql`.

## Mise en service
1. Appliquer la migration `20261120000000_publications_motion_video.sql` avant le merge (sans elle, le Studio répond que le stockage vidéo manque).
2. Aucune variable d'environnement nouvelle.

## Limites
- Pas de musique : l'API TikTok ne permet pas d'ajouter un son de sa bibliothèque à une vidéo.
- Le rendu prend environ 10 à 30 s selon le nombre de photos ; une seule vidéo à la fois par requête.
