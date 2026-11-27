// Brief visuel par client — logique pure (sans I/O ni import). Partagé par l'Agent Visuels (mises en page à la charte)
// et l'Agent Photo (images d'illustration générées). Il rassemble ce que l'on SAIT du client (métier, zone, prestations,
// consignes, charte, description des vraies photos de la photothèque) et une direction artistique propre au métier.
// La direction artistique décrit une ambiance et des sujets d'illustration : ce ne sont jamais des faits sur le client
// (aucune réalisation, aucun lieu précis, aucun chiffre). Rien n'est inventé sur l'entreprise.

export type TradeKey='roofing'|'pest'|'painting'|'beauty'|'digital'|'plumbing'|'electrical'|'carpentry'|'masonry'|'landscaping'|'cleaning'|'generic';

export type TradeDirection={
 key:TradeKey;
 /** Libellé français, pour les écrans et les journaux. */label:string;
 /** Sujets d'illustration crédibles pour ce métier (anglais, pour le générateur d'images). */subjects:string[];
 /** Matériaux, outils et détails concrets qui rendent l'image vraie (anglais). */details:string[];
 /** Ambiance et lumière (anglais). */mood:string;
 /** Ce qu'une image de ce métier ne doit jamais montrer (anglais). */avoid:string[];
 /** Angles d'accroche adaptés au métier (français) : l'Agent Visuels en choisit un différent à chaque visuel. */angles:string[];
};

