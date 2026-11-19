import { DOMAIN_STATUS } from "@/lib/emailing/sender";
import { dmarcRecord, type ProspectingSender } from "@/lib/acquisition/prospecting-sender";
import { checkProspectingSenderAction, saveProspectingSenderAction } from "@/app/(cockpit)/acquisition/actions";

const input = "mt-1 w-full rounded-lg border border-border bg-surface-raised p-2";
const button = "rounded-lg px-3 py-2 text-sm font-semibold";

// Expéditeur de prospection d'un espace : domaine DÉDIÉ (jamais le domaine principal), vérifié chez Resend,
// mention légale (raison sociale, adresse, confidentialité) reprise dans chaque message.
export function ProspectingSenderPanel({ workspaceId, label, sender, ready }: { workspaceId: string; label: string; sender: ProspectingSender | null; ready: boolean }) {
  if (!ready) return <p className="py-6 text-sm text-warning">Migration 20261218000000_acquisition_prospecting_sender à appliquer pour configurer l&apos;expéditeur de prospection.</p>;
  const status = sender?.domain_status ?? "not_started";
  const tone = status === "verified" ? "text-success" : status === "failed" ? "text-danger" : "text-warning";
  const [local] = (sender?.address ?? "contact@").split("@");
  const dmarc = sender?.sending_domain ? dmarcRecord(sender.sending_domain) : null;
  return <div className="space-y-4 text-sm">
    <div className="rounded-lg border border-border-strong bg-surface-raised p-3">
      <p className="font-medium">Domaine dédié obligatoire</p>
      <p className="mt-1 text-xs text-muted">La prospection ne part jamais du domaine principal (site, rapports, newsletters) : en cas de plaintes ou de rebonds, seul le domaine de prospection est touché. Recommandé : un domaine séparé (ex. code-v-pro.fr) ; un sous-domaine (ex. contact.code-v.fr) est accepté mais protège moins.</p>
    </div>
    <form action={saveProspectingSenderAction} className="grid gap-2 sm:grid-cols-2"><input type="hidden" name="workspace_id" value={workspaceId} />
      <label className="block">Nom affiché<input name="from_name" required maxLength={80} defaultValue={sender?.from_name ?? label} className={input} /></label>
      <label className="block">Domaine d&apos;envoi dédié<input name="sending_domain" required defaultValue={sender?.sending_domain ?? ""} placeholder="code-v-pro.fr" className={input} /></label>
      <label className="block">Adresse (avant @)<input name="from_local_part" required defaultValue={local || "contact"} className={input} /></label>
      <label className="block">Réponses envoyées à (facultatif)<input name="reply_to" type="email" defaultValue={sender?.reply_to ?? ""} placeholder="vide = adresse d'envoi (conseillé)" className={input} /></label>
      <label className="block">Raison sociale (mention légale)<input name="legal_name" required maxLength={160} defaultValue={sender?.legal_name ?? ""} className={input} /></label>
      <label className="block">Adresse postale (mention légale)<input name="legal_address" required maxLength={240} defaultValue={sender?.legal_address ?? ""} className={input} /></label>
      <label className="block sm:col-span-2">Politique de confidentialité (facultatif)<input name="privacy_url" type="url" defaultValue={sender?.privacy_url ?? ""} placeholder="https://…/confidentialite" className={input} /></label>
      <p className="text-xs text-muted sm:col-span-2">Laissez « Réponses envoyées à » vide et activez la réception sur ce domaine dans Resend (enregistrement MX de réception) : les réponses arrivent alors dans l&apos;onglet E-mails, un « STOP » exclut l&apos;adresse et toute réponse annule la relance. Une autre adresse de réponse empêche ce traitement automatique.</p>
      <div className="sm:col-span-2"><button className={`${button} border border-border`}>Enregistrer l&apos;expéditeur</button></div>
    </form>
    {sender?.sending_domain && <div className="border-t border-border pt-3">
      <p>Domaine <strong>{sender.sending_domain}</strong> : <span className={`font-semibold ${tone}`}>{DOMAIN_STATUS[status]}</span>
        {sender.domain_checked_at && <span className="text-xs text-muted"> · contrôlé le {new Date(sender.domain_checked_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</span>}</p>
      <p className="text-xs text-muted">Adresse d&apos;envoi : {sender.address}{sender.status === "ready" ? " · prête" : " · pas encore utilisable"}</p>
      {status !== "verified" && <form action={checkProspectingSenderAction} className="mt-2"><input type="hidden" name="workspace_id" value={workspaceId} />
        <button className={`${button} bg-accent-strong text-accent-foreground`}>{sender.provider_domain_id ? "Relancer la vérification" : "Vérifier le domaine"}</button></form>}
      {(sender.dns_records.length > 0 || dmarc) && <details className="mt-3" open={status !== "verified"}>
        <summary className="cursor-pointer text-accent">Enregistrements DNS à créer chez le registrar du domaine</summary>
        <ul className="mt-2 space-y-2 text-xs">{sender.dns_records.map((r, i) => <li key={i} className="rounded-lg border border-border p-2">
          <p className="font-semibold">{r.record} · {r.type}{r.priority !== null ? ` · priorité ${r.priority}` : ""} <span className={r.status === "verified" ? "text-success" : "text-muted"}>({DOMAIN_STATUS[r.status]})</span></p>
          <p className="mt-1">Nom : <code className="break-all">{r.name}</code></p>
          <p>Valeur : <code className="break-all">{r.value}</code></p>
        </li>)}
        {dmarc && <li className="rounded-lg border border-border p-2">
          <p className="font-semibold">DMARC · TXT <span className="text-muted">(conseillé, non contrôlé par Resend)</span></p>
          <p className="mt-1">Nom : <code className="break-all">{dmarc.name}</code></p>
          <p>Valeur : <code className="break-all">{dmarc.value}</code></p>
          <p className="mt-1 text-muted">Après 4 semaines sans problème, passer à <code>p=quarantine</code>.</p>
        </li>}</ul>
      </details>}
    </div>}
  </div>;
}
