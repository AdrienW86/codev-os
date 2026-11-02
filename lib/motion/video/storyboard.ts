// Storyboard d'une vidéo motion design verticale (Studio vidéo), construit UNIQUEMENT à partir du script saisi (ou
// d'un texte de publication), des photos réelles du client et de son nom : aucun visuel ni texte ajouté.
// Pur et déterministe (même publication → même vidéo) : utilisable dans les tests sans ffmpeg.
export const MOTION_VIDEO={width:720,height:1280,fps:30} as const;
export const MOTION_MAX_PHOTOS=8,MOTION_MAX_SECONDS=30,MOTION_TRANSITION_SECONDS=0.5;
export type MotionMove='zoom_in'|'zoom_out'|'pan_left'|'pan_right';
export type MotionTransition='slideup'|'smoothleft'|'smoothright'|'fade'|'circleopen'|'wipeup';
export type MotionScene={kind:'hook'|'photo'|'outro';photo:number|null;duration:number;headline:string|null;caption:string|null;move:MotionMove;transition:MotionTransition};
export type MotionPalette={accent:string;deep:string;ink:string};
export type MotionStoryboard={width:number;height:number;fps:number;scenes:MotionScene[];total:number;brand:string;palette:MotionPalette};

// Palettes contrastées (texte blanc sur fond profond, accent lisible) ; choix stable par client.
export const MOTION_PALETTES:readonly MotionPalette[]=[
 {accent:'#F5B83D',deep:'#0B1B3F',ink:'#FFFFFF'},
 {accent:'#FF6B4A',deep:'#1A1033',ink:'#FFFFFF'},
 {accent:'#3DD6C4',deep:'#0A2230',ink:'#FFFFFF'},
 {accent:'#8FD14F',deep:'#13261A',ink:'#FFFFFF'},
 {accent:'#7C9CFF',deep:'#101735',ink:'#FFFFFF'},
];
const MOVES:readonly MotionMove[]=['zoom_in','pan_left','zoom_out','pan_right'];
const TRANSITIONS:readonly MotionTransition[]=['slideup','smoothleft','circleopen','smoothright','wipeup','fade'];

