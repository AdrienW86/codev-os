import 'server-only';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp,{type OverlayOptions} from 'sharp';
import {MOTION_CARD,motionFfmpegArgs,type MotionSceneFiles} from './filtergraph';
import {buildMotionStoryboard,buildScriptStoryboard,type MotionPalette,type MotionScript,type MotionScene,type MotionStoryboard} from './storyboard';

// Rendu d'une vidéo motion design 720 × 1280 (9:16) : calques fixes dessinés par sharp (police Montserrat embarquée,
// aucune police système requise), animation et encodage H.264 par ffmpeg (binaire fourni par l'appelant). Tout se
// passe dans un dossier temporaire supprimé à la fin, sans réseau. Les photos sont celles de la publication.
export const MOTION_MAX_OUTPUT_BYTES=60*1024*1024,MOTION_RENDER_TIMEOUT_MS=170_000;
export type MotionRenderInput={photos:Uint8Array[];seed:string;ffmpegPath:string;fontDir:string;timeoutMs?:number}&({script:MotionScript}|{text:string;clientName:string});
export type MotionRenderResult={bytes:Uint8Array;storyboard:MotionStoryboard;durationMs:number;width:number;height:number};
export class MotionRenderError extends Error{constructor(readonly code:'photos'|'text'|'engine'|'timeout'|'output'){super(`Motion render: ${code}`);}}

const FONTS={bold:'Montserrat_800ExtraBold.ttf',semi:'Montserrat_600SemiBold.ttf'} as const;
const escape=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
type Text={buffer:Buffer;width:number;height:number};
async function text(fontDir:string,value:string,o:{weight:'bold'|'semi';size:number;color:string;width:number;align?:'left'|'centre';alpha?:number}):Promise<Text>{
 const family=o.weight==='bold'?'Montserrat ExtraBold':'Montserrat SemiBold';
 const alpha=o.alpha===undefined?'':` fgalpha="${Math.round(o.alpha*100)}%"`;
 const {data,info}=await sharp({text:{text:`<span foreground="${o.color}"${alpha}>${escape(value)}</span>`,font:`${family} ${o.size}`,fontfile:join(fontDir,FONTS[o.weight]),
  width:o.width,align:o.align??'left',wrap:'word',rgba:true,dpi:72,spacing:Math.round(o.size*0.18)}}).png().toBuffer({resolveWithObject:true});
 return {buffer:data,width:info.width,height:info.height};
}
// Texte blanc avec ombre portée douce (lisible sur n'importe quelle photo).
async function shadowed(fontDir:string,value:string,o:{weight:'bold'|'semi';size:number;width:number;align?:'left'|'centre'}):Promise<{width:number;height:number;place:(left:number,top:number)=>OverlayOptions[]}>{
 const front=await text(fontDir,value,{...o,color:'#FFFFFF'});
 const shadow=await sharp((await text(fontDir,value,{...o,color:'#000000',alpha:0.55})).buffer).extend({top:12,bottom:12,left:12,right:12,background:{r:0,g:0,b:0,alpha:0}}).blur(6).png().toBuffer();
 return {width:front.width,height:front.height,place:(left,top)=>[{input:shadow,left:Math.max(left-12+3,0),top:Math.max(top-12+4,0)},{input:front.buffer,left,top}]};
}
const canvas=(w:number,h:number)=>sharp({create:{width:w,height:h,channels:4,background:{r:0,g:0,b:0,alpha:0}}});
const rect=(w:number,h:number,fill:string,rx=0,opacity=1)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${rx}" fill="${fill}" fill-opacity="${opacity}"/></svg>`);

