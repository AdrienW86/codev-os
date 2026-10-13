// Simulation du pipeline Publications (PR #44) : scénarios prêts à l'emploi sur les quatre clients d'exemple.
// FICTIF : clients, photos (aucun fichier, seulement une description), analyses du modèle simulé, historiques et
// textes sont inventés pour la démonstration. Aucune intervention réelle n'est décrite ni supposée. Pur.
import {DEFAULT_MEDIA_PROFILE,type MediaProfile} from '@/lib/media-intelligence/model';
import type {PublicationPlatform} from '../types';
import type {SimulatedOutcomes} from './model';

// Réponse brute du modèle de vision simulé (même schéma que classificationSchema), avant normalizeAssessment.
export type FixtureVision={verdict:string;business_relevance:number;publishability:number;sensitive:string[];confidential:boolean;description:string;topics:string[];quality:string;quality_issues:string[]};
export type FixturePhoto={id:string;label:string;caption:string|null;libraryStatus:string;width:number;height:number;importedDaysAgo:number;vision:FixtureVision};
// Idée qu'écrit le modèle de rédaction simulé pour une prestation (déclinaisons natives par plateforme).
export type FixtureTemplate={service:string;keywords:string[];subject:string;angle:string;texts:Record<PublicationPlatform,string>;cta:string|null};
export type FixtureHistory={id:string;subject:string;texts:{platform:PublicationPlatform;text:string}[];media:string|null};
// Comportement du modèle de rédaction simulé au premier essai : conforme, ou erreur typique qu'un garde-fou doit arrêter.
export type MockFirstAttempt='compliant'|'repeat_service'|'pick_media';
export type FixtureScenario={id:string;name:string;description:string;negative:boolean;
 client:{name:string;activity:string;zone:string};project:{name:string};profile:MediaProfile;verifiedServices:string[];editorialRules:string;
 channelRules:{platform:PublicationPlatform;rules:string}[];reuse:{allowed:boolean;afterDays:number};timezone:string;
 schedule:Record<PublicationPlatform,{weekday:number;localTime:string}[]>;photos:FixturePhoto[];uses:{assetId:string;publicationId:string;usedDaysAgo:number}[];
 history:FixtureHistory[];templates:FixtureTemplate[];fallback:FixtureTemplate;firstAttempt:MockFirstAttempt;adversarialMediaId?:string;defaultOutcomes:SimulatedOutcomes};

const profile=(p:Partial<MediaProfile>):MediaProfile=>({...DEFAULT_MEDIA_PROFILE,aiClassificationEnabled:true,version:1,saved:true,...p});
const vision=(v:Partial<FixtureVision>&Pick<FixtureVision,'description'>):FixtureVision=>({verdict:'relevant',business_relevance:.85,publishability:.85,sensitive:[],confidential:false,topics:[],quality:'good',quality_issues:[],...v});
const allSuccess:SimulatedOutcomes={facebook:'success',instagram:'success',google_business_profile:'success'};