const TRADES:{key:TradeKey;match:RegExp;direction:Omit<TradeDirection,'key'>}[]=[
 {key:'roofing',match:/couv|toit|toiture|charpent|zingu|goutti|étanch|etanch|démouss|demouss/i,direction:{label:'Couverture et toiture',
  subjects:['close-up of a pitched roof with clean terracotta tiles under a clear sky','roofer’s hands fitting a tile, seen from behind, on a sunny roof','zinc gutter and downpipe detail on a house façade','moss-covered roof tiles next to freshly cleaned tiles (before/after feel on one roof)','roof ridge line with mortar and tiles, photographed at eye level from a scaffold'],
  details:['terracotta canal tiles or flat tiles','zinc flashing','safety harness and scaffold rails if a worker is visible','work gloves','weathered timber battens'],
  mood:'bright natural daylight, crisp shadows, honest craftsmanship, documentary photography',
  avoid:['workers without safety equipment on a roof','damaged or collapsing roofs presented as finished work','skyscrapers or industrial warehouses','snowy alpine chalets unless the area is mountainous'],
  angles:['un signe d’alerte à repérer sur sa toiture','le bon moment de l’année pour cette intervention','ce que l’intervention évite (fuite, infiltration, dégâts)','une question que se posent les propriétaires','un conseil d’entretien simple','le savoir-faire artisanal du geste']}},
 {key:'pest',match:/nuisib|dératis|deratis|désinsect|desinsect|punais|cafard|frelon|guêpe|guepe|rongeur|termite/i,direction:{label:'Lutte anti-nuisibles',
  subjects:['technician in protective clothing inspecting a kitchen skirting board with a torch, seen from behind','discreet bait station placed along a wall in a clean basement','close-up of a gloved hand sealing a small gap around a pipe','clean, bright kitchen after treatment, no insects visible','wasp nest under a roof eave photographed from a distance'],
  details:['professional protective suit and gloves','inspection torch','tamper-resistant bait box','sealant gun','clean tiled floors'],
  mood:'reassuring, clean and professional, cool neutral daylight, no disgust',
  avoid:['dead animals or swarms of insects in close-up','gore or anything disgusting','chemical spray directed at people or food','children or pets near products'],
  angles:['un signe discret d’infestation à ne pas ignorer','pourquoi agir vite plutôt qu’attendre','la prévention au quotidien','une idée reçue à corriger','ce qui rassure pendant une intervention','la saison à risque']}},
 {key:'painting',match:/peint|ravalement|façade|facade|enduit|décor|decor/i,direction:{label:'Peinture et façades',
  subjects:['paint roller applying a fresh coat on an interior wall, warm light','freshly painted house façade with clean window frames','painter’s hands masking a window frame with tape','colour swatches held against a wall','scaffold in front of a façade being renovated'],
  details:['paint roller and tray','masking tape','drop cloths','smooth even finish','façade render texture'],
  mood:'clean, bright, satisfying finish, soft natural light',
  avoid:['paint drips on finished work','messy unfinished rooms presented as results'],
  angles:['le bon moment pour repeindre','ce qu’une façade abîmée laisse passer','un conseil de couleur ou d’entretien','la préparation qui fait la différence','une question fréquente des clients']}},
 {key:'beauty',match:/beaut|esthéti|estheti|institut|onglerie|ongles|spa|massage|coiff|soin/i,direction:{label:'Institut de beauté',
  subjects:['hands receiving a manicure, close-up, soft light','skincare products arranged on a marble tray with a towel','calm treatment room with folded towels and a plant','close-up of a facial treatment from behind the client’s head, face not visible','warm candle-lit relaxation corner'],
  details:['neutral linen towels','glass bottles without labels','wooden and marble textures','green plants'],
  mood:'soft, warm, calm, premium but natural, shallow depth of field',
  avoid:['recognisable faces','overly retouched skin','medical or clinical procedures','brand names on products'],
  angles:['un rituel bien-être de saison','un conseil soin facile à appliquer','le moment pour soi','une question fréquente avant un soin','ce que le soin apporte au quotidien']}},
 {key:'digital',match:/informati|programm|web|site|digital|numérique|numerique|seo|référencement|referencement|logiciel|marketing|\bia\b|automatis/i,direction:{label:'Services numériques',
  subjects:['laptop on a wooden desk showing an abstract website layout (no readable text)','small business owner’s workspace with a phone and a laptop, seen from behind','hands sketching a website wireframe on paper next to a laptop','smartphone held in hand displaying an abstract colourful interface (no readable text)','local shop front at dusk, glass reflections, viewed from the street (no signage readable)'],
  details:['abstract UI blocks without readable text','notebooks and sticky notes without writing','natural wood and plants','soft screen glow'],
  mood:'modern, clean, warm, approachable small-business feel, no cliché robots or binary code',
  avoid:['robots, glowing brains or binary-code clichés','stock-photo handshakes','readable text or fake logos on screens'],
  angles:['un problème concret de TPE que l’outil résout','une erreur fréquente à éviter','un chiffre ou un repère SEULEMENT s’il figure dans les faits','une question qu’un artisan se pose','le gain de temps au quotidien','ce qui change pour les clients du client']}},
 {key:'plumbing',match:/plomb|chauffag|sanitaire|chaudi|clim|pompe à chaleur|pac\b/i,direction:{label:'Plomberie et chauffage',
  subjects:['copper pipes and fittings under a sink, close-up','technician’s hands tightening a fitting with a wrench','modern bathroom with clean fixtures','boiler being serviced, seen from the side'],
  details:['copper and PEX pipes','wrench and toolbox','clean white ceramics'],mood:'clean, precise, reassuring daylight',
  avoid:['flooded rooms presented as results','brand logos on appliances'],
  angles:['un signe de panne à surveiller','un conseil d’entretien de saison','ce que l’intervention évite','une question fréquente']}},
 {key:'electrical',match:/électri|electri|domotique|borne/i,direction:{label:'Électricité',
  subjects:['neatly wired electrical panel, close-up','electrician’s gloved hands testing a socket with a tester','modern lighting in a renovated room'],
  details:['labelled circuit breakers without readable text','insulated tools','cable trays'],mood:'precise, safe, clean light',
  avoid:['exposed live wires presented as normal','sparks or fire'],angles:['un signe d’installation vieillissante','la sécurité du foyer','un conseil simple','une question fréquente']}},
 {key:'carpentry',match:/menuis|ébénist|ebenist|bois|parquet|fenêtr|fenetr|volet/i,direction:{label:'Menuiserie',
  subjects:['carpenter’s hands planing a wooden board, shavings visible','new wooden window frame installed in a stone wall','close-up of wood grain and joinery'],
  details:['hand plane','wood shavings','clamps'],mood:'warm, tactile, workshop light',avoid:['injuries or unsafe tool handling'],angles:['le geste artisanal','un conseil d’entretien du bois','le bon choix de matériau','une question fréquente']}},
 {key:'masonry',match:/maçon|macon|béton|beton|pierre|carrel|terrass/i,direction:{label:'Maçonnerie',
  subjects:['trowel spreading mortar on a stone wall','new paved terrace in sunlight','close-up of a freshly built brick wall'],
  details:['trowel','mortar','stone and brick textures'],mood:'solid, honest, daylight',avoid:['collapsed walls'],angles:['un signe de fissure à surveiller','le bon matériau','un conseil','une question fréquente']}},
 {key:'landscaping',match:/paysag|jardin|élagag|elagag|espaces verts|pelouse/i,direction:{label:'Paysage et jardin',
  subjects:['freshly trimmed hedge in a sunny garden','gardener’s gloved hands planting a shrub','well-kept lawn with a stone path'],
  details:['pruning shears','fresh soil','mediterranean plants if the area is southern'],mood:'green, fresh, natural light',avoid:['dead plants presented as results'],angles:['le geste de saison','un conseil d’entretien','ce qu’un jardin entretenu change','une question fréquente']}},
 {key:'cleaning',match:/nettoy|propret|ménage|menage/i,direction:{label:'Nettoyage',
  subjects:['spotless bright office floor with a cleaning cart in the background','gloved hand wiping a glass surface'],details:['microfibre cloths','clean surfaces'],mood:'bright, fresh, clean',avoid:['dirty spaces presented as results'],angles:['un conseil','ce qui change au quotidien','une question fréquente']}},
];
const GENERIC:Omit<TradeDirection,'key'>={label:'Entreprise locale',subjects:['close-up of a craftsperson’s hands at work, seen from behind','tools of the trade neatly arranged on a workbench','a bright, tidy local business interior'],
 details:['real materials and tools of the trade'],mood:'natural light, honest documentary photography',avoid:['stock-photo clichés','posed handshakes'],
 angles:['un conseil pratique','une question fréquente','ce que la prestation change au quotidien','le savoir-faire']};

