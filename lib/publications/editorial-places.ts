// Intelligence éditoriale (PR #42) — pertinence géographique sans lieu inventé. Pur et déterministe.
// Seuls les lieux explicitement présents dans les données du client (zone géographique de la fiche client, règles et
// consignes saisies par l'équipe, nom du client ou du projet) peuvent être nommés. Tout autre lieu détecté est refusé.
// Détection prudente : un nom propre introduit par une préposition de lieu (« à Perpignan », « sur Narbonne »,
// « dans les Pyrénées-Orientales »), plus une courte liste de régions et grandes villes citées sans préposition.
import {normalizeText} from './editorial-text';

// Zone de la fiche client découpée en lieux (« Perpignan, Narbonne et alentours » → Perpignan, Narbonne). 20 au plus.
export function allowedPlaces(zone:string|null|undefined):string[]{
 if(!zone)return [];
 return [...new Set(zone.split(/[,;/\n()]|\s+et\s+|\s+ou\s+/).map(s=>s.replace(/\b(?:alentours|environs|secteur|région|agglomération|département)\b/gi,'').replace(/\s+/g,' ').trim())
  .filter(s=>s.length>=2&&/^\p{Lu}/u.test(s)))].slice(0,20);
}

const NAME=String.raw`\p{Lu}[\p{L}’'-]*(?:[\s-](?:(?:de|du|des|la|le|les|sur|en|lès|l’|l'|d’|d')\s?)?\p{Lu}[\p{L}’'-]*)*`;
const PLACE_AFTER_PREPOSITION=new RegExp(String.raw`(?<![\p{L}\p{N}])(?:à|au|aux|en|sur|vers|dans|depuis|près de|proche de|autour de|secteur de|région de|ville de|commune de|du côté de|entre)\s+(?:(?:la|le|les|l’|l')\s?)?(${NAME})`,'gu');
// Régions, départements fréquents et grandes villes : détectés même sans préposition (mots entiers).
const KNOWN_PLACES=['Île-de-France','Occitanie','Bretagne','Normandie','Provence','Nouvelle-Aquitaine','Auvergne','Bourgogne','Alsace','Lorraine','Corse','Catalogne','Roussillon','Languedoc',
 'Pyrénées-Orientales','Aude','Hérault','Gard','Ariège','Haute-Garonne','Paris','Marseille','Lyon','Toulouse','Nice','Nantes','Montpellier','Strasbourg','Bordeaux','Lille','Rennes','Reims',
 'Toulon','Grenoble','Dijon','Angers','Nîmes','Perpignan','Narbonne','Béziers','Carcassonne','Barcelone','Argelès-sur-Mer','Canet-en-Roussillon','Saint-Cyprien','Céret','Prades','Rivesaltes'];
// Noms propres qui ne sont pas des lieux (fêtes, mois, jours, plateformes, marques fréquentes).
const NOT_PLACES=new Set(['noel','paques','toussaint','nouvel an','janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre',
 'lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche','facebook','instagram','google','whatsapp','messenger',
 // Canaux numériques (« présents sur Internet », « visible sur le Web »…) : jamais des lieux.
 'internet','web','linkedin','tiktok','youtube','pinterest','snapchat','twitter','x','threads','maps','google maps','google business profile'].map(s=>normalizeText(s)));
// Un nom composé dont le premier mot est un canal numérique (« Google Business Profile », « Internet Explorer ») n'est pas un lieu.
const notPlace=(name:string)=>{const n=normalizeText(name);return NOT_PLACES.has(n)||NOT_PLACES.has(n.split(' ')[0]??'');};

/** Lieux nommés dans un texte (forme d'origine, sans doublon). */
export function placeMentions(text:string):string[]{
 const found:string[]=[];
 for(const m of text.matchAll(PLACE_AFTER_PREPOSITION)){const name=m[1].replace(/[’'-]+$/,'').trim();
  // Sigles (PVC, VMC…) et noms courants exclus.
  if(name.length>1&&name===name.toUpperCase())continue;if(!notPlace(name))found.push(name);}
 const plain=' '+normalizeText(text)+' ';
 for(const place of KNOWN_PLACES)if(plain.includes(' '+normalizeText(place)+' '))found.push(place);
 return [...new Set(found)];
}
/** Lieux du texte absents des faits du client (comparaison sans casse ni accents, mot à mot). */
export function unsupportedPlaces(text:string,facts:string):string[]{
 const known=' '+normalizeText(facts)+' ';
 return placeMentions(text).filter(p=>!known.includes(' '+normalizeText(p)+' '));
}
