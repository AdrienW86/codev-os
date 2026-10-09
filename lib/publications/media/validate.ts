import {createHash} from 'node:crypto';
import {imageMime} from '../editor';

// Binary validation of a client source image before any transformation or upload (Lot 4.3 P8). Reuses the
// workspace signature sniffing (JPEG, PNG, WebP) and the Drive size limit. Real decoding is done afterwards by
// adaptImage (sharp, failOn warning): truncated or fake content is refused there. No OCR, no AI analysis.
export const MAX_SOURCE_IMAGE_BYTES=8388608;
export type SourceImageCheck={ok:true;mimeType:'image/jpeg'|'image/png'|'image/webp';sha256:string;size:number}|{ok:false;reason:'empty'|'too_large'|'unsupported_type'|'mime_mismatch'};
export function checkSourceImage(bytes:unknown,declaredMime:string):SourceImageCheck{
 if(!(bytes instanceof Uint8Array)||bytes.length===0)return {ok:false,reason:'empty'};
 if(bytes.length>MAX_SOURCE_IMAGE_BYTES)return {ok:false,reason:'too_large'};
 const sniffed=imageMime(bytes);if(!sniffed)return {ok:false,reason:'unsupported_type'};
 if(sniffed!==declaredMime)return {ok:false,reason:'mime_mismatch'};
 return {ok:true,mimeType:sniffed,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
}
