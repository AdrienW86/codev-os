import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients/data";
import { getNewsletterView } from "@/lib/emailing/newsletter-service";
import { CONSENT_BASES } from "@/lib/emailing/contacts";
import { auditNewsletter, renderNewsletter } from "@/lib/emailing/newsletter";
import { approveNewsletterAction, cancelNewsletterAction, generateNewsletterAction, importContactsAction, sendNewsletterAction } from "./actions";

export const metadata: Metadata = { title: "Newsletters" };

const STATUS: Record<string, string> = { draft: "Brouillon", approved: "Approuvée", sending: "Envoi en cours", sent: "Envoyée", cancelled: "Annulée" };
const button = "rounded-lg px-3 py-2 text-sm font-semibold";

export default async function EmailingPage({ searchParams }: { searchParams: Promise<{ client?: string; msg?: string; ok?: string }> }) {
  await requireAdmin();
  const clients = await listClients();
  const { client, msg, ok } = await searchParams;
  const selected = clients.find((c) => c.id === client) ?? null;
  const view = selected ? await getNewsletterView(selected.id).catch(() => null) : null;

  return <>
    <PageHeading eyebrow="Emailing" title="Newsletters" description="L'Agent Newsletter rédige à partir des articles publiés et des prestations du client. Rien ne part sans votre approbation." />
    <form className="mb-6 flex flex-wrap items-end gap-3" action="/emailing">
      <label className="text-sm">Client<br />
        <select name="client" defaultValue={selected?.id ?? ""} className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <option value="">Choisir…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <button type="submit" className={`${button} border border-border`}>Ouvrir</button>
    </form>
    {msg && <p className={`mb-4 rounded-lg border border-border p-3 text-sm ${ok === "1" ? "text-success" : "text-danger"}`}>{msg}</p>}
    {!selected ? <p className="text-sm text-muted">Choisissez un client.</p> : !view ? <p className="text-sm text-danger">Lecture impossible.</p> : !view.ready ?
      <p className="text-sm text-warning">Migration 20261206000000_email_newsletters à appliquer.</p> : <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <Panel className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Nouvelle newsletter</h2>
              <p className="text-sm text-muted">{view.sources.length} source(s) citable(s) · {view.contacts.subscribed} abonné(s). Meilleur créneau d&apos;envoi : mardi ou jeudi, entre 9 h et 10 h.</p>
            </div>
            <form action={generateNewsletterAction}><input type="hidden" name="client_id" value={selected.id} />
              <button type="submit" disabled={!view.sources.length} className={`${button} bg-accent-strong text-accent-foreground disabled:opacity-50`}>Rédiger la newsletter</button></form>
          </div>
          {!view.sending.enabled && <p className="mt-2 text-xs text-warning">{view.sending.reason}</p>}
        </Panel>
        {view.newsletters.length === 0 && <p className="text-sm text-muted">Aucune newsletter pour ce client.</p>}
        {view.newsletters.map((n) => {
          const audit = n.audit?.score !== undefined ? n.audit : auditNewsletter(n.content);
          const preview = renderNewsletter(n.content, { brand: selected.name, unsubscribeUrl: "https://exemple.invalid/desabonnement" });
          const tone = (audit.score ?? 0) >= 80 ? "text-success" : (audit.score ?? 0) >= 60 ? "text-warning" : "text-danger";
          return <Panel key={n.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h3 className="font-semibold">{n.subject}</h3><p className="text-xs text-muted">{n.preheader}</p></div>
              <span className="text-xs text-muted">{STATUS[n.status] ?? n.status} · {new Date(n.created_at).toLocaleDateString("fr-FR")}</span>
            </div>
            <p className="mt-2 text-xs"><span className={`font-semibold ${tone}`}>Qualité {audit.score}/100</span> <span className="text-muted">· {audit.words} mots</span></p>
            {(audit.issues ?? []).length > 0 && <ul className="mt-1 space-y-0.5 text-xs">{(audit.issues ?? []).map((i) => <li key={i.code} className={i.level === "warning" ? "text-warning" : "text-muted"}>{i.message}</li>)}</ul>}
            <details className="mt-3"><summary className="cursor-pointer text-sm text-accent">Aperçu</summary>
              <iframe title={`Aperçu ${n.subject}`} sandbox="" srcDoc={preview.html} className="mt-2 h-[520px] w-full rounded-lg border border-border bg-surface" />
            </details>
            {(n.status === "sending" || n.status === "sent") && <p className="mt-2 text-xs text-muted">{n.sent_count} envoyé(s) · {n.failed_count} échec(s) · {n.skipped_count} exclu(s)</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {n.status === "draft" && <form action={approveNewsletterAction}><input type="hidden" name="client_id" value={selected.id} /><input type="hidden" name="id" value={n.id} /><button className={`${button} bg-accent-strong text-accent-foreground`}>Approuver</button></form>}
              {(n.status === "approved" || n.status === "sending") && <form action={sendNewsletterAction} className="flex items-center gap-2"><input type="hidden" name="client_id" value={selected.id} /><input type="hidden" name="id" value={n.id} />
                <label className="text-xs"><input type="checkbox" name="confirm" className="mr-1" />J&apos;envoie à {view.contacts.subscribed} abonné(s)</label>
                <button disabled={!view.sending.enabled} className={`${button} bg-accent-strong text-accent-foreground disabled:opacity-50`}>{n.status === "sending" ? "Continuer l'envoi" : "Envoyer"}</button></form>}
              {(n.status === "draft" || n.status === "approved") && <form action={cancelNewsletterAction}><input type="hidden" name="client_id" value={selected.id} /><input type="hidden" name="id" value={n.id} /><button className={`${button} border border-border`}>Annuler</button></form>}
            </div>
          </Panel>;
        })}
      </div>
      <div className="space-y-4">
        <Panel className="p-4">
          <h2 className="font-semibold">Sources citables</h2>
          {view.sources.length === 0 ? <p className="mt-1 text-sm text-muted">Aucune : publiez un article (<Link href="/blog" className="text-accent">Agent Blog</Link>) ou confirmez les prestations du client.</p> :
            <ul className="mt-2 space-y-1 text-sm">{view.sources.map((s, i) => <li key={i}>{s.kind === "article" ? "Article" : "Prestation"} : {s.title}</li>)}</ul>}
        </Panel>
        <Panel className="p-4">
          <h2 className="font-semibold">Contacts</h2>
          <p className="text-sm text-muted">{view.contacts.subscribed} abonné(s), {view.contacts.other} désabonné(s) ou exclu(s).</p>
          <form action={importContactsAction} className="mt-3 space-y-2 text-sm"><input type="hidden" name="client_id" value={selected.id} />
            <textarea name="emails" rows={5} required placeholder="Une adresse par ligne" className="w-full rounded-lg border border-border bg-surface p-2" />
            <select name="basis" required defaultValue="" className="w-full rounded-lg border border-border bg-surface p-2"><option value="" disabled>Base légale du consentement</option>{CONSENT_BASES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
            <input name="source" required minLength={2} maxLength={300} placeholder="Origine (ex. formulaire du site)" className="w-full rounded-lg border border-border bg-surface p-2" />
            <button className={`${button} border border-border`}>Ajouter les contacts</button>
            <p className="text-xs text-muted">Seules les adresses dont le consentement est prouvable doivent être ajoutées. Les désabonnements et rebonds sont exclus automatiquement.</p>
          </form>
        </Panel>
      </div>
    </div>}
  </>;
}
