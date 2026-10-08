import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isPublicationUuid} from './validation';

// Lot 4.3 P5: explicit, one-way, audited archive of a publication (never a delete, no restore yet).
export async function archivePublication(publicationId:unknown):Promise<{ok:boolean;message:string}>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(publicationId))return {ok:false,message:'Publication invalide.'};
 const {error}=await getSupabaseServerClient().rpc('publication_archive',{p_publication_id:publicationId,p_actor_id:userId});
 if(!error)return {ok:true,message:'Publication archivée. Elle reste consultable dans la vue « Archivées ».'};
 return {ok:false,message:error.code==='55000'?(/deliver/i.test(error.message??'')?'Un envoi est encore actif : archivage impossible.':'Cette publication est déjà archivée.'):error.code==='23514'?'Publication introuvable.':'Archivage non confirmé. Réessayez.'};
}