/** Métier détecté d'après l'activité, les prestations et le résumé (le premier qui correspond ; sinon générique). */
export function tradeDirection(text:string):TradeDirection{
 for(const trade of TRADES)if(trade.match.test(text))return {key:trade.key,...trade.direction};
 return {key:'generic',...GENERIC};
}

/**
 * Indices régionaux d'ambiance (architecture, lumière), déduits seulement de la zone saisie pour le client. Ce sont des
 * décors plausibles pour une illustration, jamais une adresse ni un lieu reconnaissable.
 */
export function regionalCues(zone:string|null):string[]{
 const z=(zone??'').toLocaleLowerCase('fr');
 if(/perpignan|pyrénées-orientales|pyrenees-orientales|roussillon|catalan|cabestany|narbonne|aude|béziers|beziers|montpellier|hérault|herault|occitanie|nîmes|nimes|gard/.test(z))
  return ['Mediterranean southern France','terracotta canal (Roman) tiles','light rendered walls in warm ochre or white','strong bright sunlight and deep blue sky','occasional plane trees or palm trees, no recognisable landmark'];
 if(/marseille|toulon|nice|var\b|provence|bouches-du-rhône|alpes-maritimes/.test(z))return ['Provence, southern France','terracotta tiles','stone and ochre façades','bright Mediterranean light'];
 if(/lyon|rhône|rhone|villeurbanne|isère|isere|grenoble|ain\b/.test(z))return ['Lyon area, eastern France','mix of terracotta mechanical tiles and urban zinc roofs','pale stone and rendered façades','soft continental daylight'];
 if(/strasbourg|alsace|bas-rhin|haut-rhin|mulhouse|colmar/.test(z))return ['Alsace, north-eastern France','steep roofs with flat beaver-tail tiles','half-timbered or rendered houses','soft daylight'];
 if(/paris|île-de-france|ile-de-france|hauts-de-seine|val-de-marne|seine/.test(z))return ['Paris region','zinc and slate roofs','Haussmann-style or suburban houses','soft grey-blue daylight'];
 if(/bretagne|brest|rennes|nantes|finistère|finistere|morbihan/.test(z))return ['Brittany, western France','natural slate roofs','granite houses','soft oceanic light'];
 if(/bordeaux|gironde|toulouse|haute-garonne/.test(z))return ['South-west France','terracotta canal tiles','pale stone or pink brick façades','warm light'];
 return ['France','typical French houses','natural daylight'];
}

export type BrandPalette={primary:string;secondary:string};
export type RealPhoto={description:string;topics:string[]};
export type VisualBriefInput={
 name:string;activity:string|null;zone:string|null;services:string[];activitySummary:string;guidelines:string;
 acceptedPhotoTypes:string[];excludedPhotoTypes:string[];exclusions:string[];palette:BrandPalette|null;hasLogo:boolean;realPhotos:RealPhoto[];
};
export type VisualBrief={
 client:string;trade:TradeDirection;zone:string|null;regional:string[];services:string[];palette:BrandPalette|null;hasLogo:boolean;
 /** Ce que montrent les vraies photos du client (descriptions factuelles de la photothèque) : le style à imiter. */realPhotoStyle:string[];
 accepted:string[];excluded:string[];exclusions:string[];guidelines:string;
};

const clean=(v:string,max:number)=>v.replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const uniq=(list:readonly string[],max:number,len:number)=>[...new Set(list.map(v=>clean(v,len)).filter(Boolean))].slice(0,max);