/** Empreinte 32 bits stable (FNV-1a) : choix déterministes des palettes, mouvements et transitions. */
export function motionSeed(value:string):number{let h=0x811c9dc5;for(const c of value){h^=c.codePointAt(0)!;h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}

/** Texte affichable à l'image : sans emoji, hashtag, mention ni lien (la police n'a pas ces glyphes ; ils restent dans la légende). */
export function overlayText(value:string):string{
 return value.replace(/https?:\/\/\S+/g,' ').replace(/[#@][\p{L}\p{N}_]+/gu,' ')
  .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu,' ')
  .replace(/[<>&]/g,' ').replace(/\s+/g,' ').replace(/\s+([,.…])/g,'$1').trim().replace(/^[-–—•·:,;.]+\s*/,'');
}
/** Coupe proprement à max caractères sur une limite de mot (points de suspension si coupé). */
export function clampWords(value:string,max:number):string{
 const chars=[...value];if(chars.length<=max)return value;
 const cut=chars.slice(0,max-1).join(''),space=cut.lastIndexOf(' ');
 return (space>max*0.5?cut.slice(0,space):cut).replace(/[\s,;:–—-]+$/,'')+'…';
}
/** Phrases du texte (lignes puis ponctuation forte), nettoyées pour l'image ; vides et doublons retirés. */
export function sentencesOf(text:string):string[]{
 const out:string[]=[],seen=new Set<string>();
 for(const line of text.split(/\n+/))for(const part of line.split(/(?<=[.!?…])\s+/)){
  const clean=overlayText(part);const key=clean.toLowerCase();
  if([...clean].length>=12&&/\p{L}{3}/u.test(clean)&&!seen.has(key)){seen.add(key);out.push(clean);}
 }
 return out;
}
const CTA=/\b(devis|contact|contactez|appel|appelez|rendez-vous|réserv|découvr|écrivez|demandez|profitez|passez|venez)/i;
export type MotionPace='dynamic'|'standard'|'calm';
export const MOTION_PACES:Record<MotionPace,{label:string;scene:number;hook:number;outro:number}>={
 dynamic:{label:'Dynamique',scene:2.3,hook:2.8,outro:2.6},standard:{label:'Standard',scene:2.9,hook:3.4,outro:3},calm:{label:'Posé',scene:3.6,hook:4,outro:3.4}};
/** Script d'une vidéo du Studio : accroche, une légende par photo suivante (facultative), phrase de fin (facultative). */
export type MotionScript={headline:string;captions:string[];closing:string|null;brand:string;pace?:MotionPace};
export type StoryboardInput={text:string;photoCount:number;clientName:string;seed:string};
/** Script tiré d'un texte de publication : 1re phrase en accroche, suivantes en légendes, appel à l'action à la fin. */
export function scriptFromText(text:string,clientName:string):MotionScript{
 const sentences=sentencesOf(text);
 if(!sentences.length)throw new Error('motion_text_required');
 const closing=sentences.slice(1).reverse().find(s=>CTA.test(s))??null;
 return {headline:sentences[0],captions:sentences.slice(1).filter(s=>s!==closing),closing,brand:clientName};
}
export function buildMotionStoryboard(input:StoryboardInput):MotionStoryboard{
 return buildScriptStoryboard(scriptFromText(input.text,input.clientName),input.photoCount,input.seed);
}
export function buildScriptStoryboard(script:MotionScript,photoCount:number,seedValue:string):MotionStoryboard{
 const photos=Math.min(Math.max(Math.trunc(photoCount),0),MOTION_MAX_PHOTOS);
 if(photos<1)throw new Error('motion_photos_required');
 const headline=overlayText(script.headline);
 if([...headline].length<2||!/\p{L}/u.test(headline))throw new Error('motion_text_required');
 const pace=MOTION_PACES[script.pace??'standard'];
 const seed=motionSeed(seedValue),palette=MOTION_PALETTES[motionSeed(script.brand.toLowerCase())%MOTION_PALETTES.length];
 const brand=clampWords(overlayText(script.brand)||'CODE-V',32);
 const body=script.captions.map(overlayText).filter(c=>c.length>0),cta=script.closing?overlayText(script.closing)||null:null;
 const scenes:MotionScene[]=[];
 const move=(i:number)=>MOVES[(seed+i)%MOVES.length],transition=(i:number)=>TRANSITIONS[((seed>>>3)+i)%TRANSITIONS.length];
 scenes.push({kind:'hook',photo:0,duration:pace.hook,headline:clampWords(headline,72),caption:null,move:'zoom_in',transition:'fade'});
 // Une scène par photo suivante, chacune avec la légende suivante (rien n'est ajouté s'il n'y en a plus).
 const followers=Math.max(photos-1,photos===1&&body.length?1:0);
 for(let i=0;i<followers;i++){
  const photo=photos===1?0:i+1;
  scenes.push({kind:'photo',photo,duration:pace.scene,headline:null,caption:body[i]?clampWords(body[i],96):null,move:photos===1?'pan_left':move(i+1),transition:transition(i)});
 }
 scenes.push({kind:'outro',photo:null,duration:pace.outro,headline:brand,caption:cta?clampWords(cta,80):null,move:'zoom_in',transition:'slideup'});
 // Durée bornée : on retire des scènes photo (jamais l'accroche ni la fin) au-delà du maximum.
 const total=()=>scenes.reduce((s,x)=>s+x.duration,0)-(scenes.length-1)*MOTION_TRANSITION_SECONDS;
 while(total()>MOTION_MAX_SECONDS&&scenes.length>3)scenes.splice(scenes.length-2,1);
 return {...MOTION_VIDEO,scenes,total:Math.round(total()*1000)/1000,brand,palette};
}
