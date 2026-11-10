import { readUnsubscribeToken } from "@/lib/emailing/policy";
import { unsubscribe } from "@/lib/emailing/service";
export const runtime = "nodejs";

// Désabonnement public, sans connexion : le jeton signé ne permet que de désabonner son adresse, pour un seul
// expéditeur. GET affiche une confirmation (les antivirus de messagerie ouvrent les liens : jamais de désabonnement
// sur un simple GET) ; POST désabonne, depuis ce formulaire ou depuis le bouton « Se désabonner » de la messagerie
// (RFC 8058, corps « List-Unsubscribe=One-Click »).
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, content: string, status = 200) => new Response(
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>`
  + `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5}button{font:inherit;padding:.6rem 1.2rem;cursor:pointer}</style></head>`
  + `<body><h1>${title}</h1>${content}</body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
const invalid = () => page("Lien invalide", "<p>Ce lien de désabonnement n’est pas valide. Répondez simplement à l’e-mail reçu pour demander votre désabonnement.</p>", 400);

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const parsed = readUnsubscribeToken(token);
  if (!parsed) return invalid();
  return page("Se désabonner", `<p>Vous ne recevrez plus nos e-mails à l’adresse <strong>${escape(parsed.email)}</strong>.</p>`
    + `<form method="post" action="?t=${escape(token!)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Confirmer le désabonnement</button></form>`);
}

export async function POST(request: Request) {
  const parsed = readUnsubscribeToken(new URL(request.url).searchParams.get("t"));
  if (!parsed) return invalid();
  // Formulaire de cette page : navigation du navigateur ; sinon, bouton un clic de la messagerie.
  const source = request.headers.get("sec-fetch-mode") === "navigate" ? "link" : "one_click";
  try { await unsubscribe(parsed.email, parsed.target, source); }
  catch { console.error("[email] Désabonnement non enregistré."); return page("Erreur temporaire", "<p>Le désabonnement n’a pas pu être enregistré. Réessayez dans quelques minutes.</p>", 503); }
  return page("Désabonnement confirmé", `<p>L’adresse <strong>${escape(parsed.email)}</strong> ne recevra plus nos e-mails.</p>`);
}
