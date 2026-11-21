import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DRIVE_ROOT = process.env.VISUAL_DRIVE_ROOT_ID || "15JDPgR7R5uF9Re59tkwT2b59zMC2E3w2";
const OPENAI_URL = "https://api.openai.com/v1/images/generations";
const VERCEL_API = "https://api.vercel.com";
const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";
const EXPECTED_OUTPUT_COST = 0.041; // USD; GPT Image 2, medium, 1536x1024. Excludes input.
const TITLE_EXCLUSION = /(sign in|log in|se connecter|connexion|authentication required|deployment protection)/i;
const PREVIEW_DOMAIN = /(-git-|-[a-z0-9]+-projects\.vercel\.app$|^.*-adrienw86s-projects\.vercel\.app$)/i;
const NON_PUBLIC_PROJECTS = new Set(["codev-os", "logifa", "oracle", "formation"]);
const PRIORITY = [
  "nuisibles-provence", "protection-nuisibles", "express-nuisibles",
  "nuisibles-services", "nuisibles-toulon", "nuisible-marseille", "nuisible11",
  "jrenov", "couverture-catalane", "elite-couverture66", "toiture66",
  "ecotoit", "france-toiture", "toiture-marseille", "klenn-couverture",
  "narbonne-toiture"
];
const FOLDER_NAMES = {
  "nuisibles-provence": "Nuisibles Provence",
  "protection-nuisibles": "Protection Nuisibles",
  "express-nuisibles": "Express Nuisibles",
  "nuisibles-services": "Nuisibles Services",
  "nuisibles-toulon": "Nuisibles Toulon",
  "nuisible-marseille": "Nuisible Marseille",
  "nuisible11": "Nuisible 11",
  "jrenov": "JRENOV",
  "couverture-catalane": "Couverture Catalane",
  "elite-couverture66": "Elite Couverture 66",
  "toiture66": "Toiture 66",
  "ecotoit": "Eco-Toit",
  "france-toiture": "France Toiture",
  "toiture-marseille": "Toiture Marseille",
  "klenn-couverture": "Klenn Couverture",
  "narbonne-toiture": "Narbonne Toiture"
};
const SCENES = {
  nuisibles: [
    "Technicien inspectant soigneusement le dessous d'un évier pour détecter une entrée de rongeur",
    "Boîtier sécurisé de dératisation discret contre un mur extérieur en pierre",
    "Gros plan réaliste d'une souris domestique dans un trou de maçonnerie",
    "Technicien protégeant une zone de cuisine pendant une intervention anti-cafards",
    "Macro réaliste d'un cafard sur un sol carrelé propre",
    "Inspection d'un grenier ancien pour détecter des traces de rongeurs",
    "Une punaise de lit sur la couture d'un matelas, photographie macro didactique",
    "Technicien inspectant un sommier avec une lampe, sans montrer de produits chimiques",
    "Nid de frelons suspendu sous un avant-toit photographié à distance",
    "Technicien professionnel équipé d'une tenue adaptée près d'une toiture avec nid de guêpes",
    "Macro d'une guêpe dans un jardin méditerranéen",
    "Termites dans une poutre en bois de charpente, photographie macro",
    "Gros plan d'une charpente présentant des galeries d'insectes xylophages",
    "Inspection professionnelle d'une cave sèche en pierre",
    "Fourmis circulant le long d'une fissure extérieure",
    "Moustique posé sur une feuille verte, photographie macro",
    "Contrôle d'un petit point d'eau stagnante autour d'une maison",
    "Technicien recherchant des passages de nuisibles près d'un vide sanitaire",
    "Gros plan de déjections de rongeur sur un sol en béton, sans mains humaines",
    "Installation soignée d'une grille de prévention anti-rongeurs",
    "Pigeon sur la corniche d'une maison sous un ciel bleu",
    "Dispositif discret de pics anti-pigeons sur une corniche",
    "Technicien vérifiant les combles d'une habitation familiale",
    "Inspection d'un entrepôt pour la prévention des infestations",
    "Gros plan d'une tapette mécanique sécurisée dans un local technique",
    "Inspection de la façade et des joints d'une maison provençale",
    "Technicien contrôlant les abords d'un jardin avec sa mallette professionnelle",
    "Coccinelle et insectes du jardin, photo nature documentaire sur la biodiversité",
    "Matériel de contrôle d'infestation rangé proprement dans un véhicule sans marque",
    "Vue aérienne paisible de maisons provençales, oliviers et jardins sans personnes"
  ],
  couverture: [
    "Couvreur harnaché effectuant une inspection de tuiles terre cuite",
    "Toiture ancienne en tuiles canal typiques du sud de la France",
    "Gros plan d'une tuile fissurée à remplacer",
    "Artisan remplaçant une tuile en terre cuite sur toiture sécurisée",
    "Pose d'un écran sous toiture respirant avant couverture",
    "Charpente traditionnelle en bois massif photographiée depuis les combles",
    "Artisan examinant les chevrons d'une charpente ancienne",
    "Détail d'un faîtage ventilé sur toit de tuiles",
    "Réfection minutieuse du faîtage en tuiles",
    "Gouttières en aluminium sans raccord, détail de façade",
    "Couvreur sécurisant une descente d'eaux pluviales",
    "Détail d'un chéneau encaissé en zinc",
    "Artisan inspectant l'étanchéité d'un chéneau",
    "Solin en zinc neuf autour d'une cheminée de toit",
    "Détail d'une noue de toiture en zinc",
    "Fenêtre de toit moderne intégrée à la couverture",
    "Pose soignée d'un Velux avec raccord d'étanchéité",
    "Membrane d'étanchéité sur toiture-terrasse plate",
    "Recherche professionnelle d'une fuite près d'une pénétration de toiture",
    "Démoussage prudent de tuiles par une équipe équipée",
    "Traitement hydrofuge de toiture en extérieur, applicateur équipé",
    "Bac acier posé sur une dépendance, vue architecturale",
    "Toiture d'ardoise restaurée avec lignes de pose régulières",
    "Travaux de zinguerie sur une rive de toit",
    "Pose de sous-face et habillage de débord de toiture",
    "Réparation de bande de rive en zinc",
    "Inspection de toiture après orage, tuiles déplacées",
    "Couvreur sur échafaudage réglementaire travaillant en sécurité",
    "Maison individuelle rénovée avec toiture impeccable et jardin",
    "Vue architecturale rapprochée d'une toiture neuve et d'une cheminée"
  ],
  restauration: [
    "Chef cuisinier préparant un plat français artisanal dans une cuisine professionnelle",
    "Table de restaurant élégante dressée avant le service",
    "Gros plan d'un dessert de saison dans une assiette en céramique",
    "Plats du jour dans un bistrot français lumineux",
    "Ingrédients frais de marché provençal sur une table",
    "Cuisinier dressant une assiette avec précision",
    "Service de café espresso dans un restaurant",
    "Façade accueillante de restaurant français sans enseigne",
    "Salle de restauration lumineuse avant ouverture",
    "Panier de pains frais et viennoiseries artisanales",
    "Assortiment de légumes de saison sur plan de cuisine",
    "Plat végétarien français dans une lumière naturelle",
    "Service de brunch à une table en bois",
    "Ambiance terrasse sous les arbres",
    "Gros plan d'une préparation culinaire en train de mijoter"
  ],
  beaute: [
    "Institut de beauté élégant avec lumière douce et linge propre",
    "Professionnelle disposant des serviettes avant un soin du visage",
    "Produits cosmétiques génériques et végétaux dans un salon",
    "Cabine de soin moderne accueillante et bien rangée",
    "Gros plan de mains effectuant une manucure sans logo",
    "Mise en place de matériel stérile dans un institut",
    "Ambiance espace bien-être aux tons chauds",
    "Rangement soigné de pinceaux et instruments esthétiques",
    "Cocon lumineux avec table de massage et plantes",
    "Gros plan de texture d'une crème cosmétique",
    "Vasque en pierre et serviettes de coton",
    "Accueil chaleureux d'un institut de beauté",
    "Décoration végétale et miroir dans une pièce zen",
    "Soin esthétique des mains photographié en gros plan",
    "Bougies et produits de soin sur un plateau"
  ],
  numerique: [
    "Bureau de développeur web avec ordinateur montrant une interface abstraite",
    "Équipe créative discutant devant des écrans sans logos",
    "Architecture de site web représentée sur carnets de croquis",
    "Bureau minimaliste et ordinateur portable ouvert",
    "Réunion produit autour de wireframes imprimés illisibles",
    "Photographie de studio moderne de création numérique",
    "Équipement professionnel de production vidéo",
    "Mains utilisant un clavier mécanique sur bureau lumineux",
    "Salle de réunion digitale avec écran abstrait",
    "Vue d'un espace de coworking français",
    "Atelier de graphisme avec nuanciers de couleurs",
    "Carnet de notes et smartphone sur un bureau",
    "Caméra et éclairages d'un studio de communication",
    "Poste de travail dual-screen pour le développement",
    "Téléphone et tablette sur une table élégante"
  ],
  general: [
    "Portrait documentaire d'un professionnel de dos dans son atelier",
    "Façade soignée d'une entreprise locale française",
    "Détails d'outils professionnels rangés avec soin",
    "Préparation méthodique de matériel de travail",
    "Mains d'un artisan effectuant une tâche précise",
    "Espace de travail lumineux et organisé",
    "Rencontre de conseil entre professionnel et client de dos",
    "Gros plan sur une matière liée au savoir-faire manuel",
    "Véhicule utilitaire générique à proximité d'une entreprise",
    "Vue extérieure d'un bâtiment français à la lumière du matin",
    "Objets du métier présentés sur table en bois",
    "Geste technique photographié en gros plan",
    "Espace d'accueil propre et accueillant",
    "Détail du matériel de sécurité professionnel",
    "Vue d'ensemble d'un atelier de petite entreprise"
  ]
};
const CAMERA = [
  "prise de vue documentaire, 35 mm, contexte du travail clairement visible",
  "photographie éditoriale professionnelle, 85 mm, détail net au premier plan",
  "photographie d'architecture et de métier, 50 mm, lumière naturelle",
  "plan horizontal immersif, objectif 28 mm, profondeur de champ réaliste"
];

