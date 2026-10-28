import 'server-only';
import sharp from 'sharp';
import type {PublicationPlatform} from '../types';
// Format unique carré 1080 × 1080 pour tous les réseaux : accepté tel quel par Instagram (1:1, sans rognage du
// fil), Facebook et Google Business Profile (≥ 250 px, 720 px recommandés). La photo entière est conservée (aucun
// rognage d'un chantier) et centrée ; l'espace restant est rempli par la même photo agrandie et floutée, plutôt que
// par des bandes blanches. Une photo déjà carrée remplit simplement le cadre.
export const SQUARE_SIZE=1080;
export async function adaptImage(bytes:Uint8Array,platform:PublicationPlatform){
 void platform; // même carré pour chaque réseau ; le paramètre reste pour les appelants existants.
 if(bytes.length>8388608)throw Error('Image too large');
 const input=sharp(bytes,{limitInputPixels:24000000,animated:false,failOn:'warning'}).rotate();
 const metadata=await input.metadata();
 if(!metadata.width||!metadata.height||metadata.pages&&metadata.pages>1||!['jpeg','png','webp'].includes(metadata.format??''))throw Error('Unsupported image');
 const size=SQUARE_SIZE,upright=await input.flatten({background:'#ffffff'}).toBuffer();
 const backdrop=await sharp(upright).resize(size,size,{fit:'cover'}).blur(40).modulate({brightness:.85}).toBuffer();
 const photo=await sharp(upright).resize(size,size,{fit:'inside',withoutEnlargement:false}).toBuffer();
 const output=await sharp(backdrop).composite([{input:photo,gravity:'center'}]).jpeg({quality:82}).toBuffer();
 if(output.length>786432)throw Error('Derivative too large');
 return {bytes:new Uint8Array(output),width:size,height:size,mime_type:'image/jpeg' as const};
}
export async function visionPreview(bytes:Uint8Array){if(bytes.length>8388608)throw Error('Image too large');const input=sharp(bytes,{limitInputPixels:24000000,animated:false,failOn:'warning'});const metadata=await input.metadata();if(!['jpeg','png','webp'].includes(metadata.format??'')||metadata.pages&&metadata.pages>1)throw Error('Unsupported image');return input.rotate().resize(640,640,{fit:'inside',withoutEnlargement:true}).jpeg({quality:65}).toBuffer();}
// Image ajoutée à la main : convertie en JPEG (format accepté partout : Instagram et TikTok refusent le PNG), sans
// recadrage ni redimensionnement, transparence aplatie sur fond blanc. Qualité réduite au besoin pour rester ≤ 768 Ko.
export async function toPublishableJpeg(bytes:Uint8Array):Promise<{bytes:Uint8Array;mime_type:'image/jpeg'}>{
 const input=sharp(bytes,{limitInputPixels:24000000,animated:false,failOn:'warning'}).rotate();
 const metadata=await input.metadata();
 if(!metadata.width||!metadata.height||metadata.pages&&metadata.pages>1||!['jpeg','png','webp'].includes(metadata.format??''))throw Error('Unsupported image');
 if(metadata.format==='jpeg')return {bytes,mime_type:'image/jpeg'};
 const flat=await input.flatten({background:'#ffffff'}).toBuffer();
 for(const quality of [90,82,72,60]){
  const out=await sharp(flat).jpeg({quality}).toBuffer();
  if(out.length<=786432)return {bytes:new Uint8Array(out),mime_type:'image/jpeg'};
 }
 throw Error('Derivative too large');
}
