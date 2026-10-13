import "server-only";

export type ConnectorHealth = {
  id: string; label: string; purpose: string; configured: boolean; usable: boolean;
  detail: string;
};

/** Readiness metadata only. Never probes remote mailboxes or sends any mail. */
export function getAcquisitionConnectorReadiness(): ConnectorHealth[] {
  const smtp = Boolean(process.env.ACQUISITION_SMTP_HOST && process.env.ACQUISITION_SMTP_PORT &&
    process.env.ACQUISITION_SMTP_USERNAME && process.env.ACQUISITION_SMTP_PASSWORD);
  const imap = Boolean(process.env.ACQUISITION_IMAP_HOST && process.env.ACQUISITION_IMAP_PORT &&
    process.env.ACQUISITION_IMAP_USERNAME && process.env.ACQUISITION_IMAP_PASSWORD);
  const discovery = Boolean(process.env.ACQUISITION_DISCOVERY_API_KEY);
  const ai = Boolean(process.env.OPENAI_API_KEY);
  return [
    {id:"smtp", label:"SMTP — Infomaniak / autre", purpose:"Envoi professionnel",configured:smtp,usable:false,detail:smtp?"Identifiants présents, connexion non encore testée ; envoi bloqué.":"Renseigner les variables SMTP côté serveur."},
    {id:"imap", label:"IMAP — boîte de réponses", purpose:"Synchronisation des réponses",configured:imap,usable:false,detail:imap?"Identifiants présents, connexion non encore testée.":"Renseigner les variables IMAP côté serveur."},
    {id:"discovery",label:"Recherche d'entreprises",purpose:"Sources autorisées et vérifiables",configured:discovery,usable:false,detail:discovery?"Clé présente ; moteur de recherche non connecté.":"Fournisseur de données et droits d'utilisation à définir."},
    {id:"ai",label:"OpenAI",purpose:"Qualification et rédaction",configured:ai,usable:false,detail:ai?"Clé OpenAI présente ; agent Acquisition non activé.":"OPENAI_API_KEY nécessaire."},
  ];
}