export function safeFolder(value) {
  return String(value).normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "Site sans nom";
}
export function slug(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70) || "photo";
}
export function domainCandidates(domains = []) {
  const choices = domains.map(d => typeof d === "string" ? d : d.name)
    .filter(Boolean).map(d => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !PREVIEW_DOMAIN.test(d));
  const unique = [...new Set(choices)];
  return unique.sort((a,b) => Number(a.endsWith(".vercel.app")) - Number(b.endsWith(".vercel.app")) ||
    Number(b.startsWith("www.")) - Number(a.startsWith("www.")) || a.length-b.length);
}
export function chooseDomain(domains = []) {
  return domainCandidates(domains)[0] || null;
}
export function detectCategory(value) {
  const s = String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/nuisible|deratis|desinsect|frelon|punaise|cafard|rongeur|anti.?parasite|pest/.test(s)) return "nuisibles";
  if (/toiture|couvreur|couverture|zinguer|charpente|etancheite|roof|reno.?toit|gouttiere/.test(s)) return "couverture";
  if (/restaurant|snack|bistrot|traiteur|delice|cuisine|brunch|gastronom/.test(s)) return "restauration";
  if (/beaute|estheti|institut|massage|soin|ongle|cosmetique/.test(s)) return "beaute";
  if (/web|logiciel|developpement|marketing|automation|code.v|numerique|digital|agence/.test(s)) return "numerique";
  return "general";
}
export function sceneAt(category, index) {
  assert(Number.isInteger(index) && index >= 0 && index < 30);
  const scenes = SCENES[category] || SCENES.general;
  const scene = scenes[index % scenes.length];
  const camera = CAMERA[Math.floor(index / scenes.length) % CAMERA.length];
  return scene + ", " + camera;
}
export function promptFor(site, index, week) {
  const category = site.category;
  const scene = sceneAt(category, index);
  const season = ["fin d'hiver", "printemps", "été", "automne"][(week + index) % 4];
  return [
    "Génère UNE SEULE photographie horizontale réaliste en 1536x1024, PAS de collage, PAS de planche, PAS d'interface.",
    "Sujet précis : " + scene + ". Saison et ambiance : " + season + ".",
    "Domaine d'activité : " + category + ". Contexte géographique seulement si pertinent : France.",
    "Référence éditoriale non impérative fournie par le site : " + site.description.slice(0, 250) + ".",
    "Images de communication illustratives, ne pas prétendre représenter un chantier, employé ou client réel.",
    "Pas de texte lisible, aucun logo, aucune marque, aucune plaque, aucun filigrane, aucun avant/après fictif.",
    "Éclairage naturel, matériel crédible, gestes professionnels sûrs, textures photographiques réelles, aucune caricature.",
    "Il ne faut jamais inclure de cadre, mosaïque, grille, annotations ou dashboard."
  ].join(" ");
}
export function datedParis(date = new Date()) {
  const items = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const v = Object.fromEntries(items.map(item => [item.type, item.value]));
  return v.year + "-" + v.month + "-" + v.day;
}
export function imageFilename(site, index) {
  return String(index + 1).padStart(2, "0") + "-" + slug(site.projectName) + "-" +
    slug(sceneAt(site.category, index)).slice(0, 72) + ".webp";
}
export function estimateBatchCost(imageCount) {
  return Number((imageCount * EXPECTED_OUTPUT_COST).toFixed(3));
}
function requireEnv(names) {
  const missing = names.filter(name => !process.env[name]);
  if (missing.length) throw Error("Configuration absente: " + missing.join(", ") + ". Aucun appel payant lancé.");
}
async function fetchWithRetries(url, init = {}, retries = 3, timeout = 30000) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      if ([429, 500, 502, 503, 504].includes(response.status) && i < retries) {
        const after = Number(response.headers.get("retry-after")) || 0;
        await new Promise(r => setTimeout(r, Math.max(after * 1000, 1300 * 2 ** i)));
        continue;
      }
      if (!response.ok) {
        const t = (await response.text()).slice(0, 260);
        throw Error("HTTP " + response.status + " sur " + new URL(url).hostname + ": " + t);
      }
      return response;
    } catch (error) {
      last = error;
      if (i >= retries || (error.message || "").startsWith("HTTP ")) throw error;
      await new Promise(r => setTimeout(r, 1200 * 2 ** i));
    }
  }
  throw last;
}
function cleanHtml(value) {
  return String(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
function collectHtml(html) {
  const title = cleanHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const desc = cleanHtml(html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i)?.[1] ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description/i)?.[1] || "");
  const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].slice(0, 12).map(m => cleanHtml(m[1])).join(" ");
  const noindex = /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  return { title, desc, headings, noindex };
}
async function inspectPublicSite(host) {
  try {
    const response = await fetchWithRetries("https://" + host, { headers: { "user-agent": "CODE-V-VisualFactory/1.0" } }, 1, 16000);
    if (!(response.headers.get("content-type") || "").includes("text/html")) return null;
    const html = (await response.text()).slice(0, 500000);
    const meta = collectHtml(html);
    if (meta.noindex || TITLE_EXCLUSION.test(meta.title) || /vercel authentication|deployment protection|<form[^>]*password/i.test(html.slice(0, 80000))) return null;
    if (!meta.title && !meta.headings) return null;
    return { ...meta, description: (meta.desc + " " + meta.headings).slice(0, 900) };
  } catch {
    return null;
  }
}
async function getVercelJson(path, params = {}) {
  const url = new URL(path, VERCEL_API);
  url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return (await fetchWithRetries(url, { headers: { authorization: "Bearer " + process.env.VERCEL_TOKEN } })).json();
}
export async function discoverPublicSites() {
  requireEnv(["VERCEL_TOKEN", "VERCEL_TEAM_ID"]);
  const projects = [];
  let from;
  for (let page = 0; page < 12; page++) {
    const data = await getVercelJson("/v9/projects", { limit: 100, ...(from ? { from } : {}) });
    const batch = data.projects || [];
    projects.push(...batch);
    if (!data.pagination?.next || !batch.length) break;
    from = data.pagination.next;
  }
  const sites = [];
  const domainsSeen = new Set();
  for (const project of projects) {
    if (NON_PUBLIC_PROJECTS.has(project.name)) continue;
    let details;
    try { details = await getVercelJson("/v9/projects/" + encodeURIComponent(project.id || project.name)); }
    catch (e) { console.warn("Projet inaccessible:", project.name, e.message); continue; }
    let domain = null;
    let meta = null;
    for (const candidate of domainCandidates(details.domains || [])) {
      if (domainsSeen.has(candidate.replace(/^www\./, ""))) continue;
      const inspected = await inspectPublicSite(candidate);
      if (inspected) { domain = candidate; meta = inspected; break; }
    }
    if (!domain || !meta) continue;
    domainsSeen.add(domain.replace(/^www\./, ""));
    const category = detectCategory(project.name + " " + meta.title + " " + meta.description);
    sites.push({
      projectName: project.name,
      name: safeFolder(FOLDER_NAMES[project.name] || meta.title.split("|")[0] || project.name),
      domain, category, description: meta.description
    });
  }
  sites.sort((a,b) => {
    const pa = PRIORITY.indexOf(a.projectName), pb = PRIORITY.indexOf(b.projectName);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
    return a.name.localeCompare(b.name, "fr");
  });
  return sites;
}
class Drive {
  constructor(accessToken) { this.token = accessToken; }
  static async connect() {
    requireEnv(["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"]);
    const body = new URLSearchParams({
      grant_type: "refresh_token", client_id: process.env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET, refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN
    });
    const data = await (await fetchWithRetries("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body
    })).json();
    if (!data.access_token) throw Error("Google Drive n'a pas renvoyé de jeton.");
    return new Drive(data.access_token);
  }
  async api(path, method = "GET", json) {
    const response = await fetchWithRetries(GOOGLE_DRIVE_API + path, {
      method, headers: { authorization: "Bearer " + this.token, ...(json ? { "content-type": "application/json" } : {}) },
      ...(json ? { body: JSON.stringify(json) } : {})
    });
    return response.json();
  }
  async ensureFolder(parent, name) {
    const q = "'" + parent.replace(/'/g, "\\'") + "' in parents and name = '" + name.replace(/'/g, "\\'") +
      "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const found = await this.api("/files?fields=nextPageToken,files(id,name)&pageSize=100&q=" + encodeURIComponent(q));
    if (found.files?.length) return found.files[0].id;
    const created = await this.api("/files?fields=id,name", "POST", {
      name, mimeType: "application/vnd.google-apps.folder", parents: [parent]
    });
    return created.id;
  }
  async existingImages(parent) {
    const q = "'" + parent.replace(/'/g, "\\'") + "' in parents and trashed = false";
    const files = new Set();
    let page;
    do {
      const url = "/files?fields=nextPageToken,files(id,name)&pageSize=1000&q=" + encodeURIComponent(q) +
        (page ? "&pageToken=" + encodeURIComponent(page) : "");
      const response = await this.api(url);
      for (const f of response.files || []) files.add(f.name);
      page = response.nextPageToken;
    } while (page);
    return files;
  }
  async uploadImage(folder, name, buffer) {
    const boundary = "codev-" + cryptoRandom();
    const metadata = JSON.stringify({ name, mimeType: "image/webp", parents: [folder] });
    const body = Buffer.concat([
      Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + metadata + "\r\n"),
      Buffer.from("--" + boundary + "\r\nContent-Type: image/webp\r\n\r\n"),
      buffer,
      Buffer.from("\r\n--" + boundary + "--\r\n")
    ]);
    const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink";
    const response = await (await fetchWithRetries(url, {
      method: "POST", headers: {
        authorization: "Bearer " + this.token,
        "content-type": "multipart/related; boundary=" + boundary
      }, body
    }, 3, 60000)).json();
    if (!response.id) throw Error("Téléversement Google Drive non confirmé.");
    const verified = await this.api("/files/" + encodeURIComponent(response.id) + "?fields=id,name,size,mimeType");
    if (verified.name !== name || verified.mimeType !== "image/webp" || Number(verified.size) !== buffer.length) {
      throw Error("Vérification Google Drive échouée pour " + name);
    }
    return verified.id;
  }
}
function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
async function generateImage(prompt) {
  requireEnv(["OPENAI_API_KEY"]);
  const payload = {
    model: process.env.VISUAL_IMAGE_MODEL || "gpt-image-2",
    prompt, n: 1, size: "1536x1024",
    quality: "medium", output_format: "webp", output_compression: 80
  };
  const response = await (await fetchWithRetries(OPENAI_URL, {
    method: "POST",
    headers: { authorization: "Bearer " + process.env.OPENAI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(payload)
  }, 3, 180000)).json();
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw Error("Image API : aucune image renvoyée.");
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length < 20000 || buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw Error("Fichier généré non WebP ou anormalement petit.");
  }
  return buffer;
}
export async function run(argv = process.argv.slice(2)) {
  const dryRun = argv.includes("--dry-run");
  const siteFilter = argv.find(s => s.startsWith("--site="))?.split("=")[1];
  const hardLimit = Math.max(0, Number(process.env.VISUAL_MAX_IMAGES || 480));
  const budgetLimit = Math.max(0, Number(process.env.VISUAL_MAX_OUTPUT_USD || 21));
  const override = argv.find(s => s.startsWith("--max-images="))?.split("=")[1];
  const limit = Math.min(hardLimit, Math.floor(budgetLimit / EXPECTED_OUTPUT_COST), override ? Math.max(0, Number(override)) : hardLimit);
  const report = { date: datedParis(), dryRun, model: process.env.VISUAL_IMAGE_MODEL || "gpt-image-2",
    plannedOutputPricePerImageUSD: EXPECTED_OUTPUT_COST, estimatedOutputBudgetUSD: estimateBatchCost(limit),
    sites: [], generated: 0, alreadyPresent: 0, failures: [], limited: false };
  try {
    const sites = (await discoverPublicSites()).filter(s => !siteFilter || s.projectName === siteFilter);
    if (!dryRun) requireEnv(["OPENAI_API_KEY", "GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"]);
    const drive = dryRun ? null : await Drive.connect();
    const week = Math.floor(Date.now() / (7 * 86400000));
    let allowance = limit;
    for (const site of sites) {
      if (allowance <= 0) { report.limited = true; break; }
      const s = { project: site.projectName, domain: site.domain, name: site.name, category: site.category,
        generated: 0, alreadyPresent: 0, failed: [], scheduled: 0 };
      report.sites.push(s);
      let existing = new Set();
      let dest;
      if (!dryRun) {
        const parent = await drive.ensureFolder(DRIVE_ROOT, site.name);
        dest = await drive.ensureFolder(parent, report.date);
        existing = await drive.existingImages(dest);
        s.driveFolderId = dest;
      }
      for (let i = 0; i < 30; i++) {
        const filename = imageFilename(site, i);
        if (existing.has(filename)) { s.alreadyPresent++; report.alreadyPresent++; continue; }
        if (allowance <= 0) { report.limited = true; break; }
        allowance--;
        s.scheduled++;
        if (dryRun) continue;
        try {
          const bytes = await generateImage(promptFor(site, i, week));
          await drive.uploadImage(dest, filename, bytes);
          s.generated++; report.generated++;
          console.log(site.name + ": " + (i + 1) + "/30 confirmé (" + bytes.length + " octets)");
        } catch (error) {
          s.failed.push({ filename, reason: String(error.message || error).slice(0, 300) });
          report.failures.push({ project: site.projectName, filename, error: String(error.message || error).slice(0, 300) });
          console.error(site.name + ":", filename, String(error.message || error).slice(0, 220));
          if (/HTTP (401|403)|Configuration absente|quota|billing/i.test(error.message || "")) throw error;
        }
      }
    }
    report.discoveredSites = sites.length;
  } catch (error) {
    report.fatal = String(error.message || error).slice(0, 450);
    console.error("Visual Factory interrompue:", report.fatal);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile("visual-factory-report.json", JSON.stringify(report, null, 2));
    console.log("VISUAL_FACTORY_REPORT", JSON.stringify({
      discovered: report.discoveredSites, generated: report.generated, existing: report.alreadyPresent,
      failures: report.failures.length, limited: report.limited, fatal: report.fatal || null
    }));
  }
  if (report.failures.length) process.exitCode = 1;
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
