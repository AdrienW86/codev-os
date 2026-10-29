// Prépare un brief reproductible pour Claude Code, sans le lancer et sans inventer de média.
import type {MotionFile,MotionProject} from "./model";

export function motionProductionHandoff(project:MotionProject,files:MotionFile[]|null):string {
 const inventory=files===null
  ? "Inventaire Drive indisponible : ne suppose aucun fichier ; obtenir un accès autorisé avant création."
  : files.length
   ? files.map(file=>"- "+file.name+" ["+file.mimeType+", Drive ID "+file.id+"]").join("\n")
   : "Aucun fichier pris en charge dans les 100 plus récents du dossier ; demander des ressources avant de produire.";
 const engine=project.engine==="remotion"
  ? "Utiliser Remotion/React si cela permet le meilleur résultat."
  : "Choisir le moteur web d'animation adapté, exporter via un moteur de rendu déterministe.";
 return [
  "MISSION MOTION DESIGN — BRIEF NON ENCORE EXÉCUTÉ",
  "Client ID : "+project.client_id,
  "Dossier Drive source confirmé : "+project.source_folder_id,
  "Titre : "+project.title,
  "Brief : "+project.brief,
  "Direction artistique explicite : "+(project.brand_direction||"À déduire uniquement des ressources vérifiées ; sinon demander validation."),
  "Durée cible : "+project.duration_seconds+" secondes. Format : "+project.aspect_ratio+".",
  "Moteur envisagé : "+project.engine+". "+engine,
  "Voix : "+(project.voice_mode==="elevenlabs"?"ElevenLabs envisagé, intégration et consentement à vérifier.":"Aucune voix générée."),
  "Fichiers répertoriés sur Drive (métadonnées uniquement) :\n"+inventory,
  "Exigences : vérifier les droits et le contenu réel des fichiers avant utilisation.",
  "Ne jamais inventer de prestations, de témoignages, de prix, de logos ni de visuels présentés comme réels.",
  "Définir le storyboard avant de coder, produire des scènes originales, animer de manière fluide et vérifier chaque scène.",
  "Rendu MP4 de contrôle sur une branche isolée ; pas de diffusion, de fusion ni d'import Drive sans approbation humaine.",
  "L'agent doit signaler les ressources manquantes et le coût prévisionnel avant toute opération payante.",
 ].join("\n\n");
}
