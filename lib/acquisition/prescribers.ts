/**
 * Référentiel déterministe « métier du client → entreprises prescriptrices ».
 * Chaque segment est rattaché à des codes NAF (rév. 2) utilisés pour interroger
 * la base Sirene. Aucune donnée inventée : ce fichier ne décrit que des cibles
 * plausibles, la recherche réelle confirme ensuite l'existence des entreprises.
 */

export type PrescriberSegmentId =
  | "architects" | "engineering" | "property_managers" | "real_estate_agencies"
  | "developers" | "home_builders" | "social_landlords" | "insurance"
  | "loss_adjusters" | "diagnostics" | "roofing_framing" | "finishing_trades"
  | "plumbing_heating" | "electrical" | "masonry" | "building_cleaning"
  | "landscaping" | "hospitality" | "kitchen_retail";

export type PrescriberSegment = {
  id: PrescriberSegmentId;
  label: string;
  nafCodes: string[];
};

export const PRESCRIBER_SEGMENTS: Record<PrescriberSegmentId, PrescriberSegment> = {
  architects: { id: "architects", label: "Architectes", nafCodes: ["71.11Z"] },
  engineering: { id: "engineering", label: "Maîtres d'œuvre et bureaux d'études", nafCodes: ["71.12B"] },
  property_managers: { id: "property_managers", label: "Syndics et administrateurs de biens", nafCodes: ["68.32A"] },
  real_estate_agencies: { id: "real_estate_agencies", label: "Agences immobilières", nafCodes: ["68.31Z"] },
  developers: { id: "developers", label: "Promoteurs immobiliers", nafCodes: ["41.10A", "41.10B", "41.10C"] },
  home_builders: { id: "home_builders", label: "Constructeurs de maisons individuelles", nafCodes: ["41.20A"] },
  social_landlords: { id: "social_landlords", label: "Bailleurs et gestionnaires de logements", nafCodes: ["68.20A"] },
  insurance: { id: "insurance", label: "Agents et courtiers d'assurance", nafCodes: ["66.22Z"] },
  loss_adjusters: { id: "loss_adjusters", label: "Experts en sinistres", nafCodes: ["66.21Z"] },
  diagnostics: { id: "diagnostics", label: "Diagnostiqueurs et contrôle technique", nafCodes: ["71.20B"] },
  roofing_framing: { id: "roofing_framing", label: "Charpentiers et couvreurs", nafCodes: ["43.91A", "43.91B"] },
  finishing_trades: { id: "finishing_trades", label: "Peintres, plâtriers et menuisiers", nafCodes: ["43.34Z", "43.31Z", "43.32A"] },
  plumbing_heating: { id: "plumbing_heating", label: "Plombiers et chauffagistes", nafCodes: ["43.22A", "43.22B"] },
  electrical: { id: "electrical", label: "Électriciens", nafCodes: ["43.21A"] },
  masonry: { id: "masonry", label: "Maçons et entreprises générales", nafCodes: ["43.99C", "41.20B"] },
  building_cleaning: { id: "building_cleaning", label: "Nettoyage et entretien de bâtiments", nafCodes: ["81.21Z", "81.22Z"] },
  landscaping: { id: "landscaping", label: "Paysagistes", nafCodes: ["81.30Z"] },
  hospitality: { id: "hospitality", label: "Hôtels et restaurants", nafCodes: ["55.10Z", "56.10A"] },
  kitchen_retail: { id: "kitchen_retail", label: "Cuisinistes et magasins d'ameublement", nafCodes: ["47.59A"] },
};

/** 1 = prescripteur principal, 2 = régulier, 3 = occasionnel. */
export type SegmentPriority = 1 | 2 | 3;
export type TargetSegment = { segment: PrescriberSegmentId; priority: SegmentPriority; reason: string };
export type TradeProfile = { id: string; label: string; keywords: string[]; targets: TargetSegment[] };

const t = (segment: PrescriberSegmentId, priority: SegmentPriority, reason: string): TargetSegment => ({ segment, priority, reason });

