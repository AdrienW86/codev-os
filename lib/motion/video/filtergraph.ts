// Arguments ffmpeg d'un storyboard (pur, testable sans ffmpeg). Chaque scène = fond pré-rendu (photo floutée ou
// dégradé de marque) + carte photo animée (Ken Burns : zoom ou travelling) + calque texte qui glisse en fondu ;
// scènes enchaînées par des transitions xfade, barre de progression, musique de fond (ou piste muette : lecteurs exigeants).
// Les arguments sont passés tels quels à spawn (jamais de shell) ; les chemins viennent du moteur, pas de l'utilisateur.
import {MOTION_TRANSITION_SECONDS,type MotionMove,type MotionStoryboard} from './storyboard';

export const MOTION_CARD={x:60,y:190,size:600,source:1800} as const;
export type MotionSceneFiles={background:string;photo:string|null;text:string|null;mask:string|null};
const r3=(n:number)=>Math.round(n*1000)/1000;
function zoompan(move:MotionMove,frames:number,fps:number):string{
 const n=Math.max(frames-1,1),p=`(on/${n})`;
 // Easing doux (smoothstep) pour éviter un mouvement mécanique.
 const e=`(${p}*${p}*(3-2*${p}))`;
 const center="x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
 const z=move==='zoom_in'?`z='1+0.16*${e}':${center}`:move==='zoom_out'?`z='1.16-0.16*${e}':${center}`
  :move==='pan_left'?`z='1.14':x='(iw-iw/zoom)*(1-${e})':y='ih/2-(ih/zoom/2)'`:`z='1.14':x='(iw-iw/zoom)*${e}':y='ih/2-(ih/zoom/2)'`;
 return `zoompan=${z}:d=${frames}:s=${MOTION_CARD.size}x${MOTION_CARD.size}:fps=${fps}`;
}
const hex=(color:string)=>{if(!/^#[0-9A-Fa-f]{6}$/.test(color))throw new Error('motion_invalid_color');return '0x'+color.slice(1);};
export function motionFfmpegArgs(board:MotionStoryboard,files:MotionSceneFiles[],output:string,music:string|null=null):string[]{
 if(files.length!==board.scenes.length)throw new Error('motion_files_mismatch');
 const {fps,width,height}=board,T=MOTION_TRANSITION_SECONDS;
 const args=['-hide_banner','-nostdin','-loglevel','error','-y'];
 const graph:string[]=[];let input=0;
 const still=(path:string,seconds:number)=>{args.push('-loop','1','-framerate',String(fps),'-t',String(r3(seconds)),'-i',path);return input++;};
 board.scenes.forEach((scene,i)=>{
  const f=files[i],frames=Math.round(scene.duration*fps);
  const bg=still(f.background,scene.duration);
  let current=`[${bg}:v]format=rgba[bg${i}]`;graph.push(current);current=`bg${i}`;
  if(scene.photo!==null&&f.photo&&f.mask){
   args.push('-i',f.photo);const photo=input++;const mask=still(f.mask,scene.duration);
   graph.push(`[${photo}:v]scale=${MOTION_CARD.source}:${MOTION_CARD.source}:force_original_aspect_ratio=increase,crop=${MOTION_CARD.source}:${MOTION_CARD.source},setsar=1,${zoompan(scene.move,frames,fps)},format=rgba[ph${i}]`);
   graph.push(`[${mask}:v]format=gray,scale=${MOTION_CARD.size}:${MOTION_CARD.size}[mk${i}]`);
   graph.push(`[ph${i}][mk${i}]alphamerge,fade=t=in:st=0:d=0.4:alpha=1[card${i}]`);
   graph.push(`[${current}][card${i}]overlay=x=${MOTION_CARD.x}:y='${MOTION_CARD.y}+70*pow(min(1,max(0,1-t/0.5)),3)':eof_action=repeat[wc${i}]`);current=`wc${i}`;
  }
  if(f.text){
   const text=still(f.text,scene.duration);
   graph.push(`[${text}:v]format=rgba,fade=t=in:st=0.3:d=0.45:alpha=1[tx${i}]`);
   graph.push(`[${current}][tx${i}]overlay=x=0:y='80*pow(min(1,max(0,1-(t-0.3)/0.45)),3)':eof_action=repeat[wt${i}]`);current=`wt${i}`;
  }
  graph.push(`[${current}]trim=duration=${r3(scene.duration)},setpts=PTS-STARTPTS,fps=${fps},format=yuv420p,setsar=1,settb=AVTB[s${i}]`);
 });
 let chain='s0',elapsed=board.scenes[0].duration;
 for(let k=1;k<board.scenes.length;k++){
  const offset=r3(elapsed-k*T);
  graph.push(`[${chain}][s${k}]xfade=transition=${board.scenes[k].transition}:duration=${T}:offset=${offset}[x${k}]`);
  chain=`x${k}`;elapsed+=board.scenes[k].duration;
 }
 const total=r3(board.total);
 graph.push(`color=c=${hex(board.palette.accent)}:s=${width}x8:r=${fps}:d=${total}[bar]`);
 graph.push(`[${chain}][bar]overlay=x='-w+w*t/${total}':y=0:shortest=1,format=yuv420p[vout]`);
 // Musique : morceau embarqué (bouclé si plus court), coupé à la durée de la vidéo avec fondus ; sinon piste muette.
 let audioMap:string;
 if(music){args.push('-stream_loop','-1','-i',music);const m=input++;const fadeOut=r3(Math.max(total-1.6,0));
  graph.push(`[${m}:a]atrim=0:${total},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo,afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOut}:d=1.6,volume=0.85[aout]`);audioMap='[aout]';}
 else{args.push('-f','lavfi','-t',String(total),'-i','anullsrc=channel_layout=stereo:sample_rate=44100');audioMap=`${input++}:a`;}
 args.push('-filter_complex',graph.join(';'),'-map','[vout]','-map',audioMap,
  '-c:v','libx264','-preset','veryfast','-crf','21','-profile:v','high','-pix_fmt','yuv420p','-r',String(fps),'-g',String(fps*2),
  '-c:a','aac','-b:a',music?'160k':'96k','-t',String(total),'-movflags','+faststart','-s',`${width}x${height}`,output);
 return args;
}
