// Réglages TikTok choisis à la validation (règles « Direct Post » de TikTok). Pur, utilisable côté client et serveur.
export const TIKTOK_PRIVACY_LEVELS=['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY'] as const;
export type TikTokPrivacyLevel=typeof TIKTOK_PRIVACY_LEVELS[number];
export const TIKTOK_PRIVACY_LABELS:Record<TikTokPrivacyLevel,string>={PUBLIC_TO_EVERYONE:'Tout le monde',MUTUAL_FOLLOW_FRIENDS:'Amis',FOLLOWER_OF_CREATOR:'Abonnés',SELF_ONLY:'Moi uniquement'};
export type TikTokSettings={privacyLevel:TikTokPrivacyLevel;allowComment:boolean;brandOrganic:boolean;brandContent:boolean};
export type TikTokCreatorInfo={nickname:string;username:string|null;avatarUrl:string|null;privacyOptions:TikTokPrivacyLevel[];commentDisabled:boolean};
export const TIKTOK_FIELD={privacy:'tiktok_privacy',comment:'tiktok_allow_comment',commercial:'tiktok_commercial',organic:'tiktok_brand_organic',branded:'tiktok_brand_content',consent:'tiktok_consent'} as const;
export function isTikTokPrivacy(v:unknown):v is TikTokPrivacyLevel{return typeof v==='string'&&(TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(v);}
/** Lecture stricte des champs du formulaire de validation (suffixe pour une validation groupée). */
export function parseTikTokSettings(form:FormData,suffix=''):{ok:true;settings:TikTokSettings}|{ok:false;message:string}{
 const get=(k:string)=>form.get(k+suffix);
 const privacy=get(TIKTOK_FIELD.privacy);
 if(!isTikTokPrivacy(privacy))return {ok:false,message:'TikTok : choisissez qui peut voir la publication.'};
 const commercial=get(TIKTOK_FIELD.commercial)==='on',brandOrganic=commercial&&get(TIKTOK_FIELD.organic)==='on',brandContent=commercial&&get(TIKTOK_FIELD.branded)==='on';
 if(commercial&&!brandOrganic&&!brandContent)return {ok:false,message:'TikTok : indiquez si le contenu fait la promotion de votre marque, d’un tiers, ou des deux.'};
 if(brandContent&&privacy==='SELF_ONLY')return {ok:false,message:'TikTok : un contenu de marque ne peut pas être privé.'};
 if(get(TIKTOK_FIELD.consent)!=='on')return {ok:false,message:'TikTok : confirmez votre accord avec les conditions de publication TikTok.'};
 return {ok:true,settings:{privacyLevel:privacy,allowComment:get(TIKTOK_FIELD.comment)==='on',brandOrganic,brandContent}};
}
/** Copie les champs TikTok d'un formulaire vers un autre (suffixe source → noms simples). */
export function copyTikTokFields(from:FormData,to:FormData,suffix=''){
 for(const key of Object.values(TIKTOK_FIELD)){const v=from.get(key+suffix);if(typeof v==='string')to.set(key,v);}
}
/** Étiquette et texte de consentement selon la divulgation commerciale (formulations imposées par TikTok). */
export function tiktokDisclosure(brandOrganic:boolean,brandContent:boolean):{label:string|null;consent:'music'|'branded'}{
 if(brandContent)return {label:'Votre photo sera étiquetée « Partenariat rémunéré ».',consent:'branded'};
 if(brandOrganic)return {label:'Votre photo sera étiquetée « Contenu promotionnel ».',consent:'music'};
 return {label:null,consent:'music'};
}
