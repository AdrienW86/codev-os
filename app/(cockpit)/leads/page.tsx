import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients/data";
import { getLeadsView, type LeadMessageRow, type LeadRow } from "@/lib/leads/service";
import { LEAD_SOURCE_LABELS, LEAD_STATES, LEAD_STATE_LABELS, MANUAL_STATES, SCORE_LABELS, URGENCY_LABELS, formSnippet, isLeadState, type LeadState, type Score, type Urgency } from "@/lib/leads/model";
import { addManualLeadAction, cancelLeadMessageAction, retryLeadAction, rotateFormKeyAction, saveLeadSettingsAction, sendLeadMessageAction, setLeadStateAction } from "./actions";

export const metadata: Metadata = { title: "Demandes de devis" };

const button = "rounded-lg px-3 py-2 text-sm font-semibold";
const input = "w-full rounded-lg border border-border bg-surface p-2 text-sm";
const when = (value: string | null) => (value ? new Date(value).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }) : "—");
const tone = (state: LeadState) => state === "ready" || state === "new" ? "text-warning" : state === "won" || state === "answered" ? "text-success" : state === "spam" || state === "lost" ? "text-muted" : "text-accent";
const MANUAL_LABELS: Partial<Record<LeadState, string>> = { answered: "Le prospect a répondu", won: "Gagnée", lost: "Perdue", closed: "Clore", spam: "Indésirable" };
const KIND_LABELS: Record<LeadMessageRow["kind"], string> = { first_reply: "Première réponse", followup: "Relance", notify: "Alerte à l’artisan", inbound: "Réponse du prospect" };
const MESSAGE_STATE: Record<LeadMessageRow["state"], string> = { draft: "à valider", approved: "approuvé", sending: "envoi en cours", sent: "envoyé", failed: "échec d’envoi", cancelled: "annulé", received: "reçu" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ client?: string; msg?: string; ok?: string; state?: string }> }) {
  await requireAdmin();
  const clients = await listClients();
  const { client, msg, ok, state } = await searchParams;
  const selected = clients.find((c) => c.id === client) ?? null;
  const filter = isLeadState(state) ? state : undefined;
  const view = selected ? await getLeadsView(selected.id, { state: filter }).catch(() => null) : null;

  return <>
    <PageHeading eyebrow="Agent Leads" title="Demandes de devis" description="Chaque demande reçue est qualifiée en quelques minutes, une réponse est préparée et l’artisan est prévenu. Rien ne part sans votre validation, sauf pour les clients en réponse automatique." />
    <form className="mb-6 flex flex-wrap items-end gap-3" action="/leads">
      <label className="text-sm">Client<br />
        <select name="client" defaultValue={selected?.id ?? ""} className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <option value="">Choisir…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <button type="submit" className={`${button} border border-border`}>Ouvrir</button>
    </form>
    {msg && <p role="status" className={`mb-4 rounded-lg border border-border p-3 text-sm ${ok === "1" ? "text-success" : "text-danger"}`}>{msg}</p>}
    {!selected ? <p className="text-sm text-muted">Choisissez un client.</p> : !view ? <p className="text-sm text-danger">Lecture impossible.</p> : !view.ready ?
      <p className="text-sm text-warning">Migration 20261229000000_leads_agent à appliquer.</p> : <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        <nav aria-label="Filtrer par statut" className="flex flex-wrap gap-2 text-sm">
          <Link href={`/leads?client=${selected.id}`} className={`rounded-full border border-border px-3 py-1 ${!filter ? "font-semibold text-accent" : ""}`}>Toutes</Link>
          {LEAD_STATES.filter((s) => view.counts[s] > 0 || s === "ready").map((s) => <Link key={s} href={`/leads?client=${selected.id}&state=${s}`} className={`rounded-full border border-border px-3 py-1 ${filter === s ? "font-semibold text-accent" : ""}`}>{LEAD_STATE_LABELS[s]} ({view.counts[s]})</Link>)}
        </nav>
        {!view.sending.enabled && <p className="text-xs text-warning">{view.sending.reason}</p>}
        {!view.aiReady && <p className="text-xs text-muted">IA non configurée : qualification par règles et réponses types.</p>}
        {view.leads.length === 0 && <p className="text-sm text-muted">Aucune demande{filter ? " dans ce statut" : ""}.</p>}
        {view.leads.map((lead) => <LeadCard key={lead.id} lead={lead} clientId={selected.id} messages={view.messages.filter((m) => m.lead_id === lead.id)} sendingEnabled={view.sending.enabled} />)}
      </div>
      <div className="min-w-0 space-y-4">
        <Panel className="p-4">
          <h2 id="reglages" className="font-semibold">Réglages du client</h2>
          <form action={saveLeadSettingsAction} className="mt-3 space-y-2 text-sm"><input type="hidden" name="client_id" value={selected.id} />
            <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={view.settings?.enabled ?? false} />Agent actif pour ce client</label>
            <label className="flex items-start gap-2"><input type="checkbox" name="auto_reply" className="mt-1" defaultChecked={view.settings?.auto_reply ?? false} /><span>Réponse automatique<br /><span className="text-xs text-muted">La première réponse et les relances partent sans validation (contrôle anti-invention toujours appliqué).</span></span></label>
            <label className="block">Relances si le prospect ne répond pas
              <select name="followups" defaultValue={String(view.settings?.followups ?? 2)} className={`${input} mt-1`}><option value="0">Aucune</option><option value="1">Une (2 jours ouvrés après)</option><option value="2">Deux (2 puis 3 jours ouvrés)</option></select></label>
            <label className="block">E-mail de l’artisan prévenu à chaque demande<input name="notify_email" type="email" defaultValue={view.settings?.notify_email ?? ""} className={`${input} mt-1`} /></label>
            <label className="block">Adresse de réponse (si pas d’adresse de réception)<input name="reply_to" type="email" defaultValue={view.settings?.reply_to ?? ""} className={`${input} mt-1`} /></label>
            <label className="block">Engagement de rappel confirmé par le client<input name="callback_promise" maxLength={120} placeholder="ex. sous 24 h ouvrées" defaultValue={view.settings?.callback_promise ?? ""} className={`${input} mt-1`} />
              <span className="text-xs text-muted">Vide : aucun délai n’est promis.</span></label>
            <label className="block">Téléphone affiché<input name="phone" type="tel" defaultValue={view.settings?.phone ?? ""} className={`${input} mt-1`} /></label>
            <label className="block">Signature<textarea name="signature" rows={2} maxLength={300} defaultValue={view.settings?.signature ?? ""} className={`${input} mt-1`} /></label>
            <label className="block">Sites autorisés à envoyer le formulaire<textarea name="allowed_origins" rows={2} placeholder="https://www.client.fr" defaultValue={(view.settings?.allowed_origins ?? []).join("\n")} className={`${input} mt-1`} /></label>
            <button className={`${button} bg-accent-strong text-accent-foreground`}>Enregistrer</button>
          </form>
        </Panel>
        {view.settings && <Panel className="p-4">
          <h2 className="font-semibold">Relier le formulaire du site</h2>
          {view.endpoint ? <>
            <p className="mt-1 text-xs text-muted">Adresse d’envoi du formulaire (POST, JSON ou formulaire classique) :</p>
            <code className="mt-1 block break-all rounded bg-surface-sunken p-2 text-xs">{view.endpoint}</code>
            <details className="mt-2"><summary className="cursor-pointer text-sm text-accent">Formulaire prêt à coller</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-sunken p-2 text-xs">{formSnippet(view.endpoint)}</pre></details>
          </> : <p className="mt-1 text-xs text-warning">Adresse publique du cockpit (PUBLICATIONS_OAUTH_BASE_URL) manquante : adresse du formulaire indisponible.</p>}
          <p className="mt-3 text-xs text-muted">{view.inbound ? <>Adresse de réception (demandes transférées et réponses des prospects) : <strong className="break-all">{view.inbound}</strong></> : "Adresse de réception non configurée (LEADS_INBOUND_DOMAIN) : les réponses des prospects arrivent directement chez l’artisan."}</p>
          {!view.senderVerified && <p className="mt-2 text-xs text-muted">Domaine d’envoi du client non vérifié : les réponses partent de l’adresse commune, au nom du client (<Link className="text-accent" href={`/emailing?client=${selected.id}`}>vérifier le domaine</Link>).</p>}
          <form action={rotateFormKeyAction} className="mt-3 flex flex-wrap items-center gap-2 text-xs"><input type="hidden" name="client_id" value={selected.id} />
            <label><input type="checkbox" name="confirm" className="mr-1" />Changer la clé (formulaire volé ou spammé)</label>
            <button className={`${button} border border-border`}>Nouvelle clé</button></form>
        </Panel>}
        <Panel className="p-4">
          <h2 className="font-semibold">Ajouter une demande</h2>
          <p className="text-xs text-muted">Appel téléphonique, message reçu ailleurs : même traitement qu’une demande du site.</p>
          <form action={addManualLeadAction} className="mt-2 space-y-2 text-sm"><input type="hidden" name="client_id" value={selected.id} />
            <input name="name" placeholder="Nom" className={input} />
            <input name="email" type="email" placeholder="E-mail" className={input} />
            <input name="phone" type="tel" placeholder="Téléphone" className={input} />
            <div className="flex gap-2"><input name="postcode" placeholder="Code postal" inputMode="numeric" maxLength={5} className={input} /><input name="city" placeholder="Ville" className={input} /></div>
            <input name="subject" placeholder="Objet" className={input} />
            <textarea name="message" required rows={4} placeholder="Besoin du prospect" className={input} />
            <button className={`${button} border border-border`}>Ajouter et qualifier</button>
          </form>
        </Panel>
      </div>
    </div>}
  </>;
}

