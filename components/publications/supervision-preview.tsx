/* eslint-disable @next/next/no-img-element -- Private signed URLs are short-lived and must not be cached by an image proxy. */
import type {SupervisionVariant} from '@/lib/publications/supervision-review';

// Socle Publications, lot 7 (mobile) : aperçu d'une variante telle qu'elle apparaîtra sur sa plateforme (Facebook,
// Instagram, Google Business Profile). Rendu indicatif, jetons de design uniquement ; la photo est l'URL signée courte
// de la variante. Composant sans état : utilisable côté serveur et dans la carte de validation.
function Photo({variant,className}:{variant:SupervisionVariant;className:string}){
 if(variant.media.preview)return <img src={variant.media.preview} alt={`Photo de la variante ${variant.label}`} className={`w-full bg-surface-sunken object-cover ${className}`}/>;
 const text=variant.media.state==='missing'?'Photo manquante : validation impossible':'Photo indisponible (aperçu expiré ou illisible)';
 return <div role="img" aria-label={text} data-media-missing={variant.media.state} className={`flex w-full items-center justify-center border border-dashed border-warning/60 bg-warning/10 p-3 text-center text-xs text-warning ${className}`}>{text}</div>;
}
const Avatar=({name}:{name:string})=><span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-strong text-xs font-semibold text-accent-foreground">{name.trim().charAt(0).toUpperCase()||'?'}</span>;

export function VariantPreview({variant,accountName}:{variant:SupervisionVariant;accountName:string}){
 if(variant.platform==='instagram')return <figure className="overflow-hidden rounded-xl border border-border bg-surface" data-preview="instagram">
  <figcaption className="flex items-center gap-2 p-2.5"><Avatar name={accountName}/><span className="truncate text-sm font-semibold">{accountName}</span></figcaption>
  <Photo variant={variant} className="aspect-square"/>
  <p className="p-3 text-sm break-words whitespace-pre-wrap"><span className="font-semibold">{accountName}</span> {variant.text}</p></figure>;
 if(variant.platform==='tiktok')return <figure className="relative overflow-hidden rounded-xl border border-border bg-black text-white" data-preview="tiktok">
  <Photo variant={variant} className="aspect-[9/16] object-contain"/>
  <figcaption className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/85 to-transparent p-3 text-sm"><span className="block font-semibold">{accountName}</span>
   <span className="block line-clamp-4 break-words whitespace-pre-wrap">{variant.text}</span></figcaption></figure>;
 if(variant.platform==='google_business_profile')return <figure className="overflow-hidden rounded-xl border border-border bg-surface" data-preview="google_business_profile">
  <figcaption className="flex items-center gap-2 p-2.5"><Avatar name={accountName}/><span className="min-w-0"><span className="block truncate text-sm font-semibold">{accountName}</span><span className="block text-xs text-muted">Fiche Google · Nouveauté</span></span></figcaption>
  <Photo variant={variant} className="aspect-[4/3]"/>
  <div className="space-y-2 p-3 text-sm">{variant.title&&<p className="font-semibold">{variant.title}</p>}<p className="break-words whitespace-pre-wrap">{variant.text}</p>
   {variant.cta&&<p><span className="inline-block rounded-full border border-accent px-3 py-1 text-xs font-medium text-accent">{variant.cta}</span></p>}</div></figure>;
 return <figure className="overflow-hidden rounded-xl border border-border bg-surface" data-preview={variant.platform}>
  <figcaption className="flex items-center gap-2 p-2.5"><Avatar name={accountName}/><span className="min-w-0"><span className="block truncate text-sm font-semibold">{accountName}</span><span className="block text-xs text-muted">Publication · Public</span></span></figcaption>
  <div className="space-y-2 px-3 pb-3 text-sm">{variant.title&&<p className="font-semibold">{variant.title}</p>}<p className="break-words whitespace-pre-wrap">{variant.text}</p>
   {variant.cta&&<p className="rounded-lg border border-border p-2 text-xs"><span className="text-muted">Bouton · </span>{variant.cta}</p>}</div>
  <Photo variant={variant} className="max-h-96"/></figure>;
}
