import { ACQUISITION_CATEGORIES, type AcquisitionCategory } from "./model";

export type VerifiedFact = { label: string; statement: string; sourceUrl: string; verifiedAt: string };
export type DraftInput = {
  category: AcquisitionCategory;
  companyName: string;
  facts: VerifiedFact[];
  senderName: string;
  senderCompany: string;
};
export type SuggestedDraft = { subject: string; body: string; evidence: VerifiedFact[] };

function clean(value: string, maxLength: number) {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0,maxLength);
}
function validFact(fact: VerifiedFact) {
  try {
    const source = new URL(fact.sourceUrl);
    return (source.protocol === "https:" || source.protocol === "http:") &&
      Boolean(source.hostname.includes(".")) && !source.username && !source.password &&
      Boolean(fact.statement.trim()) && Boolean(fact.verifiedAt) &&
      Number.isFinite(Date.parse(fact.verifiedAt));
  } catch { return false; }
}
/**
 * Deterministic suggestion, not an AI finding. No assertion about any defect or closure
 * unless explicitly supported by human-verified facts. Never dispatches a message.
 */
export function createAcquisitionDraft(input: DraftInput): SuggestedDraft | null {
  if (!ACQUISITION_CATEGORIES.some(c=>c.id===input.category)) return null;
  const company=clean(input.companyName,150);
  const sender=clean(input.senderName,100);
  const brand=clean(input.senderCompany,100);
  if(!company||!sender||!brand) return null;
  const verified=input.facts.filter(validFact).slice(0,3);
  if(!verified.length) return null;
  const subject = input.category==="agency_partner"
    ? `Proposition de collaboration — ${company}`
    : `Échange au sujet de ${company}`;
  const note=verified.map(f=>`- ${clean(f.statement,320)}`).join("\n");
  const activity = input.category==="agency_partner"
    ? "Je vous contacte pour explorer une éventuelle collaboration en développement web ou en automatisation."
    : "Je vous contacte pour voir si un accompagnement technique pourrait être utile à votre activité.";
  const body = `Bonjour,\n\n${activity}\n\nVoici les éléments publics que j'ai relevés et que je souhaite vérifier avec vous :\n${note}\n\nSeriez-vous disponible pour un bref échange, si le sujet vous intéresse ?\n\nBien cordialement,\n${sender}\n${brand}\n\nSi vous préférez ne plus recevoir de sollicitations de notre part, indiquez-le simplement en répondant à ce message.`;
  return {subject,body,evidence:verified};
}