function LeadCard({ lead, clientId, messages, sendingEnabled }: { lead: LeadRow; clientId: string; messages: LeadMessageRow[]; sendingEnabled: boolean }) {
  const q = lead.qualification ?? {};
  const location = [lead.postcode, lead.city].filter(Boolean).join(" ") || q.location || null;
  const drafts = messages.filter((m) => m.direction === "out" && m.kind !== "notify" && ["draft", "failed"].includes(m.state));
  const history = messages.filter((m) => !drafts.includes(m));
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  return <Panel className="p-4">
    <article id={`lead-${lead.id}`} className="scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{lead.contact_name ?? "Sans nom"}{lead.service ? <span className="font-normal text-muted"> · {lead.service}</span> : null}</h3>
          <p className="break-all text-xs text-muted">{[lead.contact_phone, lead.contact_email, location].filter(Boolean).join(" · ") || "Aucune coordonnée"}</p>
        </div>
        <span className={`text-xs font-semibold ${tone(lead.state)}`}>{LEAD_STATE_LABELS[lead.state]}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{LEAD_SOURCE_LABELS[lead.source]} · reçue le {when(lead.received_at)}{lead.first_reply_at ? ` · répondu le ${when(lead.first_reply_at)}` : ""}{lead.next_followup_at ? ` · relance prévue le ${when(lead.next_followup_at)}` : ""}</p>
      {(lead.urgency || lead.score) && <p className="mt-1 text-xs">{lead.urgency && <span className={lead.urgency === "urgent" ? "font-semibold text-danger" : ""}>{URGENCY_LABELS[lead.urgency as Urgency] ?? lead.urgency}</span>}{lead.score && <span className="text-muted"> · intérêt {SCORE_LABELS[lead.score as Score]?.toLowerCase() ?? lead.score}</span>}{lead.qualified_by && <span className="text-muted"> · qualifiée par {lead.qualified_by === "ai" ? "l’IA" : "règles"}</span>}</p>}
      {q.summary && <p className="mt-2 text-sm">{q.summary}</p>}
      {(q.questions?.length ?? 0) > 0 && <p className="mt-1 text-xs text-muted">À préciser : {q.questions!.join(" ; ")}</p>}
      <details className="mt-2"><summary className="cursor-pointer text-sm text-accent">Message reçu</summary>
        {lead.subject && <p className="mt-1 text-sm font-semibold">{lead.subject}</p>}
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{lead.message}</p>
        {(q.evidence?.length ?? 0) > 0 && <p className="mt-1 text-xs text-muted">Citations retenues : {q.evidence!.map((e) => `« ${e} »`).join(", ")}</p>}
      </details>
      {lead.state === "ready" && !lead.contact_email && <p className="mt-2 text-sm text-warning">Pas d’adresse e-mail : rappelez le prospect{lead.contact_phone ? ` au ${lead.contact_phone}` : ""}, puis indiquez la suite.</p>}
      {drafts.map((m) => <form key={m.id} action={sendLeadMessageAction} className="mt-3 space-y-2 rounded-lg border border-border p-3">
        {hidden("client_id", clientId)}{hidden("lead_id", lead.id)}{hidden("message_id", m.id)}
        <p className="text-xs font-semibold">{KIND_LABELS[m.kind]}{m.kind === "followup" ? ` ${m.step}` : ""} · {MESSAGE_STATE[m.state]}{m.draft_source === "ai" ? " · rédigée par l’IA (contrôlée)" : m.draft_source === "template" ? " · réponse type" : ""}{m.error ? ` (${m.error})` : ""}</p>
        <input name="subject" defaultValue={m.subject} maxLength={200} aria-label="Objet" className={input} />
        <textarea name="body" defaultValue={m.body} rows={9} aria-label="Message" className={input} />
        <div className="flex flex-wrap gap-2">
          <button disabled={!sendingEnabled} className={`${button} bg-accent-strong text-accent-foreground disabled:opacity-50`}>Envoyer à {m.recipient}</button>
          <button formAction={cancelLeadMessageAction} className={`${button} border border-border`}>Ne pas envoyer</button>
        </div>
      </form>)}
      {history.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-sm text-accent">Échanges ({history.length})</summary>
        <ul className="mt-2 space-y-2">{history.map((m) => <li key={m.id} className="rounded-lg border border-border p-2 text-xs">
          <p className="font-semibold">{KIND_LABELS[m.kind]}{m.kind === "followup" ? ` ${m.step}` : ""} · {MESSAGE_STATE[m.state]} · {when(m.sent_at ?? m.created_at)}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-muted">{m.body.slice(0, 1500)}</p>
        </li>)}</ul></details>}
      <div className="mt-3 flex flex-wrap gap-2">
        {lead.state === "new" && <form action={retryLeadAction}>{hidden("client_id", clientId)}{hidden("lead_id", lead.id)}<button className={`${button} border border-border`}>Qualifier maintenant</button></form>}
        {MANUAL_STATES.filter((s) => s !== lead.state).map((s) => <form key={s} action={setLeadStateAction}>{hidden("client_id", clientId)}{hidden("lead_id", lead.id)}{hidden("state", s)}
          <button className="rounded-lg border border-border px-2 py-1 text-xs">{MANUAL_LABELS[s]}</button></form>)}
      </div>
    </article>
  </Panel>;
}
