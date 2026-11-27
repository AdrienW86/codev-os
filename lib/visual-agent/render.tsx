import 'server-only';
import {ImageResponse} from 'next/og';
import sharp from 'sharp';
import {VISUAL_HEIGHT,VISUAL_WIDTH,fitLogo,readableOn,type VisualTemplate} from './model';

// Rendu d'un visuel à la charte (1080 × 1350, portrait 4:5 : le format le plus visible sur Instagram et Facebook).
// Mise en page simple et lisible : logo exact du client, couleurs de la charte, prestation, accroche, ligne de contact.
// Aucun texte n'est inventé ici : tout vient des réglages du client et de l'accroche déjà contrôlée.
export type VisualContent={template:VisualTemplate;service:string;headline:string;subline:string|null;contactLine:string|null;clientName:string;
 primaryColor:string;secondaryColor:string;textColor:string;logo:Uint8Array|null;
 /** Vraie photo de la photothèque du client (fond), ou null : visuel purement graphique. */photo?:Uint8Array|null};

/** Logo normalisé en PNG (fond transparent conservé), 480 px au plus, pour l'insérer dans le rendu. */
export type LogoImage={src:string;width:number;height:number};
export async function logoDataUrl(bytes:Uint8Array|null):Promise<LogoImage|null>{
 if(!bytes?.length)return null;
 try{const {data,info}=await sharp(bytes,{limitInputPixels:24000000,animated:false}).rotate().resize(480,480,{fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  return {src:`data:image/png;base64,${data.toString('base64')}`,width:info.width,height:info.height};}catch{return null;}
}
/** Couleurs dominantes d'un logo (proposition de charte) : couleur principale et seconde couleur distincte. */
export async function logoColors(bytes:Uint8Array):Promise<{primary:string;secondary:string}|null>{
 try{
  const {data,info}=await sharp(bytes,{limitInputPixels:24000000}).resize(64,64,{fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const buckets=new Map<string,{n:number;r:number;g:number;b:number}>();
  for(let i=0;i<data.length;i+=info.channels){const [r,g,b,a]=[data[i],data[i+1],data[i+2],data[i+3]];if(a<128)continue;
   const max=Math.max(r,g,b),min=Math.min(r,g,b);if(max>235&&min>235)continue;// fond blanc ignoré
   const k=`${r>>5},${g>>5},${b>>5}`,e=buckets.get(k)??{n:0,r:0,g:0,b:0};e.n++;e.r+=r;e.g+=g;e.b+=b;buckets.set(k,e);}
  const hex=(e:{n:number;r:number;g:number;b:number})=>'#'+[e.r,e.g,e.b].map(v=>Math.round(v/e.n).toString(16).padStart(2,'0')).join('');
  const ranked=[...buckets.values()].sort((a,b)=>b.n-a.n);if(!ranked.length)return null;
  const first=ranked[0],dist=(a:typeof first,b:typeof first)=>Math.abs(a.r/a.n-b.r/b.n)+Math.abs(a.g/a.n-b.g/b.n)+Math.abs(a.b/a.n-b.b/b.n);
  const second=ranked.find(e=>dist(e,first)>120)??first;
  return {primary:hex(first),secondary:hex(second)};
 }catch{return null;}
}

function Logo({src,size,clientName,color}:{src:LogoImage|null;size:number;clientName:string;color:string}){
 if(src){const {width,height}=fitLogo(src,size);return <img src={src.src} alt="" width={width} height={height} style={{width,height}}/>;}
 return <div style={{display:'flex',fontSize:44,fontWeight:700,color,letterSpacing:1}}>{clientName}</div>;
}
/** Photo recadrée exactement au cadre (cover, centrée sur la zone la plus riche) : le moteur de rendu ne recadre pas. */
export async function photoBox(bytes:Uint8Array|null|undefined,width:number,height:number):Promise<string|null>{
 if(!bytes?.length)return null;
 try{const out=await sharp(bytes,{limitInputPixels:40000000,animated:false}).rotate().resize(width,height,{fit:'cover',position:'attention'}).modulate({saturation:1.05}).jpeg({quality:86}).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;}catch{return null;}
}
/** Cadres photo de chaque mise en page (largeur × hauteur en px, rendu 1080 × 1350). */
export const PHOTO_FRAMES:Record<VisualTemplate,{width:number;height:number}>={bandeau:{width:1080,height:760},diagonale:{width:1080,height:1350},encadre:{width:968,height:640},minimal:{width:920,height:600}};
const hexA=(hex:string,alpha:number)=>`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${alpha})`;

/**
 * Mises en page avec une vraie photo du client : la photo porte le sujet, la charte (couleurs, logo) encadre le message.
 * Une seule accroche dominante, contraste garanti par un aplat ou un dégradé de la couleur principale.
 */
function photoLayout(c:VisualContent,logo:LogoImage|null,photo:string,fontFamily:string){
 const onPrimary=c.textColor,onSecondary=readableOn(c.secondaryColor),title={fontSize:c.headline.length>40?66:78,fontWeight:700,lineHeight:1.08,letterSpacing:-1};
 const tag=<div style={{display:'flex',alignSelf:'flex-start',padding:'12px 24px',borderRadius:999,background:c.secondaryColor,color:onSecondary,fontSize:28,fontWeight:700}}>{c.service}</div>;
 const badge=(size:number)=><div style={{display:'flex',padding:18,borderRadius:22,background:'#ffffff',boxShadow:'0 8px 24px rgba(0,0,0,.25)'}}><Logo src={logo} size={size} clientName={c.clientName} color={c.primaryColor}/></div>;
 const footer=c.contactLine??c.clientName;
 const f=PHOTO_FRAMES[c.template];
 if(c.template==='bandeau')return <div style={{display:'flex',flexDirection:'column',width:'100%',height:'100%',background:c.primaryColor,color:onPrimary,fontFamily}}>
  <div style={{display:'flex',position:'relative',width:f.width,height:f.height}}><img src={photo} alt="" width={f.width} height={f.height} style={{width:f.width,height:f.height}}/>
   <div style={{display:'flex',position:'absolute',top:40,left:40}}>{badge(120)}</div></div>
  <div style={{display:'flex',flexDirection:'column',justifyContent:'center',flexGrow:1,padding:'0 70px',gap:22}}>{tag}<div style={{display:'flex',...title}}>{c.headline}</div>
   {c.subline&&<div style={{display:'flex',fontSize:34,lineHeight:1.3,opacity:.92}}>{c.subline}</div>}</div>
  <div style={{display:'flex',justifyContent:'center',padding:'22px 0',background:c.secondaryColor,color:onSecondary,fontSize:30,fontWeight:600}}>{footer}</div></div>;
 if(c.template==='diagonale')return <div style={{display:'flex',width:'100%',height:'100%',position:'relative',fontFamily,color:onPrimary}}>
  <img src={photo} alt="" width={f.width} height={f.height} style={{position:'absolute',top:0,left:0,width:f.width,height:f.height}}/>
  <div style={{display:'flex',position:'absolute',top:0,left:0,width:1080,height:1350,backgroundImage:`linear-gradient(180deg, ${hexA(c.primaryColor,0)} 36%, ${hexA(c.primaryColor,.8)} 62%, ${hexA(c.primaryColor,.97)} 100%)`}}/>
  <div style={{display:'flex',flexDirection:'column',position:'absolute',top:0,left:0,width:1080,height:1350,padding:'56px 70px 70px'}}>
   <div style={{display:'flex'}}>{badge(130)}</div>
   <div style={{display:'flex',flexDirection:'column',justifyContent:'flex-end',flexGrow:1,gap:24}}>{tag}<div style={{display:'flex',...title,fontSize:title.fontSize+6}}>{c.headline}</div>
    {c.subline&&<div style={{display:'flex',fontSize:36,lineHeight:1.3,opacity:.95}}>{c.subline}</div>}
    <div style={{display:'flex',marginTop:16,paddingTop:22,borderTop:`4px solid ${c.secondaryColor}`,fontSize:30,fontWeight:600}}>{footer}</div></div></div></div>;
 if(c.template==='encadre')return <div style={{display:'flex',flexDirection:'column',width:'100%',height:'100%',background:c.secondaryColor,padding:56,fontFamily}}>
  <div style={{display:'flex',position:'relative',width:f.width,height:f.height,borderRadius:'32px 32px 0 0',overflow:'hidden'}}><img src={photo} alt="" width={f.width} height={f.height} style={{width:f.width,height:f.height}}/>
   <div style={{display:'flex',position:'absolute',top:28,left:28}}>{badge(110)}</div></div>
  <div style={{display:'flex',flexDirection:'column',flexGrow:1,background:c.primaryColor,color:onPrimary,borderRadius:'0 0 32px 32px',padding:'40px 60px',gap:20,justifyContent:'center'}}>
   <div style={{display:'flex',...title}}>{c.headline}</div>{c.subline&&<div style={{display:'flex',fontSize:32,lineHeight:1.3,opacity:.92}}>{c.subline}</div>}
   <div style={{display:'flex',fontSize:28,fontWeight:600,opacity:.9}}>{footer}</div></div></div>;
 return <div style={{display:'flex',flexDirection:'column',width:'100%',height:'100%',background:'#ffffff',color:'#111827',fontFamily,padding:'60px 80px 0'}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',height:120}}><Logo src={logo} size={110} clientName={c.clientName} color={c.primaryColor}/>
   <div style={{display:'flex',padding:'10px 22px',borderRadius:999,background:c.primaryColor,color:c.textColor,fontSize:26,fontWeight:700}}>{c.service}</div></div>
  <div style={{display:'flex',width:f.width,height:f.height,borderRadius:28,overflow:'hidden',marginTop:24}}><img src={photo} alt="" width={f.width} height={f.height} style={{width:f.width,height:f.height}}/></div>
  <div style={{display:'flex',flexDirection:'column',justifyContent:'center',flexGrow:1,gap:16}}>
   <div style={{display:'flex',...title,fontSize:title.fontSize-6,color:c.primaryColor}}>{c.headline}</div>{c.subline&&<div style={{display:'flex',fontSize:32,lineHeight:1.3,color:'#374151'}}>{c.subline}</div>}</div>
  <div style={{display:'flex',margin:'0 -80px',padding:'26px 80px',background:c.primaryColor,color:c.textColor,fontSize:30,fontWeight:600}}>{footer}</div></div>;
}
function layout(c:VisualContent,logo:LogoImage|null,fontFamily:string){
 const onPrimary=c.textColor,onSecondary=readableOn(c.secondaryColor),title={fontSize:c.headline.length>40?78:92,fontWeight:700,lineHeight:1.08,letterSpacing:-1};
 const tag=<div style={{display:'flex',alignSelf:'flex-start',padding:'14px 26px',borderRadius:999,background:c.secondaryColor,color:onSecondary,fontSize:32,fontWeight:700}}>{c.service}</div>;
 const contact=c.contactLine?<div style={{display:'flex',fontSize:36,fontWeight:600}}>{c.contactLine}</div>:null;
 if(c.template==='bandeau')return <div style={{display:'flex',flexDirection:'column',width:'100%',height:'100%',background:c.primaryColor,color:onPrimary,fontFamily}}>
  <div style={{display:'flex',justifyContent:'center',alignItems:'center',height:300,background:'#ffffff'}}><Logo src={logo} size={240} clientName={c.clientName} color={c.primaryColor}/></div>
  <div style={{display:'flex',flexDirection:'column',justifyContent:'center',flexGrow:1,padding:'0 90px',gap:36}}>{tag}<div style={{display:'flex',...title}}>{c.headline}</div>
   {c.subline&&<div style={{display:'flex',fontSize:40,lineHeight:1.3,opacity:.9}}>{c.subline}</div>}</div>
  <div style={{display:'flex',justifyContent:'center',padding:'34px 0',background:c.secondaryColor,color:onSecondary}}>{contact??<div style={{display:'flex',fontSize:34,fontWeight:600}}>{c.clientName}</div>}</div></div>;
 if(c.template==='diagonale')return <div style={{display:'flex',flexDirection:'column',width:'100%',height:'100%',background:c.primaryColor,color:onPrimary,fontFamily,position:'relative'}}>
  <div style={{display:'flex',position:'absolute',top:-260,right:-260,width:760,height:760,borderRadius:380,background:c.secondaryColor,opacity:.9}}/>
  <div style={{display:'flex',position:'absolute',bottom:-180,left:-180,width:420,height:420,borderRadius:210,border:`28px solid ${c.secondaryColor}`,opacity:.5}}/>
  <div style={{display:'flex',padding:'80px 90px 0',height:280}}><div style={{display:'flex',padding:24,borderRadius:28,background:'#ffffff'}}><Logo src={logo} size={190} clientName={c.clientName} color={c.primaryColor}/></div></div>
  <div style={{display:'flex',flexDirection:'column',justifyContent:'center',flexGrow:1,padding:'0 90px',gap:36}}>{tag}<div style={{display:'flex',...title}}>{c.headline}</div>
   {c.subline&&<div style={{display:'flex',fontSize:40,lineHeight:1.3,opacity:.9}}>{c.subline}</div>}</div>
  <div style={{display:'flex',padding:'0 90px 80px'}}>{contact}</div></div>;
 if(c.template==='encadre')return <div style={{display:'flex',width:'100%',height:'100%',background:c.secondaryColor,padding:56,fontFamily}}>
  <div style={{display:'flex',flexDirection:'column',flexGrow:1,background:c.primaryColor,color:onPrimary,borderRadius:36,padding:'70px 80px',gap:40}}>
   <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div style={{display:'flex',padding:20,borderRadius:24,background:'#ffffff'}}><Logo src={logo} size={170} clientName={c.clientName} color={c.primaryColor}/></div></div>
   <div style={{display:'flex',flexDirection:'column',justifyContent:'center',flexGrow:1,gap:34}}>{tag}<div style={{display:'flex',...title}}>{c.headline}</div>
    {c.subline&&<div style={{display:'flex',fontSize:40,lineHeight:1.3,opacity:.9}}>{c.subline}</div>}</div>
   <div style={{display:'flex',borderTop:`4px solid ${c.secondaryColor}`,paddingTop:34}}>{contact??<div style={{display:'flex',fontSize:34,fontWeight:600}}>{c.clientName}</div>}</div></div></div>;
 return <div style={{display:'flex',flexDirection:'column',width:'100%',height:'100%',background:'#ffffff',color:'#111827',fontFamily}}>
  <div style={{display:'flex',height:24,background:c.secondaryColor}}/>
  <div style={{display:'flex',padding:'70px 90px 0'}}><Logo src={logo} size={220} clientName={c.clientName} color={c.primaryColor}/></div>
  <div style={{display:'flex',flexDirection:'column',justifyContent:'center',flexGrow:1,padding:'0 90px',gap:36}}>
   <div style={{display:'flex',alignSelf:'flex-start',padding:'14px 26px',borderRadius:999,background:c.primaryColor,color:c.textColor,fontSize:32,fontWeight:700}}>{c.service}</div>
   <div style={{display:'flex',...title,color:c.primaryColor}}>{c.headline}</div>{c.subline&&<div style={{display:'flex',fontSize:40,lineHeight:1.3,color:'#374151'}}>{c.subline}</div>}</div>
  <div style={{display:'flex',padding:'40px 90px',background:c.primaryColor,color:c.textColor}}>{contact??<div style={{display:'flex',fontSize:34,fontWeight:600}}>{c.clientName}</div>}</div></div>;
}
// Police Inter (normal et gras) chargée une fois par instance ; en cas d'échec, police par défaut du moteur de rendu.
type Font={name:string;data:ArrayBuffer;weight:400|700;style:'normal'};
let fonts:Promise<Font[]>|null=null;
function loadFonts():Promise<Font[]>{
 fonts??=Promise.all(([400,700] as const).map(async weight=>{
  const r=await fetch(`https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-${weight}-normal.woff`,{signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('font');return {name:'Inter',data:await r.arrayBuffer(),weight,style:'normal' as const};
 })).catch(()=>{fonts=null;return [];});
 return fonts;
}
/** PNG 1080 × 1350 du visuel. */
export async function renderVisual(c:VisualContent):Promise<Uint8Array>{
 const frame=PHOTO_FRAMES[c.template];
 const [logo,loaded,photo]=await Promise.all([logoDataUrl(c.logo),loadFonts(),photoBox(c.photo,frame.width,frame.height)]);
 const family=loaded.length?'Inter':'sans-serif';
 const response=new ImageResponse(photo?photoLayout(c,logo,photo,family):layout(c,logo,family),{width:VISUAL_WIDTH,height:VISUAL_HEIGHT,...(loaded.length?{fonts:loaded}:{})});
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length<1000)throw Error('Visual render failed');
 return bytes;
}
