import 'server-only';
import {ImageResponse} from 'next/og';
import sharp from 'sharp';
import {VISUAL_HEIGHT,VISUAL_WIDTH,fitLogo,readableOn,type VisualTemplate} from './model';

// Rendu d'un visuel à la charte (1080 × 1350, portrait 4:5 : le format le plus visible sur Instagram et Facebook).
// Mise en page simple et lisible : logo exact du client, couleurs de la charte, prestation, accroche, ligne de contact.
// Aucun texte n'est inventé ici : tout vient des réglages du client et de l'accroche déjà contrôlée.
export type VisualContent={template:VisualTemplate;service:string;headline:string;subline:string|null;contactLine:string|null;clientName:string;
 primaryColor:string;secondaryColor:string;textColor:string;logo:Uint8Array|null};

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
 const [logo,loaded]=await Promise.all([logoDataUrl(c.logo),loadFonts()]);
 const response=new ImageResponse(layout(c,logo,loaded.length?'Inter':'sans-serif'),{width:VISUAL_WIDTH,height:VISUAL_HEIGHT,...(loaded.length?{fonts:loaded}:{})});
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length<1000)throw Error('Visual render failed');
 return bytes;
}
