import { OPT_OUT_FOOTER } from "./outreach";
import { UNSUBSCRIBE_PATH, unsubscribeToken, type SuppressionScope } from "@/lib/emailing/policy";

// Message de prospection tel qu'il part (fonctions pures). Le brouillon relu garde sa courte mention d'opposition ;
// à l'envoi, elle est remplacée par la mention complète exigée en prospection B2B (CNIL, art. 14 RGPD, LCEN) :
// identité de l'expéditeur, origine de l'adresse, finalité, lien de désinscription en un clic, confidentialité.

type Env = Record<string, string | undefined>;
export type MailSender = { legalName: string; legalAddress: string; privacyUrl: string | null };

/** Lien de désinscription signé (même jeton que les en-têtes RFC 8058) ; null si la configuration manque. */
export function unsubscribeLink(email: string, target: SuppressionScope, baseUrl: string | null, env: Env = process.env): string | null {
  const token = unsubscribeToken(email, target, env);
  return token && baseUrl && /^https:\/\/[^/?#]+$/.test(baseUrl) ? `${baseUrl}${UNSUBSCRIBE_PATH}?t=${token}` : null;
}

/** Site d'où vient l'adresse (nom d'hôte seulement), pour l'information sur l'origine des données. */
export function sourceLabel(sourceUrl: string | null | undefined): string {
  try { const host = new URL(sourceUrl ?? "").hostname.replace(/^www\./, ""); return host === "openstreetmap.org" ? "OpenStreetMap (données publiques)" : host || "le site de votre entreprise"; }
  catch { return "le site de votre entreprise"; }
}

export function legalFooter(sender: MailSender, unsubscribeUrl: string, sourceUrl: string | null | undefined): string {
  return [
    "--",
    `${sender.legalName} · ${sender.legalAddress}`,
    `Votre adresse professionnelle provient de ${sourceLabel(sourceUrl)}. Elle sert uniquement à ce contact entre professionnels (intérêt légitime) et n'est jamais cédée.`,
    `Ne plus recevoir nos messages : ${unsubscribeUrl} (ou répondez « STOP »).`,
    ...(sender.privacyUrl ? [`Vos données et vos droits : ${sender.privacyUrl}`] : []),
  ].join("\n");
}

/** Corps envoyé : texte relu (sans la courte mention du brouillon) + mention complète. */
export function composeProspectingText(bodyText: string, sender: MailSender, unsubscribeUrl: string, sourceUrl: string | null | undefined): string {
  const main = bodyText.replace(OPT_OUT_FOOTER, "").trimEnd();
  return `${main}\n\n${legalFooter(sender, unsubscribeUrl, sourceUrl)}`.slice(0, 10_000);
}
