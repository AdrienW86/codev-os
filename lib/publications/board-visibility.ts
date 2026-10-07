import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';

// Interim "remove from board" without migration: an append-only audit event masks the row in the cockpit only.
// Nothing is deleted or frozen (revisions, reviews, runs, media, jobs and deliveries are untouched); the latest
// event wins, so a removal is reversible. A real archive (archived_at, frozen workflow) needs a dedicated migration.
import {BOARD_HIDDEN,BOARD_RESTORED} from './board-visibility-events';
export {BOARD_HIDDEN,BOARD_RESTORED,hiddenPublications,type BoardVisibilityEvent} from './board-visibility-events';

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
