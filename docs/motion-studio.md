# Studio Motion CODE-V OS — socle D0

## Livré dans ce lot
- Nouvelle route administrateur `/motion` accessible depuis la navigation.
- Création d'un **brief réel sauvegardé** par client avec titre, scénario, direction artistique, durée (5–90 s), format, moteur pressenti (Claude/Remotion ou libre) et préférence vocale.
- Le dossier source Google Drive est choisi **uniquement parmi les dossiers déjà configurés et aux droits confirmés** pour ce client (Agent Publications et associations WhatsApp). Aucun ID de dossier arbitraire et aucun accès croisé.
- Nouvelle fiche `/motion/[id]` : contenu sauvegardé, liste de métadonnées Drive (images, vidéos, audio) et consignes de passation structurées à copier pour Claude Code.
- La création et son événement sont une transaction PostgreSQL atomique via `motion_project_create`; tables RLS et privilèges `service_role` uniquement. Aucun secret exposé.
- **Aucune** génération de média, vidéo de démonstration, transfert, export ou appel payant implicite.

## Dépendances existantes
- Réutilise la connexion Drive **lecture seule** des Publications : `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`.
- Réutilise les dossiers et les autorisations déjà connus de `publication_agent_projects` et `whatsapp_senders`.
- Stocke seulement les briefs dans Supabase ; les **médias clients restent sur Google Drive**.
- Le connecteur actuel n'a pas de droit général d'écriture sur les dossiers : le futur export MP4 nécessitera une autorisation explicite d'écriture limitée au dossier de livraison sélectionné (ex. accès `drive.file` ou application installée), distincte de la lecture.

## Installation
1. Revue du code et CI verte.
2. Appliquer `supabase/migrations/20261119000000_motion_studio_foundation.sql` en production **après validation explicite**, conformément aux règles du dépôt.
3. Vérifier les connexions Drive client et les droits confirmés.
4. Ouvrir `/motion` pour enregistrer le premier brief. La page reste utilisable en lecture mais bloque l'enregistrement si la migration manque.

## Limites assumées
- Aucun worker Claude Code ou Codex n'est encore connecté : le texte de passation est manuel.
- Le Remotion Player et le rendu MP4 ne sont pas activés. Un projet de brief n'est pas une vidéo.
- ElevenLabs n'est qu'une préférence enregistrée ; aucune synthèse vocale et aucune facturation à ce stade.
- L'inventaire Drive se limite aux **100 fichiers les plus récents du dossier racine** ; il ne parcourt pas les sous-dossiers. Il affiche les métadonnées, pas un aperçu des originaux.
- Une ressource invalide ou inaccessible reste indisponible : l'interface ne crée pas de média de substitution ni de fausse prévisualisation.
- La liste des dossiers est bornée à 100 entrées de chaque source, et la liste des briefs récents à 60.
- Les étapes de validation/versions/exports n'existent pas encore : aucun bouton factice.

## Prochains lots recommandés
1. **D1 — Direction artistique client** : profil de marque versionné, lecture/inspection sélective des ressources Drive, revue et approbation d'une DA sans hallucination.
2. **D2 — Agent réalisateur** : environnement de travail cloud isolé, déclenchement de Claude Code (modèle choisi par configuration), Remotion installé dans ce worker et expérience libre si nécessaire ; budgets et journaux.
3. **D3 — QA vidéo** : storyboard, contrôle des images clés et du rendu final, preview MP4 privée, corrections itératives sans écrasement.
4. **D4 — Approbation et livraison** : consentement sur version + empreinte du rendu, choix explicite d'un **dossier Drive de destination**, upload en reprise de MP4 vérifié après approbation, suivi des versions et coûts, puis interopérabilité Publications.

La priorité est une réelle qualité motion design, pas la reproduction d'un éditeur vidéo complet.
