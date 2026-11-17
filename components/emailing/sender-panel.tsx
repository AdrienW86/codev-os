import { Panel } from "@/components/ui/primitives";
import { DOMAIN_STATUS } from "@/lib/emailing/sender";
import type { SenderView } from "@/lib/emailing/client-email-service";
import { checkDomainAction, saveSenderAction } from "@/app/(cockpit)/emailing/actions";

const input = "mt-1 w-full rounded-lg border border-border bg-surface p-2";
const button = "rounded-lg px-3 py-2 text-sm font-semibold";

// Expéditeur du client : nom, adresse sur son sous-domaine d'envoi, vérification du domaine chez Resend et
// enregistrements DNS à transmettre à l'hébergeur du client. Tant que le domaine n'est pas vérifié, l'envoi utilise
// l'adresse commune (EMAIL_FROM).
export function SenderPanel({ clientId, clientName, view }: { clientId: string; clientName: string; view: SenderView }) {
  if (!view.ready) return <Panel className="p-4"><h2 className="font-semibold">Expéditeur</h2><p className="mt-1 text-sm text-warning">Migration 20261213000000_client_email_settings à appliquer.</p></Panel>;
  const s = view.settings;
  const status = s?.domain_status ?? "not_started";
  const tone = status === "verified" ? "text-success" : status === "failed" ? "text-danger" : "text-warning";
  return <Panel className="p-4">
    <h2 className="font-semibold">Expéditeur</h2>
    <p className="mt-1 text-sm text-muted">{status === "verified" && s?.sending_domain
      ? <>Les newsletters partent au nom de <strong>{s.from_name}</strong> &lt;{s.from_local_part}@{s.sending_domain}&gt;.</>
      : "Tant que le domaine du client n'est pas vérifié, les newsletters partent depuis l'adresse commune de CODE-V."}</p>
    <form action={saveSenderAction} className="mt-3 space-y-2 text-sm"><input type="hidden" name="client_id" value={clientId} />
      <label className="block">Nom affiché<input name="from_name" required maxLength={80} defaultValue={s?.from_name ?? clientName} className={input} /></label>
      <label className="block">Domaine d&apos;envoi<input name="sending_domain" required defaultValue={s?.sending_domain ?? view.suggestedDomain ?? ""} placeholder="news.exemple.fr" className={input} /></label>
      <label className="block">Adresse (avant @)<input name="from_local_part" required defaultValue={s?.from_local_part ?? "newsletter"} className={input} /></label>
      <label className="block">Réponses envoyées à (facultatif)<input name="reply_to" type="email" defaultValue={s?.reply_to ?? ""} placeholder="contact@exemple.fr" className={input} /></label>
      <button className={`${button} border border-border`}>Enregistrer l&apos;expéditeur</button>
      <p className="text-xs text-muted">Un sous-domaine dédié (ex. news.) protège la réputation du domaine principal du client.</p>
    </form>
    {s?.sending_domain && <div className="mt-4 border-t border-border pt-3 text-sm">
      <p>Domaine <strong>{s.sending_domain}</strong> : <span className={`font-semibold ${tone}`}>{DOMAIN_STATUS[status]}</span>
        {s.domain_checked_at && <span className="text-xs text-muted"> · contrôlé le {new Date(s.domain_checked_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</span>}</p>
      {status !== "verified" && <form action={checkDomainAction} className="mt-2"><input type="hidden" name="client_id" value={clientId} />
        <button className={`${button} bg-accent-strong text-accent-foreground`}>{s.provider_domain_id ? "Relancer la vérification" : "Vérifier le domaine"}</button></form>}
      {s.dns_records.length > 0 && status !== "verified" && <details className="mt-3" open>
        <summary className="cursor-pointer text-accent">Enregistrements DNS à créer chez l&apos;hébergeur du client</summary>
        <ul className="mt-2 space-y-2 text-xs">{s.dns_records.map((r, i) => <li key={i} className="rounded-lg border border-border p-2">
          <p className="font-semibold">{r.record} · {r.type}{r.priority !== null ? ` · priorité ${r.priority}` : ""} <span className={r.status === "verified" ? "text-success" : "text-muted"}>({DOMAIN_STATUS[r.status]})</span></p>
          <p className="mt-1">Nom : <code className="break-all">{r.name}</code></p>
          <p>Valeur : <code className="break-all">{r.value}</code></p>
        </li>)}</ul>
        <p className="mt-2 text-xs text-muted">Ajoutez aussi un enregistrement DMARC (TXT <code>_dmarc</code>, valeur <code>v=DMARC1; p=none;</code>) s&apos;il n&apos;existe pas. La propagation peut prendre jusqu&apos;à 48 h.</p>
      </details>}
    </div>}
  </Panel>;
}