export const TRADE_PROFILES: TradeProfile[] = [
  {
    id: "roofer", label: "Couvreur / charpentier", keywords: ["couvreur", "couverture", "toiture", "toit", "charpent", "zinguer", "etancheite"],
    targets: [
      t("property_managers", 1, "Les syndics commandent l'entretien et la réfection des toitures de copropriétés."),
      t("architects", 1, "Les architectes prescrivent l'entreprise de couverture en neuf et en rénovation."),
      t("real_estate_agencies", 2, "Les agences gèrent des biens loués et orientent vendeurs et acquéreurs vers des artisans."),
      t("loss_adjusters", 2, "Les experts missionnent des réparations après tempête, grêle ou dégât des eaux."),
      t("insurance", 2, "Les agents d'assurance recommandent des artisans à leurs assurés sinistrés."),
      t("engineering", 2, "Les maîtres d'œuvre consultent les couvreurs pour leurs chantiers."),
      t("developers", 3, "Les promoteurs sous-traitent le lot couverture."),
      t("home_builders", 3, "Les constructeurs de maisons sous-traitent la couverture."),
      t("social_landlords", 3, "Les gestionnaires de logements entretiennent leur parc."),
      t("finishing_trades", 3, "Les autres corps d'état se recommandent mutuellement sur les chantiers."),
    ],
  },
  {
    id: "plumber", label: "Plombier / chauffagiste", keywords: ["plomb", "chauffag", "sanitaire", "climatis", "pompe a chaleur", "chaudiere"],
    targets: [
      t("property_managers", 1, "Les syndics gèrent fuites, colonnes et chaufferies collectives."),
      t("real_estate_agencies", 1, "Les agences gérant de la location ont des interventions récurrentes."),
      t("insurance", 2, "Les dégâts des eaux génèrent des recommandations d'artisans."),
      t("loss_adjusters", 2, "Les experts missionnent recherches de fuite et réparations."),
      t("architects", 2, "Les architectes prescrivent les lots plomberie et chauffage."),
      t("kitchen_retail", 2, "Les cuisinistes cherchent des plombiers pour leurs poses."),
      t("social_landlords", 3, "Entretien de parc locatif."),
      t("hospitality", 3, "Hôtels et restaurants ont des besoins de maintenance."),
    ],
  },
  {
    id: "electrician", label: "Électricien", keywords: ["electric", "domotique", "borne de recharge", "irve"],
    targets: [
      t("property_managers", 1, "Parties communes, éclairage, bornes de recharge en copropriété."),
      t("real_estate_agencies", 1, "Mises aux normes avant location ou vente."),
      t("diagnostics", 2, "Les diagnostics électriques révèlent des travaux à réaliser."),
      t("architects", 2, "Prescription du lot électricité."),
      t("engineering", 2, "Bureaux d'études et maîtres d'œuvre."),
      t("hospitality", 3, "Maintenance des établissements recevant du public."),
    ],
  },
  {
    id: "painter", label: "Peintre / plaquiste / menuisier", keywords: ["peint", "platr", "plaquiste", "menuis", "decorat", "revetement", "sol"],
    targets: [
      t("real_estate_agencies", 1, "Remise en état entre deux locations ou avant une vente."),
      t("property_managers", 1, "Parties communes et ravalements en copropriété."),
      t("architects", 2, "Prescription des lots de second œuvre."),
      t("insurance", 2, "Remise en état après sinistre."),
      t("loss_adjusters", 2, "Réparations après dégât des eaux ou incendie."),
      t("hospitality", 3, "Rénovation d'hôtels et restaurants."),
    ],
  },
  {
    id: "mason", label: "Maçon / rénovation générale", keywords: ["macon", "renovation", "gros oeuvre", "batiment", "ravalement", "facade"],
    targets: [
      t("architects", 1, "Prescription du gros œuvre et des rénovations lourdes."),
      t("engineering", 1, "Maîtres d'œuvre et bureaux d'études structure."),
      t("property_managers", 1, "Ravalements et travaux de structure en copropriété."),
      t("real_estate_agencies", 2, "Acquéreurs ayant un projet de travaux."),
      t("developers", 2, "Sous-traitance de lots de maçonnerie."),
      t("home_builders", 2, "Sous-traitance de gros œuvre."),
    ],
  },
  {
    id: "landscaper", label: "Paysagiste / jardinier", keywords: ["paysag", "jardin", "espaces verts", "elagage"],
    targets: [
      t("property_managers", 1, "Entretien des espaces verts de copropriétés."),
      t("social_landlords", 2, "Entretien des résidences."),
      t("real_estate_agencies", 2, "Remise en état de jardins avant vente ou location."),
      t("architects", 2, "Aménagements extérieurs des projets."),
      t("hospitality", 3, "Hôtels avec espaces extérieurs."),
    ],
  },
  {
    id: "cleaning", label: "Nettoyage / entretien", keywords: ["nettoyage", "proprete", "entretien de locaux", "menage"],
    targets: [
      t("property_managers", 1, "Contrats d'entretien des parties communes."),
      t("real_estate_agencies", 1, "Nettoyage de fin de chantier ou entre deux locations."),
      t("hospitality", 2, "Besoins réguliers de nettoyage."),
      t("developers", 3, "Nettoyage de livraison de programmes neufs."),
    ],
  },
];

/** Profil générique quand le métier n'est pas reconnu : prescripteurs habitat. */
export const GENERIC_TRADE_PROFILE: TradeProfile = {
  id: "generic", label: "Métier non reconnu (cibles génériques habitat)", keywords: [],
  targets: [
    t("property_managers", 2, "Les syndics recommandent des prestataires aux copropriétés."),
    t("real_estate_agencies", 2, "Les agences orientent leurs clients vers des professionnels locaux."),
    t("architects", 3, "Les architectes prescrivent des entreprises sur leurs projets."),
  ],
};

export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Retourne le profil métier correspondant à l'activité libre d'un client. */
export function resolveTradeProfile(activity: string | null | undefined): TradeProfile {
  const text = normalizeText(activity ?? "");
  if (!text) return GENERIC_TRADE_PROFILE;
  let best: { profile: TradeProfile; hits: number } | null = null;
  for (const profile of TRADE_PROFILES) {
    const hits = profile.keywords.filter((k) => text.includes(normalizeText(k))).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { profile, hits };
  }
  return best?.profile ?? GENERIC_TRADE_PROFILE;
}

export function segmentForNaf(naf: string | null | undefined): PrescriberSegment | null {
  if (!naf) return null;
  return Object.values(PRESCRIBER_SEGMENTS).find((s) => s.nafCodes.includes(naf)) ?? null;
}