export function buildVisualBrief(input:VisualBriefInput):VisualBrief{
 const trade=tradeDirection([input.activity??'',...input.services,input.activitySummary].join(' '));
 return {client:clean(input.name,120),trade,zone:input.zone?clean(input.zone,120):null,regional:regionalCues(input.zone),services:uniq(input.services,12,120),
  palette:input.palette,hasLogo:input.hasLogo,realPhotoStyle:uniq(input.realPhotos.map(p=>p.description),8,220),
  accepted:uniq(input.acceptedPhotoTypes,10,120),excluded:uniq(input.excludedPhotoTypes,10,120),exclusions:uniq(input.exclusions,10,200),guidelines:clean(input.guidelines,1200)};
}

/** Nom de couleur approximatif (anglais) d'une couleur hexadécimale, pour orienter l'étalonnage d'une photo. */
export function colorName(hex:string):string{
 const m=/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);if(!m)return 'neutral';
 const [r,g,b]=[m[1],m[2],m[3]].map(x=>parseInt(x,16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2,d=max-min;
 if(d<0.08)return l<0.2?'near-black':l>0.85?'white':'grey';
 let h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;h=(h*60+360)%360;
 const base=h<15||h>=345?'red':h<40?'orange':h<65?'yellow':h<160?'green':h<200?'teal':h<255?'blue':h<290?'purple':'pink';
 return l<0.25?`dark ${base}`:l>0.75?`light ${base}`:base;
}

/** Bloc de consignes du brief pour un rédacteur ou un directeur artistique (français, données non fiables bornées). */
export function briefForPrompt(brief:VisualBrief){
 return {client:brief.client,metier:brief.trade.label,zone:brief.zone,ambiance_regionale:brief.regional,prestations:brief.services,
  style_des_vraies_photos_du_client:brief.realPhotoStyle,types_de_photos_acceptes:brief.accepted,types_de_photos_exclus:brief.excluded,
  a_ne_jamais_ecrire:brief.exclusions,consignes_de_communication:brief.guidelines,
  direction_artistique:{sujets:brief.trade.subjects,details:brief.trade.details,ambiance:brief.trade.mood,a_eviter:brief.trade.avoid},
  charte:brief.palette?{couleur_principale:`${brief.palette.primary} (${colorName(brief.palette.primary)})`,couleur_secondaire:`${brief.palette.secondary} (${colorName(brief.palette.secondary)})`}:null};
}

/**
 * Suffixe ajouté à toute description d'image envoyée au générateur : direction du métier, ambiance régionale,
 * étalonnage discret vers la charte, interdits du métier et format vertical (le sujet centré survit aux recadrages).
 */
export function imageStyleSuffix(brief:VisualBrief):string{
 const parts=[` Setting and atmosphere: ${brief.regional.join(', ')}.`,` Mood: ${brief.trade.mood}.`,
  ` Authentic details: ${brief.trade.details.slice(0,4).join(', ')}.`,
  brief.palette?` Subtle colour grading that harmonises with ${colorName(brief.palette.primary)} and ${colorName(brief.palette.secondary)} accents, never a colour cast.`:'',
  ` Must not show: ${brief.trade.avoid.join('; ')}.`,
  ' Vertical 2:3 composition, main subject centred with generous margins so it survives a 4:5 or 1:1 crop.',
  ' Shot like a professional documentary photographer: 35mm lens, natural perspective, realistic textures, slight imperfections, no HDR, no CGI look, no illustration style.'];
 return parts.join('');
}

/** Ouvertures d'accroche usées (« Attirez », « Boostez »…) : refusées pour forcer un message concret. */
export const GENERIC_OPENERS=['attirez','boostez','optimisez','developpez','découvrez','decouvrez','faites confiance','confiez','profitez','améliorez','ameliorez','simplifiez','donnez vie','redonnez vie','libérez','liberez','gagnez','captez'];
const fold=(t:string)=>t.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g,'');
/** Première « attaque » d'une accroche (deux premiers mots normalisés), pour éviter deux accroches qui commencent pareil. */
export const opener=(headline:string)=>fold(headline).replace(/[^\p{L}\p{N}' ]+/gu,' ').trim().split(/\s+/).slice(0,2).join(' ');
export function genericOpener(headline:string):string|null{
 const h=fold(headline).trim();
 return GENERIC_OPENERS.find(o=>h.startsWith(fold(o)))??null;
}

/** Angle d'accroche du métier le moins récemment employé (rotation déterministe sur le nombre de visuels déjà faits). */
export function nextAngle(trade:TradeDirection,count:number):string{
 return trade.angles[((count%trade.angles.length)+trade.angles.length)%trade.angles.length];
}
