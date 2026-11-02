# Vidéos motion design TikTok

## Ce que fait la fonctionnalité
- Une publication TikTok préparée avec des photos peut devenir une **vidéo 9:16 de 10 à 24 s** : accroche animée, une scène par photo (zoom ou travelling doux, transitions), phrases du texte en incrustation, écran final au nom du client et barre de progression.
- **Rien n'est inventé** : les textes affichés sont des phrases du texte de la publication (sans emoji, hashtag ni lien) et le nom du client ; les images sont les photos de la publication.
- La vidéo remplace les photos dans une **nouvelle version** de la publication, qui repasse « À valider ». La validation TikTok reste humaine (confidentialité, commentaires, divulgation commerciale, consentement), comme pour une photo.
- Deux déclenchements :
  - bouton **« Créer la vidéo motion design »** sur la carte de validation d'une publication TikTok (route `POST /api/publications/[id]/motion-video`, administrateur, même origine) ;
  - **automatique** pour les clients qui cochent « TikTok : transformer les photos en vidéo motion design » (fiche client › Publications) : étape `publication_motion_video` du planificateur central, une vidéo au plus par passage, en dernier, bornée par l'échéance du passage. Seules les publications préparées par l'agent, « À valider », à créneau futur, sont reprises ; un échec est journalisé (`publication.motion_video_failed`) et n'est pas retenté automatiquement.

## Publication sur TikTok
- Content Posting API, publication directe : `post/publish/video/init` en `FILE_UPLOAD` (un seul morceau), envoi `PUT` vers l'URL TikTok (`*.tiktokapis.com` uniquement), puis suivi du statut.
- Le fichier est lu dans le stockage privé **avant** toute écriture chez TikTok. Une réponse perdue après l'envoi est « incertaine » (jamais renvoyée automatiquement).
- Légende = texte complet (2 200 caractères au plus). Duo et Collage sont désactivés (aucun choix humain ne les ouvre aujourd'hui).
- Même portée OAuth que les photos (`video.publish`) : aucune nouvelle autorisation TikTok.

## Technique
- Rendu : `lib/motion/video/` — storyboard pur (`storyboard.ts`), arguments ffmpeg purs (`filtergraph.ts`), rendu (`render.ts`) : calques dessinés par sharp avec la police Montserrat embarquée (OFL, `lib/motion/video/fonts/`), animation et encodage H.264 par le binaire du paquet `ffmpeg-static`. Aucun réseau, dossier temporaire supprimé.
- `next.config.ts` : `ffmpeg-static` hors bundle et binaire + police tracés pour les deux seules fonctions qui rendent (route de génération et planificateur).
- Stockage privé `publication-videos` (MP4, 64 Mo) ; le moteur de diffusion signe chaque média dans son stockage selon son type.
- Migration `20261120000000_publications_motion_video.sql` : stockage, type `video/mp4`, invariant « vidéo seulement sur TikTok et seule », réglage client journalisé, candidats et journal d'échec. Tests SQL : `supabase/tests/publications-socle-7-motion-video.sql`.

## Mise en service
1. Appliquer la migration `20261120000000_publications_motion_video.sql` (avant ou juste après le merge ; sans elle, l'étape automatique reste « désactivée » et le bouton répond que le stockage vidéo manque).
2. Aucune variable d'environnement nouvelle.
3. Option : cocher le réglage vidéo sur les fiches clients concernées.

## Limites
- Pas de musique : l'API TikTok ne permet pas d'ajouter un son de la bibliothèque à une vidéo (piste audio muette).
- Durée vérifiée par rapport au maximum courant de TikTok (60 s et plus) mais pas lue dans `creator_info`.
