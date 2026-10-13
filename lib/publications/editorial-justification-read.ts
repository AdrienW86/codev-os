import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {justificationView,type JustificationView} from './editorial-justification';
import {isPublicationUuid} from './validation';

// Intelligence éditoriale (PR #42) — justification de la préparation qui a créé une publication (lecture seule).
// Le run le plus récent dont publication_ids contient la publication. Toute erreur (migration absente, lecture refusée)
// masque simplement le panneau : la justification est une information, jamais une condition d'approbation.
export async function getPublicationJustification(publicationId:string):Promise<JustificationView|null>{
 await requireAdmin();return loadPublicationJustification(publicationId);
}
// Sans nouvelle vérification de session : appelée par loadPublicationDetail, qui a déjà exigé l'administrateur.
export async function loadPublicationJustification(publicationId:string):Promise<JustificationView|null>{
 if(!isPublicationUuid(publicationId))return null;
 try{
  const r=await getSupabaseServerClient().from('publication_agent_v2_runs').select('editorial_justification,created_at').contains('publication_ids',[publicationId])
   .order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(r.error||!r.data)return null;
  return justificationView((r.data as {editorial_justification?:unknown}).editorial_justification??null);
 }catch{return null;}
}
