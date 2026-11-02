"use client";
// Hors de components/publications (aucun appel réseau autorisé là) : appel de la route dédiée de même origine,
// qui dispose de sa propre durée maximale et du moteur vidéo.
import {useRouter} from "next/navigation";
import {useState} from "react";

// Génère (ou régénère) la vidéo motion design d'une publication TikTok : nouvelle version « À valider », jamais publiée.
export function MotionVideoButton({publicationId,hasVideo}:{publicationId:string;hasVideo:boolean}){
 const router=useRouter();
 const [pending,setPending]=useState(false),[message,setMessage]=useState<string|null>(null);
 async function run(){
  setPending(true);setMessage(null);
  try{
   const response=await fetch(`/api/publications/${publicationId}/motion-video`,{method:"POST",cache:"no-store"});
   const body=await response.json().catch(()=>null) as {ok?:boolean;message?:string}|null;
   setMessage(body?.message??(response.ok?"Vidéo prête.":"La vidéo n’a pas pu être générée."));
   if(body?.ok)router.refresh();
  }catch{setMessage("Connexion interrompue : la vidéo n’a pas pu être générée.");}
  finally{setPending(false);}
 }
 return <div className="space-y-1" data-motion-video-action="true">
  <button type="button" onClick={run} disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-60">
   {pending?"Création de la vidéo… (jusqu’à 1 minute)":hasVideo?"Régénérer la vidéo motion design":"Créer la vidéo motion design"}</button>
  <p className="text-xs text-muted">{message??(hasVideo?"Une nouvelle version de la vidéo sera créée à partir des mêmes photos.":"Les photos et le texte deviennent une courte vidéo animée 9:16. Elle remplacera les photos sur TikTok après votre validation.")}</p>
 </div>;
}
