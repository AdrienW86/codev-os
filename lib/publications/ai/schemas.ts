import type {GeneratedContent,GenerationContext} from './provider';
const string={type:'string'};
export const SAFE_GENERATION_SUMMARY='Sujet et photo compatibles ; validation humaine requise.';
export const SAFE_CTA='Contactez-nous pour parler de votre besoin.';
const platforms=['facebook','instagram','google_business_profile'] as const;
const contentKeys=['internal_title','subject','source_content','selected_opportunity','selected_asset_id','facebook','instagram','google_business_profile','factual_basis','generation_summary'];
const selectionKeys=['selected_opportunity','selected_asset_id','source_sentences','facebook','instagram','google_business_profile'];
// The model only selects approved sentence indices, their order, and fixed title/CTA values; it never writes text.
export function generationSchemaFor(c:GenerationContext){
 const count=c.approved_sentences.length,indices={type:'array',items:{type:'integer',enum:Array.from({length:count},(_,i)=>i)}};
 const channel={type:'object',additionalProperties:false,properties:{sentences:indices,title:{anyOf:[{type:'null'},{type:'string',enum:[c.subject]}]},cta:{anyOf:[{type:'null'},{type:'string',enum:[SAFE_CTA]}]}},required:['sentences','title','cta']};
 return {type:'object',additionalProperties:false,properties:{selected_opportunity:{type:'string',enum:[c.opportunity.id]},selected_asset_id:{type:'string',enum:[c.photo.id]},source_sentences:indices,...Object.fromEntries(platforms.map(p=>[p,c.platforms.includes(p)?channel:{type:'null'}]))},required:selectionKeys};
}
export const analysisSchema={type:'object',additionalProperties:false,properties:{photos:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:string,scene:{type:'string',enum:['roof','pests','paint','facade','digital','other']},confidence:{type:'number',minimum:0,maximum:1},usable:{type:'boolean'}},required:['id','scene','confidence','usable']}}},required:['photos']};
const sameKeys=(value:object,keys:string[])=>Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
// Builds the final content from exact approved sentences, then re-checks it with the strict content validator.
export function assembleGeneratedContent(input:unknown,c:GenerationContext):GeneratedContent{
 if(!input||typeof input!=='object'||Array.isArray(input)||!sameKeys(input,selectionKeys))throw Error('Invalid selection');const s=input as Record<string,unknown>;
 if(s.selected_opportunity!==c.opportunity.id||s.selected_asset_id!==c.photo.id)throw Error('Invalid selection');
 const used:string[]=[];
 const pick=(value:unknown)=>{if(!Array.isArray(value)||value.length<1||value.length>c.approved_sentences.length||new Set(value).size!==value.length||!value.every(i=>Number.isInteger(i)&&i>=0&&i<c.approved_sentences.length))throw Error('Invalid selection');const lines=value.map(i=>c.approved_sentences[i as number]);for(const line of lines)if(!used.includes(line))used.push(line);return lines.join('\n');};
 const source_content=pick(s.source_sentences);
 const channels=Object.fromEntries(platforms.map(p=>{const v=s[p];if(!c.platforms.includes(p)){if(v!==null)throw Error('Unexpected channel');return [p,null];}
  if(!v||typeof v!=='object'||Array.isArray(v)||!sameKeys(v,['sentences','title','cta']))throw Error('Invalid selection');const ch=v as {sentences:unknown;title:unknown;cta:unknown};
  if(ch.title!==null&&ch.title!==c.subject||ch.cta!==null&&ch.cta!==SAFE_CTA)throw Error('Invalid selection');return [p,{text:pick(ch.sentences),title:ch.title as string|null,cta:ch.cta as string|null}];})) as Pick<GeneratedContent,typeof platforms[number]>;
 return validateGeneratedContent({internal_title:c.subject,subject:c.subject,source_content,selected_opportunity:c.opportunity.id,selected_asset_id:c.photo.id,...channels,factual_basis:used,generation_summary:SAFE_GENERATION_SUMMARY},c);
}
export function validateGeneratedContent(input:unknown,c:GenerationContext):GeneratedContent{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid output');const g=input as GeneratedContent;
 if(!sameKeys(g,contentKeys)||g.internal_title!==c.subject||g.subject!==c.subject||g.selected_asset_id!==c.photo.id||g.selected_opportunity!==c.opportunity.id||typeof g.source_content!=='string'||g.source_content.length>20000||g.generation_summary!==SAFE_GENERATION_SUMMARY||!Array.isArray(g.factual_basis)||!g.factual_basis.every(f=>typeof f==='string'&&c.approved_sentences.includes(f)))throw Error('Unverified output');
 const allowed=new Set(c.approved_sentences);const validateText=(text:string)=>typeof text==='string'&&text.trim().length>0&&text.length<=10000&&text.split('\n').every(s=>!s.trim()||allowed.has(s.trim()))&&text.split('\n').filter(s=>s.trim()).every(s=>g.factual_basis.includes(s.trim()));
 if(!validateText(g.source_content))throw Error('Unsupported factual source');
 for(const p of platforms){const v=g[p];if(!c.platforms.includes(p)){if(v!==null)throw Error('Unexpected channel');continue;}if(!v||Object.keys(v).sort().join(',')!=='cta,text,title'||!validateText(v.text)||v.title!==null&&v.title!==c.subject||v.cta!==null&&v.cta!==SAFE_CTA)throw Error('Unsupported claim');}
 return g;
}
