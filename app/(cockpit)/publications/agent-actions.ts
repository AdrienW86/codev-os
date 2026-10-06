'use server';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/require-admin';
import {configurePublicationsAgent,preparePublication} from '@/lib/publications/agent-service';
import {isPublicationUuid} from '@/lib/publications/validation';
type State={message?:string};
export async function configureAgentAction(_state:State,form:FormData):Promise<State>{
 await requireAdmin();let result:State;try{result=await configurePublicationsAgent(form);}catch{result={message:'Configuration non confirmée. Vérifiez le projet et le socle Lot 4.'};}
 const project=form.get('project_id');if(isPublicationUuid(project))revalidatePath(`/projects/${project}`);return result;
}
export async function prepareAgentAction(_state:State,form:FormData):Promise<State>{
 await requireAdmin();const project=form.get('project_id'),publication=form.get('publication_id');
 if(!isPublicationUuid(project)||!isPublicationUuid(publication)||form.getAll('authorize_ai').length!==1||form.get('authorize_ai')!=='on')return {message:'Autorisez explicitement un appel IA sur une seule publication.'};
 let result:State;try{result=await preparePublication(project,publication,{allowRealAI:true});}catch{result={message:'Préparation indisponible : vérifiez l’assignation, le créneau et les droits médias.'};}
 revalidatePath(`/projects/${project}`);revalidatePath(`/publications/${publication}`);revalidatePath('/publications');revalidatePath('/publications/review');revalidatePath('/publications/calendar');return result;
}