// --- CODE-V : agence web (parcours nominal, tout réussit) ---
const codev:FixtureScenario={id:'codev-nominal',name:'CODE-V — parcours nominal',description:'Agence web : une photo de maquettes est retenue, trois déclinaisons, diffusion simulée réussie partout.',negative:false,
 client:{name:'CODE-V',activity:'Agence web',zone:'Perpignan'},project:{name:'Réseaux sociaux CODE-V'},
 profile:profile({activitySummary:'Agence web : conception et refonte de sites, référencement local.',services:['Création de site internet','Référencement local'],
  acceptedPhotoTypes:['maquettes','ateliers de conception'],excludedPhotoTypes:['écrans affichant des données de clients'],priorityTopics:['Création de site internet']}),
 verifiedServices:['Création de site internet'],editorialRules:'Ton simple et pédagogique, tutoiement interdit.',channelRules:[],reuse:{allowed:false,afterDays:180},timezone:'Europe/Paris',
 schedule:{facebook:[{weekday:2,localTime:'12:00'}],instagram:[{weekday:4,localTime:'18:00'}],google_business_profile:[{weekday:3,localTime:'09:30'}]},
 photos:[
  {id:'sim-photo-codev-1',label:'Maquettes papier sur la table',caption:null,libraryStatus:'received',width:1600,height:1200,importedDaysAgo:3,
   vision:vision({business_relevance:.9,publishability:.88,description:'Maquettes papier d’un site web disposées sur une table de travail.',topics:['maquette','Création de site internet']})},
  {id:'sim-photo-codev-2',label:'Écran de statistiques',caption:'tableau de bord client',libraryStatus:'received',width:1920,height:1080,importedDaysAgo:2,
   vision:vision({sensitive:['screen'],description:'Écran d’ordinateur affichant un tableau de statistiques.',topics:['Référencement local']})},
  {id:'sim-photo-codev-3',label:'Bureau flou',caption:null,libraryStatus:'received',width:1200,height:900,importedDaysAgo:1,
   vision:vision({verdict:'to_review',business_relevance:.4,publishability:.3,quality:'poor',quality_issues:['blurry'],description:'Bureau photographié de manière floue.'})}],
 uses:[],history:[{id:'sim-pub-codev-1',subject:'Un site lisible sur mobile',texts:[{platform:'facebook',text:'La majorité des visites passent par le téléphone : un site lisible sur petit écran change tout.'}],media:'Smartphone affichant une page d’accueil.'}],
 templates:[{service:'Création de site internet',keywords:['maquette','site'],subject:'Les maquettes, première étape d’un site sur mesure',angle:'Montrer le travail de conception qui précède le développement du site.',
  texts:{facebook:'Avant d’écrire la moindre ligne de code, tout commence sur papier. Ces maquettes posent la structure du futur site : pages, parcours, place des contenus. Une étape que nous menons toujours avec vous.',
   instagram:'Du croquis au site. ✏️\nChaque projet démarre par des maquettes dessinées à la main.\n#webdesign #maquette #creationdesite',
   google_business_profile:'CODE-V conçoit votre site internet étape par étape. La première : des maquettes pour valider ensemble la structure et le parcours de vos visiteurs.'},cta:'Parlons de votre projet de site.'}],
 fallback:{service:'Création de site internet',keywords:[],subject:'Ce qu’il faut préparer avant la création d’un site',angle:'Lister les contenus utiles avant un projet web.',
  texts:{facebook:'Textes, photos, liste des pages : rassembler ces éléments à l’avance rend un projet de site plus simple pour tout le monde.',
   instagram:'Prêt pour un nouveau site ? Commencez par vos contenus. 📝\n#siteweb #projetweb',
   google_business_profile:'Avant la création de votre site internet, CODE-V vous aide à rassembler textes, photos et structure des pages.'},cta:null},
 firstAttempt:'compliant',defaultOutcomes:allSuccess};

