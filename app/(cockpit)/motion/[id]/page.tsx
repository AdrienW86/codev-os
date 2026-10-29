import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/require-admin";
import { PageHeading, Panel, Badge } from "@/components/ui/primitives";
import { listMotionSources, getMotionProject } from "@/lib/motion/service";
import { listMotionDriveFiles } from "@/lib/motion/drive";
import { motionProductionHandoff } from "@/lib/motion/handoff";
import type { MotionFile } from "@/lib/motion/model";

export const metadata:Metadata={title:"Brief du Studio Motion"};
export default async function MotionDetailPage({params}:{params:Promise<{id:string}>}){
 await requireAdmin();
 const {id}=await params;
 const project=await getMotionProject(id);
 if(!project)notFound();
 const sources=await listMotionSources();
 const source=sources.find(s=>s.clientId===project.client_id&&s.folderId===project.source_folder_id);
 let files:MotionFile[]|null=null;
 let driveError:string|null=null;
 if(!source)driveError="Les droits sur le dossier Drive ont été retirés ou la configuration a changé.";
 else {
  try{files=await listMotionDriveFiles(project.client_id,project.source_folder_id);}
  catch{driveError="La lecture des fichiers Drive a échoué. Vérifiez le connecteur Drive en lecture seule.";}
 }
 const handoff=motionProductionHandoff(project,files);
 return <>
  <div className="mb-4 text-sm"><Link href="/motion" className="text-accent hover:underline">← Studio Motion</Link></div>
  <PageHeading eyebrow={source?.clientName??"Client à vérifier"} title={project.title}
   description="Brief enregistré et inventaire Drive réel. Aucun rendu, voix, coût API ou livraison n&apos;a été déclenché." />
  <div className="mb-5 flex flex-wrap items-center gap-3 text-sm"><Badge>Brouillon</Badge>
   <span className="text-muted">{project.duration_seconds} s · {project.aspect_ratio} · {project.engine==="remotion"?"Claude + Remotion envisagé":"Création libre envisagée"}</span>
  </div>
  <div className="grid gap-5 lg:grid-cols-2">
   <Panel className="p-6">
    <h2 className="font-semibold">Brief de production</h2>
    <h3 className="mt-5 text-sm font-semibold">Objectif et scénario</h3>
    <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{project.brief}</p>
    <h3 className="mt-5 text-sm font-semibold">Direction artistique</h3>
    <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{project.brand_direction||"À définir à partir des éléments de marque réellement vérifiés."}</p>
    <h3 className="mt-5 text-sm font-semibold">Voix</h3>
    <p className="mt-2 text-sm text-muted">{project.voice_mode==="elevenlabs"?"ElevenLabs envisagé — non connecté dans ce lot.":"Aucune voix générée prévue."}</p>
   </Panel>
   <Panel className="p-6">
    <h2 className="font-semibold">Médias du client sur Drive</h2>
    <p className="mt-2 text-xs text-muted">Métadonnées des 100 fichiers les plus récents (images, vidéos, sons). Aucun média copié dans CODE-V OS.</p>
    {source&&<p className="mt-3 text-sm">{source.label} · dossier …{source.folderId.slice(-6)}</p>}
    {driveError&&<p role="alert" className="mt-4 text-sm">{driveError}</p>}
    {files!==null&&(files.length ? <ul className="mt-4 max-h-[440px] space-y-2 overflow-y-auto">
     {files.map(file=><li key={file.id} className="border-b border-border pb-2 text-sm">
      <a href={"https://drive.google.com/file/d/"+file.id+"/view"} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">{file.name}</a>
      <p className="mt-1 text-xs text-muted">{file.mimeType} · {(file.size/1048576).toFixed(1)} Mo</p>
     </li>)}
    </ul> : <p className="mt-4 text-sm text-muted">Aucun fichier compatible trouvé dans les 100 plus récents du dossier.</p>)}
   </Panel>
  </div>
  <Panel className="mt-5 p-6">
   <h2 className="font-semibold">Transmission à Claude Code — version manuelle</h2>
   <p className="mt-2 text-sm text-muted">Ce brief est préparé à partir des données réelles. Il peut servir de consigne de travail, mais ne déclenche pas encore un agent, un rendu MP4 ou un upload Drive.</p>
   <label className="mt-4 block text-sm font-medium" htmlFor="motion-handoff">Consignes structurées</label>
   <textarea id="motion-handoff" className="mt-2 w-full rounded-lg border border-border bg-surface p-4 font-mono text-xs" rows={12} readOnly value={handoff} aria-label="Consignes à copier pour Claude Code"/>
   <p className="mt-3 text-xs text-muted">La validation de la vidéo, les corrections, le suivi des coûts et la livraison MP4 seront ajoutés après le raccordement du moteur de rendu isolé.</p>
  </Panel>
 </>;
}
