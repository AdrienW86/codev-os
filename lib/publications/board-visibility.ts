import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';

// Interim "remove from board" without migration: an append-only audit event masks the row in the cockpit only.
// Nothing is deleted or frozen (revisions, reviews, runs, media, jobs and deliveries are untouched); the latest
// event wins, so a removal is reversible. A real archive (archived_at, frozen workflow) needs a dedicated migration.
export const BOARD_HIDDEN='publication.board_hidden',BOARD_RESTORED='publication.board_restored';
export type BoardVisibilityEvent={resource_id:string;action:string;created_at:string};

export function hiddenPublications(events:BoardVisibilityEvent[]):Set<string>{
 const latest=new Map<string,BoardVisibilityEvent>();
 for(const e of events){const seen=latest.get(e.resource_id);if(!seen||e.created_at>=seen.created_at)latest.set(e.resource_id,e);}
 return new Set([...latest.values()].filter(e=>e.action===BOARD_HIDDEN).map(e=>e.resource_id));
}

export async function setBoardVisibility(form:FormData,hidden:boolean):Promise<{ok:boolean;message:string}>{
 const {userId}=await requireAdmin();const id=form.get('publication_id');
 if(!isPublicationUuid(id))return {ok:false,message:'Publication invalide.'};
 if(hidden&&form.get('confirm')!=='on')return {ok:false,message:'Confirmation requise pour retirer la publication du tableau.'};
 const db=getSupabaseServerClient();
 const publication=await db.from('publications').select('id,client_id').eq('id',id).maybeSingle();
 if(publication.error||!publication.data)return {ok:false,message:'Publication introuvable.'};
 const inserted=await db.from('publication_events').insert({actor_type:'admin',actor_id:userId,action:hidden?BOARD_HIDDEN:BOARD_RESTORED,client_id:publication.data.client_id,resource_type:'publication',resource_id:id,metadata:{scope:'board'}});
 if(inserted.error){console.error('[publications] Retrait du tableau non confirmé.');return {ok:false,message:'Opération non confirmée. Rechargez le tableau.'};}
 return {ok:true,message:hidden?'Publication retirée du tableau.':'Publication remise dans le tableau.'};
}
