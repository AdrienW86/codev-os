/* eslint-disable @next/next/no-img-element -- Avatar TikTok servi par TikTok (URL signée de courte durée). */
'use client';
import {useEffect,useState} from 'react';
import {tiktokCreatorInfoAction} from '@/app/(cockpit)/publications/tiktok-actions';
import {TIKTOK_BRANDED_URL,TIKTOK_MUSIC_URL} from '@/lib/tiktok-legal-links';
import {TIKTOK_FIELD,TIKTOK_PRIVACY_LABELS,tiktokDisclosure,type TikTokCreatorInfo,type TikTokPrivacyLevel} from '@/lib/publications/tiktok-settings';

// Réglages exigés par TikTok avant toute publication directe : compte qui publiera (lu à l'affichage), confidentialité
// choisie sans valeur par défaut, commentaires décochés par défaut, divulgation commerciale désactivée par défaut,
// déclaration de consentement juste avant le bouton. Les champs sont envoyés avec le formulaire de validation.
type Load={state:'loading'}|{state:'error';message:string}|{state:'ready';info:TikTokCreatorInfo};
const blocker='absolute h-px w-px overflow-hidden opacity-0';
export function TikTokPostSettings({publicationId,suffix=''}:{publicationId:string;suffix?:string}){
 const [load,setLoad]=useState<Load>({state:'loading'});
 const [privacy,setPrivacy]=useState<TikTokPrivacyLevel|''>('');
 const [commercial,setCommercial]=useState(false),[organic,setOrganic]=useState(false),[branded,setBranded]=useState(false);
 useEffect(()=>{let live=true;tiktokCreatorInfoAction(publicationId).then(r=>{if(live)setLoad(r.ok?{state:'ready',info:r.info}:{state:'error',message:r.message});})
  .catch(()=>{if(live)setLoad({state:'error',message:'Compte TikTok indisponible.'});});return ()=>{live=false;};},[publicationId]);
 const name=(k:string)=>k+suffix;
 if(load.state!=='ready')return <div className="relative rounded-lg border border-border p-3 text-sm" data-tiktok-settings={load.state}>
  <p className={load.state==='error'?'text-danger':'text-muted'}>{load.state==='error'?load.message:'Chargement du compte TikTok…'}</p>
  <input required aria-hidden="true" tabIndex={-1} className={blocker} value="" onChange={()=>{}} title="Compte TikTok indisponible : publication impossible pour le moment."/></div>;
 const info=load.info,disclosure=tiktokDisclosure(commercial&&organic,commercial&&branded),incomplete=commercial&&!organic&&!branded;
 return <fieldset className="relative space-y-3 rounded-lg border border-border p-3 text-sm" data-tiktok-settings="ready">
  <legend className="px-1 font-semibold">Publication TikTok</legend>
  <p className="flex items-center gap-2">{info.avatarUrl&&<img src={info.avatarUrl} alt="" className="h-7 w-7 rounded-full"/>}
   <span>Publié sur le compte <strong>{info.nickname}</strong>{info.username?<span className="text-muted"> (@{info.username})</span>:null}</span></p>
  <label className="block">Qui peut voir cette publication ?
   <select required name={name(TIKTOK_FIELD.privacy)} value={privacy} onChange={e=>setPrivacy(e.target.value as TikTokPrivacyLevel|'')} className="mt-1 block w-full rounded-lg border border-border bg-background p-2">
    <option value="" disabled>Choisir…</option>
    {info.privacyOptions.map(o=><option key={o} value={o} disabled={o==='SELF_ONLY'&&commercial&&branded} title={o==='SELF_ONLY'&&commercial&&branded?'Un contenu de marque ne peut pas être privé.':undefined}>{TIKTOK_PRIVACY_LABELS[o]}</option>)}
   </select></label>
  <label className={`flex items-center gap-2 ${info.commentDisabled?'text-muted':''}`}><input type="checkbox" name={name(TIKTOK_FIELD.comment)} disabled={info.commentDisabled}/>Autoriser les commentaires{info.commentDisabled?' (désactivés dans les réglages du compte)':''}</label>
  <div className="space-y-2 rounded-lg border border-border p-2">
   <label className="flex items-center justify-between gap-2"><span>Divulguer un contenu commercial</span>
    <input type="checkbox" role="switch" name={name(TIKTOK_FIELD.commercial)} checked={commercial} onChange={e=>{setCommercial(e.target.checked);if(!e.target.checked){setOrganic(false);setBranded(false);}}}/></label>
   <p className="text-xs text-muted">Indiquez si cette publication fait la promotion de vous-même, d’un tiers, ou des deux.</p>
   {commercial&&<div className="space-y-1">
    <label className="flex items-center gap-2"><input type="checkbox" name={name(TIKTOK_FIELD.organic)} checked={organic} onChange={e=>setOrganic(e.target.checked)}/>Votre marque</label>
    <label className="flex items-center gap-2" title={privacy==='SELF_ONLY'?'Un contenu de marque ne peut pas être privé.':undefined}>
     <input type="checkbox" name={name(TIKTOK_FIELD.branded)} checked={branded} disabled={privacy==='SELF_ONLY'} onChange={e=>setBranded(e.target.checked)}/>Contenu de marque</label>
    {privacy==='SELF_ONLY'&&<p className="text-xs text-muted">Un contenu de marque ne peut pas être privé : choisissez une autre visibilité pour le cocher.</p>}
    {disclosure.label&&<p className="text-xs">{disclosure.label}</p>}
    {incomplete&&<p className="text-xs text-danger">Vous devez indiquer si le contenu fait la promotion de vous-même, d’un tiers, ou des deux.</p>}
   </div>}
  </div>
  {incomplete&&<input required aria-hidden="true" tabIndex={-1} className={blocker} value="" onChange={()=>{}} title="Vous devez indiquer si le contenu fait la promotion de vous-même, d’un tiers, ou des deux."/>}
  <label className="flex items-start gap-2"><input type="checkbox" required name={name(TIKTOK_FIELD.consent)} className="mt-1"/>
   <span>{disclosure.consent==='branded'
    ?<>En publiant, vous acceptez la <a href={TIKTOK_BRANDED_URL} target="_blank" rel="noreferrer" className="underline">politique relative au contenu de marque</a> et la <a href={TIKTOK_MUSIC_URL} target="_blank" rel="noreferrer" className="underline">Music Usage Confirmation</a> de TikTok.</>
    :<>En publiant, vous acceptez la <a href={TIKTOK_MUSIC_URL} target="_blank" rel="noreferrer" className="underline">Music Usage Confirmation</a> de TikTok.</>}</span></label>
  <p className="text-xs text-muted">Après l’envoi à l’heure prévue, TikTok peut mettre quelques minutes à traiter la publication avant qu’elle apparaisse sur le profil. Son état est suivi dans CODE-V OS.</p>
 </fieldset>;
}