// --- JRenov : rénovation (visage écarté, photo déjà utilisée, résultats de diffusion mélangés) ---
const jrenov:FixtureScenario={id:'jrenov-mixed',name:'JRenov — diffusion contrastée',description:'Rénovation : photo avec visage écartée, photo déjà utilisée écartée ; Facebook réussit, Instagram refuse, Google est indisponible.',negative:false,
 client:{name:'JRenov',activity:'Rénovation intérieure',zone:'Narbonne'},project:{name:'Réseaux sociaux JRenov'},
 profile:profile({activitySummary:'Rénovation intérieure : salles de bain, carrelage, isolation.',services:['Rénovation de salle de bain','Pose de carrelage','Isolation des combles'],
  acceptedPhotoTypes:['pièces rénovées','détails de finition'],excludedPhotoTypes:['photos de personnes'],priorityTopics:['Rénovation de salle de bain']}),
 verifiedServices:['Rénovation de salle de bain','Pose de carrelage','Isolation des combles'],editorialRules:'Mettre en avant le confort au quotidien.',
 channelRules:[{platform:'instagram',rules:'Une accroche courte avec un émoji.'}],reuse:{allowed:false,afterDays:180},timezone:'Europe/Paris',
 schedule:{facebook:[{weekday:1,localTime:'11:00'}],instagram:[{weekday:3,localTime:'19:00'}],google_business_profile:[{weekday:5,localTime:'10:00'}]},
 photos:[
  {id:'sim-photo-jrenov-1',label:'Salle de bain avec douche à l’italienne',caption:'fini !',libraryStatus:'received',width:1500,height:2000,importedDaysAgo:4,
   vision:vision({business_relevance:.92,publishability:.9,description:'Salle de bain avec douche à l’italienne et carrelage gris clair.',topics:['salle de bain','carrelage']})},
  {id:'sim-photo-jrenov-2',label:'Artisan posant du carrelage',caption:null,libraryStatus:'received',width:1600,height:1200,importedDaysAgo:2,
   vision:vision({sensitive:['face'],description:'Artisan posant du carrelage au sol, visage visible.',topics:['carrelage']})},
  {id:'sim-photo-jrenov-3',label:'Combles isolés',caption:null,libraryStatus:'validated',width:1600,height:1200,importedDaysAgo:40,
   vision:vision({business_relevance:.85,publishability:.8,description:'Combles avec isolant déroulé entre les solives.',topics:['isolation','combles']})}],
 uses:[{assetId:'sim-photo-jrenov-3',publicationId:'sim-pub-jrenov-1',usedDaysAgo:20}],
 history:[{id:'sim-pub-jrenov-1',subject:'Isoler ses combles avant l’hiver',texts:[{platform:'facebook',text:'Des combles bien isolés, c’est une maison plus confortable dès les premiers froids.'}],media:'Combles avec isolant déroulé entre les solives.'}],
 templates:[{service:'Rénovation de salle de bain',keywords:['salle de bain','douche','carrelage'],subject:'Une salle de bain repensée autour d’une douche à l’italienne',angle:'Montrer qu’une douche à l’italienne et un carrelage clair changent le confort d’une salle de bain.',
  texts:{facebook:'Une douche à l’italienne et un carrelage gris clair suffisent souvent à transformer une salle de bain. Vous réfléchissez à rénover la vôtre ? Parlons de vos envies et de vos contraintes.',
   instagram:'Douche à l’italienne et carrelage gris : la salle de bain respire. 🚿\n#salledebain #renovation #carrelage #douche',
   google_business_profile:'JRenov accompagne la rénovation de salles de bain : douche à l’italienne, pose de carrelage, choix des finitions. Contactez-nous pour en discuter.'},cta:'Demandez une visite.'}],
 fallback:{service:'Rénovation de salle de bain',keywords:[],subject:'Préparer la rénovation de sa salle de bain',angle:'Les questions à se poser avant de rénover.',
  texts:{facebook:'Douche ou baignoire, rangements, éclairage : quelques questions simples aident à bien préparer la rénovation d’une salle de bain.',
   instagram:'Votre future salle de bain commence par une liste. 📝\n#salledebain #renovation',
   google_business_profile:'JRenov vous aide à préparer la rénovation de votre salle de bain, du choix des matériaux aux finitions.'},cta:null},
 firstAttempt:'compliant',defaultOutcomes:{facebook:'success',instagram:'refused',google_business_profile:'down'}};

