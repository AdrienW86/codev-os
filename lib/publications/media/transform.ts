import 'server-only';
import sharp from 'sharp';
import type {PublicationPlatform} from '../types';
// Format d'origine conservé quand le réseau l'accepte (avant : carré 1080 × 1080 pour tous, avec bords flous).
// Rapport largeur / hauteur accepté par réseau : Instagram 4:5 à 1,91:1 (le 4:5 portrait occupe le plus de place dans
// le fil), Facebook et Google idem par prudence, TikTok et Snapchat jusqu'au 9:16 vertical. La largeur est ramenée à
// 1080 px (TikTok refuse plus grand) ; une photo hors de la plage est ramenée au rapport autorisé le plus proche, la
// photo entière centrée sur la même photo agrandie et floutée (jamais de bandes blanches ni de rognage d'un chantier).
export const OUTPUT_WIDTH=1080;
export const PLATFORM_RATIOS:Record<PublicationPlatform,{min:number;max:number}>={instagram:{min:4/5,max:1.91},facebook:{min:4/5,max:1.91},
 google_business_profile:{min:4/5,max:1.91},tiktok:{min:9/16,max:1.91},snapchat:{min:9/16,max:1.91}};
const MAX_DERIVATIVE_BYTES=786432;
/** Dimensions de sortie : largeur 1080, hauteur selon le rapport d'origine ramené dans la plage du réseau. */
export function outputSize(width:number,height:number,platform:PublicationPlatform):{width:number;height:number}{
 const range=PLATFORM_RATIOS[platform]??{min:1,max:1},ratio=Math.min(Math.max(width/height,range.min),range.max);
 return {width:OUTPUT_WIDTH,height:Math.round(OUTPUT_WIDTH/ratio)};
}
export async function adaptImage(bytes:Uint8Array,platform:PublicationPlatform){
 if(bytes.length>8388608)throw Error('Image too large');
 const input=sharp(bytes,{limitInputPixels:24000000,animated:false,failOn:'warning'}).rotate();
 const metadata=await input.metadata();
 if(!metadata.width||!metadata.height||metadata.pages&&metadata.pages>1||!['jpeg','png','webp'].includes(metadata.format??''))throw Error('Unsupported image');
 const upright=await input.flatten({background:'#ffffff'}).toBuffer(),info=await sharp(upright).metadata();
 const {width,height}=outputSize(info.width??metadata.width,info.height??metadata.height,platform);
 const backdrop=await sharp(upright).resize(width,height,{fit:'cover'}).blur(40).modulate({brightness:.85}).toBuffer();
 const photo=await sharp(upright).resize(width,height,{fit:'inside',withoutEnlargement:false}).toBuffer();
 const framed=await sharp(backdrop).composite([{input:photo,gravity:'center'}]).toBuffer();
 // Qualité réduite par paliers pour rester ≤ 768 Ko (une photo verticale 1080 × 1920 est plus lourde qu'un carré).
 for(const quality of [82,74,66,58,50]){const output=await sharp(framed).jpeg({quality}).toBuffer();
  if(output.length<=MAX_DERIVATIVE_BYTES)return {bytes:new Uint8Array(output),width,height,mime_type:'image/jpeg' as const};}
 throw Error('Derivative too large');
}
export async function visionPreview(bytes:Uint8Array){if(bytes.length>8388608)throw Error('Image too large');const input=sharp(bytes,{limitInputPixels:24000000,animated:false,failOn:'warning'});const metadata=await input.metadata();if(!['jpeg','png','webp'].includes(metadata.format??'')||metadata.pages&&metadata.pages>1)throw Error('Unsupported image');return input.rotate().resize(1280,1280,{fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();}
// Image ajoutée à la main : convertie en JPEG (Instagram et TikTok refusent le PNG) et ramenée à 1080 px de large au
// plus (TikTok refuse une photo plus grande : « picture_size_check_failed »), sans recadrage ni agrandissement ;
// transparence aplatie sur fond blanc. Qualité réduite au besoin pour rester ≤ 768 Ko.
export const MANUAL_MAX_WIDTH=1080,MANUAL_MAX_HEIGHT=1920;
export async function toPublishableJpeg(bytes:Uint8Array):Promise<{bytes:Uint8Array;mime_type:'image/jpeg'}>{
 const input=sharp(bytes,{limitInputPixels:24000000,animated:false,failOn:'warning'}).rotate();
 const metadata=await input.metadata();
 if(!metadata.width||!metadata.height||metadata.pages&&metadata.pages>1||!['jpeg','png','webp'].includes(metadata.format??''))throw Error('Unsupported image');
 const [w,h]=(metadata.orientation??1)>=5?[metadata.height,metadata.width]:[metadata.width,metadata.height];
 if(metadata.format==='jpeg'&&w<=MANUAL_MAX_WIDTH&&h<=MANUAL_MAX_HEIGHT&&(metadata.orientation??1)===1)return {bytes,mime_type:'image/jpeg'};
 const flat=await input.flatten({background:'#ffffff'}).resize(MANUAL_MAX_WIDTH,MANUAL_MAX_HEIGHT,{fit:'inside',withoutEnlargement:true}).toBuffer();
 for(const quality of [90,82,72,60]){
  const out=await sharp(flat).jpeg({quality}).toBuffer();
  if(out.length<=786432)return {bytes:new Uint8Array(out),mime_type:'image/jpeg'};
 }
 throw Error('Derivative too large');
}