async function photoBackground(photo:Buffer,palette:MotionPalette,board:MotionStoryboard,fontDir:string):Promise<Buffer>{
 const {width:W,height:H}=board;
 const gradient=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${palette.deep}" stop-opacity="0.35"/><stop offset="0.55" stop-color="${palette.deep}" stop-opacity="0.55"/><stop offset="1" stop-color="${palette.deep}" stop-opacity="0.92"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
 const chip=await text(fontDir,board.brand.toUpperCase(),{weight:'bold',size:22,color:palette.deep,width:560});
 const chipBox=await sharp(rect(chip.width+36,chip.height+18,palette.accent,(chip.height+18)/2)).png().toBuffer();
 return sharp(photo).resize(W,H,{fit:'cover'}).blur(30).modulate({brightness:0.6,saturation:1.1})
  .composite([{input:gradient,left:0,top:0},{input:chipBox,left:MOTION_CARD.x,top:112},{input:chip.buffer,left:MOTION_CARD.x+18,top:112+9}]).png().toBuffer();
}
async function outroBackground(palette:MotionPalette,board:MotionStoryboard):Promise<Buffer>{
 const {width:W,height:H}=board;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
<radialGradient id="r" cx="0.5" cy="0.42" r="0.7"><stop offset="0" stop-color="${palette.accent}" stop-opacity="0.45"/><stop offset="1" stop-color="${palette.deep}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="${palette.deep}"/><rect width="${W}" height="${H}" fill="url(#r)"/>
<g fill="${palette.accent}" fill-opacity="0.12"><rect x="-200" y="980" width="1200" height="36" transform="rotate(-18 360 1000)"/><rect x="-200" y="1060" width="1200" height="14" transform="rotate(-18 360 1000)"/>
<rect x="-200" y="160" width="1200" height="14" transform="rotate(-18 360 180)"/></g></svg>`;
 return sharp(Buffer.from(svg)).png().toBuffer();
}
async function sceneText(scene:MotionScene,palette:MotionPalette,board:MotionStoryboard,fontDir:string):Promise<Buffer|null>{
 const {width:W,height:H}=board,top=MOTION_CARD.y+MOTION_CARD.size+44,left=MOTION_CARD.x;
 const layers:OverlayOptions[]=[];
 if(scene.kind==='hook'&&scene.headline){
  const t=await shadowed(fontDir,scene.headline,{weight:'bold',size:46,width:560});
  layers.push({input:await sharp(rect(84,10,palette.accent,5)).png().toBuffer(),left,top},...t.place(left,top+30));
 }else if(scene.kind==='photo'&&scene.caption){
  const t=await text(fontDir,scene.caption,{weight:'semi',size:36,color:'#FFFFFF',width:540});
  const panel=await sharp(rect(t.width+48,t.height+40,palette.deep,22,0.78)).png().toBuffer();
  const bar=await sharp(rect(8,t.height+40,palette.accent,4)).png().toBuffer();
  layers.push({input:panel,left,top},{input:bar,left,top},{input:t.buffer,left:left+26,top:top+20});
 }else if(scene.kind==='outro'){
  const name=await shadowed(fontDir,scene.headline??board.brand,{weight:'bold',size:78,width:620,align:'centre'});
  const y=scene.caption?470:540;
  layers.push(...name.place(Math.round((W-name.width)/2),y));
  layers.push({input:await sharp(rect(120,10,palette.accent,5)).png().toBuffer(),left:Math.round((W-120)/2),top:y+name.height+26});
  if(scene.caption){const cta=await text(fontDir,scene.caption,{weight:'semi',size:40,color:'#FFFFFF',width:560,align:'centre'});
   layers.push({input:cta.buffer,left:Math.round((W-cta.width)/2),top:y+name.height+70});}
 }
 if(!layers.length)return null;
 return canvas(W,H).composite(layers).png().toBuffer();
}
async function run(ffmpegPath:string,args:string[],timeoutMs:number):Promise<void>{
 await new Promise<void>((resolve,reject)=>{
  let stderr='';let done=false;
  const child=spawn(ffmpegPath,args,{stdio:['ignore','ignore','pipe']});
  const timer=setTimeout(()=>{if(!done){done=true;child.kill('SIGKILL');reject(new MotionRenderError('timeout'));}},timeoutMs);
  child.stderr.on('data',(chunk:Buffer)=>{if(stderr.length<4000)stderr+=chunk.toString('utf8');});
  child.on('error',()=>{if(!done){done=true;clearTimeout(timer);reject(new MotionRenderError('engine'));}});
  child.on('close',code=>{if(done)return;done=true;clearTimeout(timer);
   if(code===0)resolve();else{console.error('[motion-video]',{step:'ffmpeg',code,detail:stderr.slice(0,600)});reject(new MotionRenderError('engine'));}});
 });
}
export async function renderMotionVideo(input:MotionRenderInput):Promise<MotionRenderResult>{
 const started=Date.now();
 let board:MotionStoryboard;
 try{board='script' in input?buildScriptStoryboard(input.script,input.photos.length,input.seed):buildMotionStoryboard({text:input.text,photoCount:input.photos.length,clientName:input.clientName,seed:input.seed});}
 catch(error){throw new MotionRenderError(error instanceof Error&&error.message==='motion_text_required'?'text':'photos');}
 const dir=await mkdtemp(join(tmpdir(),'motion-'));
 try{
  // Photos normalisées (orientation EXIF, JPEG) : ffmpeg ne lit que des fichiers sûrs produits ici.
  const photos:Buffer[]=[];
  for(const bytes of input.photos.slice(0,board.scenes.length)){
   try{photos.push(await sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning'}).rotate().flatten({background:'#ffffff'}).resize(MOTION_CARD.source,MOTION_CARD.source,{fit:'cover'}).jpeg({quality:90}).toBuffer());}
   catch{throw new MotionRenderError('photos');}
  }
  const mask=join(dir,'mask.png');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${MOTION_CARD.size}" height="${MOTION_CARD.size}"><rect width="100%" height="100%" fill="#000"/><rect width="${MOTION_CARD.size}" height="${MOTION_CARD.size}" rx="34" fill="#fff"/></svg>`)).png().toFile(mask);
  const outro=await outroBackground(board.palette,board);
  const files:MotionSceneFiles[]=[];
  for(const [i,scene] of board.scenes.entries()){
   const photo=scene.photo===null?null:photos[scene.photo];
   if(scene.photo!==null&&!photo)throw new MotionRenderError('photos');
   const background=join(dir,`bg${i}.png`);await writeFile(background,photo?await photoBackground(photo,board.palette,board,input.fontDir):outro);
   let photoPath:string|null=null;if(photo){photoPath=join(dir,`photo${i}.jpg`);await writeFile(photoPath,photo);}
   const overlay=await sceneText(scene,board.palette,board,input.fontDir);
   let textPath:string|null=null;if(overlay){textPath=join(dir,`text${i}.png`);await writeFile(textPath,overlay);}
   files.push({background,photo:photoPath,text:textPath,mask:photo?mask:null});
  }
  const output=join(dir,'motion.mp4');
  await run(input.ffmpegPath,motionFfmpegArgs(board,files,output),input.timeoutMs??MOTION_RENDER_TIMEOUT_MS);
  let bytes:Buffer;try{bytes=await readFile(output);}catch{throw new MotionRenderError('output');}
  if(bytes.length<2048||bytes.length>MOTION_MAX_OUTPUT_BYTES||bytes.subarray(4,8).toString('latin1')!=='ftyp')throw new MotionRenderError('output');
  return {bytes:new Uint8Array(bytes),storyboard:board,durationMs:Date.now()-started,width:board.width,height:board.height};
 }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