// --- Couverture Catalane : couvreur, trois démoussages d'affilée → rotation vers le faîtage ---
const catalane:FixtureScenario={id:'catalane-rotation',name:'Couverture Catalane — rotation des prestations',description:'Couvreur : après trois publications sur le démoussage, un quatrième démoussage est refusé et l’idée tourne vers le faîtage ; connexion Google expirée.',negative:false,
 client:{name:'Couverture Catalane',activity:'Couvreur',zone:'Céret'},project:{name:'Réseaux sociaux Couverture Catalane'},
 profile:profile({activitySummary:'Couverture : démoussage et réparation de faîtage.',services:['Démoussage de toiture','Réparation de faîtage'],
  acceptedPhotoTypes:['toitures','tuiles'],excludedPhotoTypes:['photos de personnes'],priorityTopics:['Démoussage de toiture']}),
 verifiedServices:['Démoussage de toiture','Réparation de faîtage'],editorialRules:'Ton rassurant, vocabulaire du métier expliqué simplement.',channelRules:[],reuse:{allowed:false,afterDays:180},timezone:'Europe/Paris',
 schedule:{facebook:[{weekday:2,localTime:'08:30'}],instagram:[{weekday:4,localTime:'12:30'}],google_business_profile:[{weekday:5,localTime:'09:00'}]},
 photos:[
  {id:'sim-photo-catalane-1',label:'Toiture couverte de mousse',caption:null,libraryStatus:'received',width:2000,height:1500,importedDaysAgo:2,
   vision:vision({business_relevance:.95,publishability:.9,description:'Toiture en tuiles couverte de mousse, avant démoussage.',topics:['démoussage','toiture']})},
  {id:'sim-photo-catalane-2',label:'Faîtage en tuiles canal',caption:null,libraryStatus:'received',width:1800,height:1350,importedDaysAgo:5,
   vision:vision({business_relevance:.85,publishability:.85,description:'Faîtage de toiture en tuiles canal, tuiles faîtières alignées.',topics:['faîtage','toiture']})},
  {id:'sim-photo-catalane-3',label:'Équipe sur le toit',caption:'la team',libraryStatus:'received',width:1600,height:1200,importedDaysAgo:1,
   vision:vision({sensitive:['face'],description:'Deux personnes posent sur un toit, visages visibles.',topics:['toiture']})}],
 uses:[],
 history:[
  {id:'sim-pub-catalane-3',subject:'Démoussage : protéger ses tuiles du gel',texts:[{platform:'facebook',text:'Une tuile gorgée d’eau par la mousse souffre davantage quand il gèle.'}],media:'Tuiles nettoyées après démoussage.'},
  {id:'sim-pub-catalane-2',subject:'Le démoussage en trois étapes',texts:[{platform:'facebook',text:'Brossage, rinçage puis traitement : voici comment se déroule un démoussage.'}],media:'Brosse posée sur des tuiles.'},
  {id:'sim-pub-catalane-1',subject:'Démoussage de toiture : pourquoi au printemps',texts:[{platform:'facebook',text:'Le printemps est une bonne saison pour retirer la mousse accumulée pendant l’hiver.'}],media:'Toit couvert de mousse vu du jardin.'}],
 templates:[
  {service:'Démoussage de toiture',keywords:['démoussage','mousse'],subject:'Le démoussage avant l’hiver',angle:'Retirer la mousse protège les tuiles.',
   texts:{facebook:'La mousse retient l’humidité sur les tuiles : un démoussage avant l’hiver les protège du gel.',
    instagram:'Avant l’hiver, on retire la mousse du toit. 🧹\n#toiture #demoussage',
    google_business_profile:'Démoussage de toiture : retrait de la mousse et nettoyage des tuiles avant l’hiver.'},cta:null},
  {service:'Réparation de faîtage',keywords:['faîtage','faîtières'],subject:'Réparation de faîtage avant les pluies',angle:'Un faîtage abîmé se répare avant les pluies.',
   texts:{facebook:'Un faîtage fissuré laisse passer l’eau sous les tuiles : nous le réparons avant les pluies d’automne.',
    instagram:'Faîtage solide, toiture à l’abri. 🏠\n#toiture #faitage #couvreur',
    google_business_profile:'Réparation de faîtage : les tuiles faîtières sont reposées au mortier pour une toiture étanche à la pluie.'},cta:'Demandez conseil à Couverture Catalane.'}],
 fallback:{service:'Réparation de faîtage',keywords:[],subject:'Surveiller son faîtage',angle:'Les signes d’un faîtage à reprendre.',
  texts:{facebook:'Tuiles faîtières déplacées, mortier qui s’effrite : quelques signes simples montrent qu’un faîtage doit être repris.',
   instagram:'Un œil sur le faîtage. 👀\n#toiture #faitage',
   google_business_profile:'Couverture Catalane contrôle et répare les faîtages de toiture.'},cta:null},
 firstAttempt:'repeat_service',defaultOutcomes:{facebook:'success',instagram:'success',google_business_profile:'expired'}};

