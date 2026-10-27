import type {NextRequest} from "next/server";
import {resolveMediaLink} from "@/lib/integrations/publications-media-link";

// Image de diffusion servie depuis le domaine de CODE-V OS (domaine vérifié chez TikTok). Public (TikTok récupère
// l'image sans session) mais limité à un jeton signé et daté ; n'importe quelle autre requête reçoit un 404.
// Fichier de vérification de propriété TikTok (méthode « fichier ») : nom et contenu fournis par TikTok, en variables.
const MAX=8*1024*1024;
export async function GET(_request:NextRequest,{params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 const verifyName=process.env.TIKTOK_VERIFICATION_FILE,verifyContent=process.env.TIKTOK_VERIFICATION_CONTENT;
 if(verifyName&&verifyContent&&token===verifyName)return new Response(verifyContent,{headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
 const source=resolveMediaLink(token);
 if(!source)return new Response("Introuvable",{status:404,headers:{"Cache-Control":"no-store"}});
 let upstream:Response;
 try{upstream=await fetch(source,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});}
 catch{return new Response("Indisponible",{status:502,headers:{"Cache-Control":"no-store"}});}
 const type=upstream.headers.get("content-type")??"";
 if(!upstream.ok||!/^image\/(jpeg|webp)$/.test(type.split(";")[0].trim()))return new Response("Introuvable",{status:404,headers:{"Cache-Control":"no-store"}});
 const bytes=await upstream.arrayBuffer();
 if(bytes.byteLength>MAX)return new Response("Trop volumineux",{status:413,headers:{"Cache-Control":"no-store"}});
 return new Response(bytes,{headers:{"Content-Type":type.split(";")[0].trim(),"Content-Length":String(bytes.byteLength),"Cache-Control":"private, max-age=300","X-Content-Type-Options":"nosniff"}});
}
