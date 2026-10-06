import 'server-only';
import {structuredResponse} from '@/lib/integrations/publications-openai';
import {visionPreview} from '../media/transform';
import {generationSchemaFor,analysisSchema} from './schemas';
import {generationInstructions,photoInstructions} from './prompts';
import type {PublicationsAIProvider} from './provider';
import type {PhotoScene} from '../media/types';
const descriptions:Record<PhotoScene,string>={roof:'Surface de toiture visible.',pests:'Insecte ou nuisible visible.',paint:'Surface peinte ou matériel de peinture visible.',facade:'Surface de façade visible.',digital:'Élément numérique visible : écran, ordinateur ou interface.',other:'Scène non identifiée avec suffisamment de certitude.'};
export function openaiPublicationsProvider():PublicationsAIProvider{return {
 async analyze(photos){if(!photos.length||photos.length>3)throw Error('Bounded photo analysis required');const content=[];for(const p of photos){const bytes=await visionPreview(p.bytes);content.push({type:'input_text',text:`Photo ${p.id}`},{type:'input_image',image_url:`data:image/jpeg;base64,${bytes.toString('base64')}`,detail:'low'});}const r=await structuredResponse(photoInstructions,[{role:'user',content}],analysisSchema);const values=(r.value as {photos: {id:string;scene:PhotoScene;confidence:number;usable:boolean}[]}).photos;if(!Array.isArray(values)||values.length!==photos.length||new Set(values.map(p=>p.id)).size!==photos.length)throw Error('Invalid media analysis');return {usage:r.usage,analyses:values.map(p=>{if(!photos.some(v=>v.id===p.id)||!Object.hasOwn(descriptions,p.scene)||!Number.isFinite(p.confidence)||p.confidence<0||p.confidence>1||typeof p.usable!=='boolean')throw Error('Invalid media analysis');return {id:p.id,analysis:{scene:p.scene,description:descriptions[p.scene],confidence:p.confidence,usable:p.usable,limitations:['Analyse visuelle prudente, aucune localisation ou réalisation client déduite.']}};})};},
 async generate(context){const encoded=JSON.stringify(context);if(encoded.length>40000)throw Error('AI context too large');const r=await structuredResponse(generationInstructions,encoded,generationSchemaFor(context));return {content:r.value,usage:r.usage};}
};}
