/* eslint-disable @next/next/no-img-element -- Private signed URLs are short-lived and must not be cached by an image proxy. */
// Aperçu d'un média de publication : vidéo motion design (stockage privé des vidéos) ou photo. L'URL est une URL
// signée courte du stockage ; le type se lit dans son chemin (le compartiment des vidéos est distinct).
export function isVideoPreview(url:string|null|undefined):boolean{return typeof url==="string"&&url.includes("/publication-videos/");}
export function MediaPreview({src,alt,className}:{src:string;alt:string;className?:string}){
 if(isVideoPreview(src))return <video src={src} controls playsInline muted preload="metadata" aria-label="Vidéo motion design de la publication" className={`${className??""} bg-black`}/>;
 return <img src={src} alt={alt} className={className}/>;
}
