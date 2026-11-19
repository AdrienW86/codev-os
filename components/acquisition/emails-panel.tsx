"use client";

import { useState } from "react";
import type { AcquisitionMessage, AcquisitionWorkspace } from "@/lib/acquisition/model";
import { auditOutreachDraft } from "@/lib/acquisition/outreach";
import { approveMessagesAction, cancelMessageAction, saveSendingSettingsAction, updateDraftAction } from "@/app/(cockpit)/acquisition/actions";

const STATE_LABELS: Record<string, string> = {
  draft: "Brouillon", approved: "Approuvé, en file", queued: "En file", sending: "Envoi en cours", sent: "Envoyé",
  failed: "Échec", cancelled: "Annulé", suppressed: "Écarté (exclusion)",
};
const CANCEL_REASONS: Record<string, string> = {
  admin: "annulé à la main", suppressed: "adresse exclue", undeliverable: "adresse non distribuable", prospect_stage: "entreprise déjà en réponse ou exclue",
  invalid_address: "adresse invalide", replied: "réponse reçue", stop: "demande de désinscription",
};
const input = "mt-1 w-full rounded-lg border border-border bg-surface-raised p-2 text-sm";
const button = "rounded-lg px-3 py-2 text-sm font-semibold";
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }) : "";

// Onglet E-mails : réglages d'envoi de l'espace (activation = confirmation cruciale), brouillons à relire, corriger et
// approuver (confirmation cruciale : nombre retapé), file d'envoi et historique.
export function EmailsPanel({ workspace, messages, companyOf, senderReady, sendingReady }: {
  workspace: AcquisitionWorkspace; messages: AcquisitionMessage[]; companyOf: Map<string, string>; senderReady: boolean; sendingReady: boolean;
}) {
  const drafts = messages.filter((m) => m.state === "draft");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const active = workspace.sending_enabled && !workspace.emergency_stop;
  return <div className="space-y-5 text-sm">
    <section className="rounded-lg border border-border p-3">
      <h3 className="font-medium">Envois de cet espace : <span className={active ? "text-success" : "text-warning"}>{active ? "actifs" : "arrêtés"}</span></h3>
      {workspace.send_paused_reason && <p className="mt-1 text-danger">Arrêt automatique le {date(workspace.send_paused_at)} : {workspace.send_paused_reason}. Vérifiez la liste et le domaine avant de relancer.</p>}
      <p className="mt-1 text-xs text-muted">Envoi du lundi au vendredi, 9 h – 11 h 30 et 14 h – 16 h 30 (hors fériés), 3 messages au plus par quart d&apos;heure. Préchauffage du domaine : 10 par jour la 1re semaine, 20 la 2e, 35 la 3e, puis 50 au plus. Arrêt automatique sur une plainte ou plus de 3 % de rebonds.</p>
      {!sendingReady ? <p className="mt-2 text-warning">Migration 20261220000000_acquisition_sending à appliquer.</p> : active
        ? <form action={saveSendingSettingsAction} className="mt-2"><input type="hidden" name="workspace_id" value={workspace.id} /><input type="hidden" name="mode" value="stop" />
          <input type="hidden" name="daily_limit" value={workspace.daily_send_limit} />
          <button className={`${button} border border-danger text-danger`}>Arrêter tous les envois maintenant</button> <span className="text-xs text-muted">Quota : {workspace.daily_send_limit}/jour</span></form>
        : <form action={saveSendingSettingsAction} className="mt-2 flex flex-wrap items-end gap-3"><input type="hidden" name="workspace_id" value={workspace.id} /><input type="hidden" name="mode" value="enable" />
          <label className="text-xs">Quota par jour<input name="daily_limit" type="number" min={1} max={50} defaultValue={workspace.daily_send_limit || 10} className="mt-1 block w-24 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm" /></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" required /> Je confirme l&apos;envoi réel des e-mails approuvés depuis le domaine dédié.</label>
          <button disabled={!senderReady} className={`${button} bg-accent-strong text-accent-foreground disabled:opacity-50`}>Activer les envois</button>
          {!senderReady && <span className="text-xs text-warning">Expéditeur à configurer et vérifier d&apos;abord.</span>}
        </form>}
    </section>

    {drafts.length > 0 && <form action={approveMessagesAction} className="rounded-lg border border-border p-3">
      <input type="hidden" name="workspace_id" value={workspace.id} />
      {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-medium">{drafts.length} brouillon(s) à relire</p>
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setSelected(new Set(drafts.slice(0, 100).map((m) => m.id)))}>Tout sélectionner</button>
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setSelected(new Set())}>Aucun</button>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" required /> J&apos;ai relu ces messages et j&apos;autorise leur envoi.</label>
        <label className="text-xs">Nombre d&apos;e-mails sélectionnés (à retaper)<input name="confirm_count" inputMode="numeric" required className="mt-1 block w-24 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm" /></label>
        <button disabled={!selected.size} className={`${button} bg-accent-strong text-accent-foreground disabled:opacity-50`}>Approuver {selected.size} e-mail(s)</button>
      </div>
    </form>}

    {messages.length === 0 ? <p className="py-8 text-muted">Aucun brouillon. Transmettez une liste depuis l&apos;onglet Prospects.</p> :
      <div className="divide-y divide-border">{messages.map((m) => <article key={m.id} className="py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <label className="flex items-start gap-2">
            {m.state === "draft" && <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Sélectionner ${m.subject}`} className="mt-1" />}
            <span><span className="font-medium">{m.subject}</span>{m.step === 2 && <span className="ml-2 text-xs text-muted">(relance)</span>}<br /><span className="text-xs text-muted">{companyOf.get(m.prospect_id) ?? ""} · {m.recipient_email}</span></span>
          </label>
          <span className="text-xs text-muted">{STATE_LABELS[m.state] ?? m.state}
            {m.state === "sent" && m.sent_at ? ` le ${date(m.sent_at)}` : ""}
            {m.state === "approved" && m.scheduled_for ? ` · dès le ${date(m.scheduled_for)}` : ""}
            {m.replied_at ? ` · ${m.reply_kind === "stop" ? "désinscription" : "réponse"} le ${date(m.replied_at)}` : ""}
            {m.cancelled_reason ? ` · ${CANCEL_REASONS[m.cancelled_reason] ?? m.cancelled_reason}` : ""}
            {m.last_error && m.state !== "sent" ? ` · erreur ${m.last_error}` : ""}</span>
        </div>
        {editing === m.id && m.state === "draft"
          ? <form action={updateDraftAction} className="mt-2 space-y-2"><input type="hidden" name="workspace_id" value={workspace.id} /><input type="hidden" name="id" value={m.id} />
            <label className="block text-xs">Objet<input name="subject" defaultValue={m.subject} maxLength={200} className={input} /></label>
            <label className="block text-xs">Texte<textarea name="body" defaultValue={m.body_text} rows={10} className={input} /></label>
            <div className="flex gap-2"><button className={`${button} border border-border`}>Enregistrer</button><button type="button" onClick={() => setEditing(null)} className="text-xs text-muted">Annuler</button></div>
          </form>
          : <p className="mt-2 whitespace-pre-wrap">{m.body_text}</p>}
        {(m.facts?.length ?? 0) > 0 && <ul className="mt-2 text-xs text-muted">{m.facts!.map((f, i) => <li key={i}>Fait utilisé : {f.statement} (<a className="text-accent hover:underline" href={f.sourceUrl} target="_blank" rel="noopener noreferrer">source</a>)</li>)}</ul>}
        {m.state === "draft" && <DraftQuality subject={m.subject} body={m.body_text} company={companyOf.get(m.prospect_id)} />}
        {(m.state === "draft" || m.state === "approved") && <div className="mt-2 flex gap-3 text-xs">
          {m.state === "draft" && editing !== m.id && <button type="button" onClick={() => setEditing(m.id)} className="text-accent hover:underline">Corriger</button>}
          <form action={cancelMessageAction}><input type="hidden" name="workspace_id" value={workspace.id} /><input type="hidden" name="id" value={m.id} /><button className="text-muted hover:underline">Annuler ce message</button></form>
        </div>}
      </article>)}</div>}
  </div>;
}

/** Contrôle qualité d'un brouillon (délivrabilité et efficacité) affiché avant approbation. */
export function DraftQuality({ subject, body, company }: { subject: string; body: string; company?: string }) {
  const audit = auditOutreachDraft({ subject, body }, company);
  const tone = audit.score >= 80 ? "text-success" : audit.score >= 60 ? "text-warning" : "text-danger";
  return <div className="mt-2 rounded-lg border border-border p-2 text-xs">
    <p><span className={`font-semibold ${tone}`}>Qualité {audit.score}/100</span> <span className="text-muted">· {audit.words} mots</span></p>
    {audit.issues.length > 0 && <ul className="mt-1 space-y-0.5">{audit.issues.map((i) => <li key={i.code} className={i.level === "warning" ? "text-warning" : "text-muted"}>{i.message}</li>)}</ul>}
  </div>;
}