// --- Protection Nuisibles : scénario NÉGATIF (facture et capture d'écran : aucune photo publiable) ---
const nuisibles:FixtureScenario={id:'nuisibles-facture',name:'Protection Nuisibles — facture refusée (négatif)',description:'Dératisation : la seule « photo » est une facture, l’autre une capture d’écran. Elles ne peuvent jamais illustrer une publication ; approbation impossible sans photo.',negative:true,
 client:{name:'Protection Nuisibles',activity:'Dératisation et désinsectisation',zone:'Perpignan'},project:{name:'Réseaux sociaux Protection Nuisibles'},
 profile:profile({activitySummary:'Dératisation et désinsectisation pour particuliers et professionnels.',services:['Dératisation','Désinsectisation'],
  acceptedPhotoTypes:['pièges','nids d’insectes'],excludedPhotoTypes:['factures','captures d’écran'],priorityTopics:['Désinsectisation']}),
 verifiedServices:['Dératisation','Désinsectisation'],editorialRules:'Ton factuel, jamais alarmiste.',channelRules:[],reuse:{allowed:false,afterDays:180},timezone:'Europe/Paris',
 schedule:{facebook:[{weekday:1,localTime:'09:00'}],instagram:[{weekday:2,localTime:'18:30'}],google_business_profile:[{weekday:4,localTime:'08:00'}]},
 photos:[
  {id:'sim-photo-nuisibles-1',label:'Facture d’intervention',caption:'facture client',libraryStatus:'received',width:1240,height:1754,importedDaysAgo:1,
   // Le modèle simulé se trompe volontairement (« pertinent », non confidentiel) : les règles de sûreté doivent primer.
   vision:vision({verdict:'relevant',business_relevance:.7,publishability:.8,sensitive:['invoice'],confidential:false,description:'Facture papier posée sur un bureau.',topics:['Désinsectisation']})},
  {id:'sim-photo-nuisibles-2',label:'Capture d’écran de conversation',caption:null,libraryStatus:'received',width:1080,height:2340,importedDaysAgo:1,
   vision:vision({verdict:'to_review',business_relevance:.5,publishability:.4,sensitive:['screen'],quality:'acceptable',quality_issues:['screenshot','text_heavy'],description:'Capture d’écran d’une conversation de messagerie.'})}],
 uses:[],history:[],
 templates:[{service:'Désinsectisation',keywords:['nid','insecte','piège'],subject:'Désinsectisation : repérer les premiers signes',angle:'Aider à reconnaître les signes d’une présence d’insectes.',
  texts:{facebook:'Traces sur les plinthes, bruits la nuit, nids près des fenêtres : certains signes doivent alerter. Protection Nuisibles vous aide à identifier le problème avant d’agir.',
   instagram:'Petits signes, gros indices. 🔎\n#nuisibles #desinsectisation',
   google_business_profile:'Désinsectisation et dératisation pour particuliers et professionnels. Décrivez-nous ce que vous observez, nous vous conseillons sur la marche à suivre.'},cta:null}],
 fallback:{service:'Désinsectisation',keywords:[],subject:'Désinsectisation : repérer les premiers signes',angle:'Aider à reconnaître les signes d’une présence d’insectes.',
  texts:{facebook:'Traces sur les plinthes, bruits la nuit, nids près des fenêtres : certains signes doivent alerter. Protection Nuisibles vous aide à identifier le problème avant d’agir.',
   instagram:'Petits signes, gros indices. 🔎\n#nuisibles #desinsectisation',
   google_business_profile:'Désinsectisation et dératisation pour particuliers et professionnels. Décrivez-nous ce que vous observez, nous vous conseillons sur la marche à suivre.'},cta:null},
 firstAttempt:'pick_media',adversarialMediaId:'sim-photo-nuisibles-1',defaultOutcomes:allSuccess};

export const PIPELINE_SCENARIOS:readonly FixtureScenario[]=[codev,jrenov,catalane,nuisibles];
export function getPipelineScenario(id:string):FixtureScenario|null{return PIPELINE_SCENARIOS.find(s=>s.id===id)??null;}
