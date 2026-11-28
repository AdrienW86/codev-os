import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeading, Panel } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients/data";
import { getReviewsView, type ReviewRow } from "@/lib/reviews/service";
import { DEFAULT_REQUEST_SUBJECT, DEFAULT_REQUEST_TEMPLATE, isNegative, reviewLink } from "@/lib/reviews/model";
import { cancelReviewRequestAction, createReviewRequestAction, publishReplyAction, redraftReviewAction, saveDraftAction, saveReviewSettingsAction, skipReviewAction } from "./actions";

export const metadata: Metadata = { title: "Avis Google" };

const button = "rounded-lg px-3 py-2 text-sm font-semibold";
const input = "w-full rounded-lg border border-border bg-surface p-2 text-sm";
const STATUS: Record<ReviewRow["status"], { label: string; tone: "neutral" | "green" | "amber" }> = {
  to_draft: { label: "Réponse en préparation", tone: "amber" }, draft: { label: "Réponse à valider", tone: "amber" }, publishing: { label: "Publication en cours", tone: "neutral" },
  published: { label: "Réponse publiée", tone: "green" }, replied_elsewhere: { label: "Déjà répondu", tone: "green" }, skipped: { label: "Sans réponse", tone: "neutral" }, failed: { label: "À traiter", tone: "amber" },
};
const REQUEST_STATUS: Record<string, string> = { scheduled: "Programmée", sent: "Envoyée", failed: "Échec", cancelled: "Annulée", suppressed: "Adresse exclue" };
const stars = (n: number | null) => (n ? `${"★".repeat(n)}${"☆".repeat(5 - n)}` : "Note inconnue");
const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
const OPEN = new Set(["to_draft", "draft", "failed", "publishing"]);

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ client?: string; msg?: string; ok?: string; all?: string }> }) {
  await requireAdmin();
  const clients = await listClients();
  const { client, msg, ok, all } = await searchParams;
  const selected = clients.find((c) => c.id === client) ?? null;
  const view = selected ? await getReviewsView(selected.id).catch(() => null) : null;
  const shown = view ? (all === "1" ? view.reviews : view.reviews.filter((r) => OPEN.has(r.status))) : [];
  const link = view ? reviewLink(view.settings) : null;
  const hidden = (id: string) => <><input type="hidden" name="client_id" value={selected?.id ?? ""} /><input type="hidden" name="id" value={id} /></>;

  return <>
    <PageHeading eyebrow="Réputation" title="Avis Google" description="L’Agent Avis relève les avis des fiches Google toutes les 2 heures, rédige une réponse dans le ton du client et vous alerte tout de suite sur un avis négatif. Rien n’est publié sans votre validation, sauf règle des avis positifs choisie pour le client." />
    <form className="mb-6 flex flex-wrap items-end gap-3" action="/avis">
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
      <p className="text-sm text-warning">Migration 20261224010000_google_reviews_agent à appliquer.</p> : <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Panel className="p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <p><span className="text-lg font-semibold">{view.stats.average !== null ? String(view.stats.average).replace(".", ",") : "–"}</span><span className="text-muted"> / 5 sur {view.stats.total} avis relevés</span></p>
            <p><span className="text-lg font-semibold">{view.stats.toValidate}</span><span className="text-muted"> réponse(s) à valider</span></p>
            <p className={view.stats.negativeOpen ? "text-danger" : ""}><span className="text-lg font-semibold">{view.stats.negativeOpen}</span><span className={view.stats.negativeOpen ? "" : "text-muted"}> avis négatif(s) ouvert(s)</span></p>
          </div>
          <p className="mt-2 text-xs text-muted">
            {view.locations.length ? `Fiche(s) : ${view.locations.map((l) => l.title ?? l.name).join(", ")}. ` : <>Aucune fiche Google connectée pour ce client : <Link className="text-accent" href={`/clients/${selected.id}?tab=publications`}>connecter Google Business Profile</Link>. </>}
            {view.settings.lastSyncAt ? `Dernier relevé ${when(view.settings.lastSyncAt)}${view.settings.lastSyncError ? ` (échec : ${view.settings.lastSyncError})` : ""}.` : "Aucun relevé pour l’instant."}
            {!view.settings.enabled && " Agent désactivé pour ce client."}
            {!view.ai && " IA non configurée : aucune réponse ne peut être rédigée."}
            {" "}<Link className="text-accent" href={`/lancer?agent=reviews&client=${selected.id}`}>Relever maintenant</Link>
          </p>
        </Panel>
        <div className="flex gap-3 text-sm">
          <Link href={`/avis?client=${selected.id}`} className={all === "1" ? "text-muted" : "font-semibold"}>À traiter</Link>
          <Link href={`/avis?client=${selected.id}&all=1`} className={all === "1" ? "font-semibold" : "text-muted"}>Tous les avis</Link>
        </div>
        {shown.length === 0 && <p className="text-sm text-muted">{all === "1" ? "Aucun avis relevé." : "Aucun avis à traiter."}</p>}
        {shown.map((r) => {
          const negative = isNegative(r.rating);
          const editable = ["draft", "failed", "to_draft", "skipped"].includes(r.status);
          return <Panel key={r.id} className={`p-4 ${negative && OPEN.has(r.status) ? "ring-1 ring-danger/40" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className={`font-semibold ${negative ? "text-danger" : ""}`} aria-label={`${r.rating ?? "?"} étoiles sur 5`}>{stars(r.rating)} <span className="font-normal text-foreground">{r.reviewer ?? "Client anonyme"}</span></p>
                <p className="text-xs text-muted">{when(r.review_created_at)}</p>
              </div>
              <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm">{r.comment ?? <span className="text-muted">Avis sans commentaire.</span>}</p>
            {r.status === "published" && r.published_reply && <div className="mt-3 rounded-lg bg-surface-raised p-3 text-sm"><p className="mb-1 text-xs text-muted">Réponse publiée {r.published_at ? when(r.published_at) : ""}{r.published_by === "auto" ? " (règle des avis positifs)" : ""}</p><p className="whitespace-pre-line">{r.published_reply}</p></div>}
            {r.status === "replied_elsewhere" && r.existing_reply && <div className="mt-3 rounded-lg bg-surface-raised p-3 text-sm"><p className="mb-1 text-xs text-muted">Réponse déjà présente sur Google</p><p className="whitespace-pre-line">{r.existing_reply}</p></div>}
            {r.last_error && OPEN.has(r.status) && <p className="mt-2 text-xs text-warning">{r.last_error}</p>}
            {r.status === "to_draft" && <p className="mt-2 text-xs text-muted">L’agent rédige la réponse au prochain passage (quelques minutes).</p>}
            {editable && r.status !== "to_draft" && <form className="mt-3 space-y-2">
              {hidden(r.id)}<input type="hidden" name="negative" value={negative ? "1" : "0"} />
              <textarea name="reply" rows={negative ? 6 : 4} defaultValue={r.draft ?? ""} placeholder="Votre réponse" maxLength={4096} className={input} />
              {r.draft_score !== null && r.status === "draft" && <p className="text-xs text-muted">Note de naturel {r.draft_score}/100{r.auto_publish_at ? ` · publication automatique prévue ${when(r.auto_publish_at)} (modifiez ou ignorez pour l’arrêter)` : ""}</p>}
              {negative && <label className="block text-xs"><input type="checkbox" name="confirm" className="mr-1" />Je publie cette réponse à un avis négatif au nom du client</label>}
              <div className="flex flex-wrap gap-2">
                <button formAction={publishReplyAction} className={`${button} bg-accent-strong text-accent-foreground`}>Publier sur Google</button>
                <button formAction={saveDraftAction} className={`${button} border border-border`}>Enregistrer</button>
                <button formAction={redraftReviewAction} className={`${button} border border-border`}>{r.draft ? "Refaire la réponse" : "Rédiger une réponse"}</button>
                {r.status !== "skipped" && <button formAction={skipReviewAction} className={`${button} border border-border`}>Ne pas répondre</button>}
              </div>
            </form>}
          </Panel>;
        })}
      </div>
      <div className="space-y-4">
        <Panel className="p-4"><div id="demandes" />
          <h2 className="font-semibold">Demander un avis après un chantier</h2>
          <p className="mt-1 text-xs text-muted">Un e-mail part {view.settings.requestDelayDays ? `${view.settings.requestDelayDays} jour(s) après le chantier` : "le jour du chantier"}, en heures de bureau, avec le lien direct vers la fiche. Une même adresse n’est sollicitée qu’une fois tous les 6 mois ; les adresses désinscrites sont exclues.</p>
          {!link && <p className="mt-2 text-xs text-warning">Lien vers la fiche Google inconnu : renseignez-le dans les réglages ou lancez un relevé.</p>}
          {!view.sending.enabled && <p className="mt-2 text-xs text-warning">{view.sending.reason} Les demandes restent programmées jusqu’à l’activation.</p>}
          <form action={createReviewRequestAction} className="mt-3 space-y-2 text-sm"><input type="hidden" name="client_id" value={selected.id} />
            <input name="customer_name" required maxLength={80} placeholder="Prénom du client" className={input} />
            <input name="email" type="email" required maxLength={254} placeholder="E-mail du client" className={input} />
            <input name="service" maxLength={120} placeholder="Prestation (ex. la réfection de votre toiture)" className={input} />
            <label className="block text-xs text-muted">Date de fin du chantier<input name="job_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={`${input} mt-1`} /></label>
            <button disabled={!link} className={`${button} bg-accent-strong text-accent-foreground disabled:opacity-50`}>Programmer la demande</button>
            <p className="text-xs text-muted">Le client vous a confié son adresse pour ce chantier ; elle est effacée 90 jours après l’envoi. Aucune contrepartie n’est proposée contre un avis (règles Google).</p>
          </form>
          {link && <p className="mt-3 break-all text-xs text-muted">À partager aussi par SMS ou WhatsApp : {link}</p>}
          {view.requests.length > 0 && <ul className="mt-3 space-y-2 text-xs">{view.requests.map((q) => <li key={q.id} className="rounded-lg border border-border p-2">
            <p><span className="font-semibold">{q.customer_name}</span>{q.service ? ` · ${q.service}` : ""}</p>
            <p className="text-muted">{REQUEST_STATUS[q.status] ?? q.status} · {q.status === "sent" && q.sent_at ? when(q.sent_at) : when(q.send_after)}{q.last_error ? ` · ${q.last_error}` : ""}</p>
            {q.status === "scheduled" && <form action={cancelReviewRequestAction}>{hidden(q.id)}<button className="mt-1 text-accent">Annuler</button></form>}
          </li>)}</ul>}
        </Panel>
        <Panel className="p-4"><div id="reglages" />
          <h2 className="font-semibold">Réglages pour {selected.name}</h2>
          <form action={saveReviewSettingsAction} className="mt-3 space-y-3 text-sm"><input type="hidden" name="client_id" value={selected.id} />
            <label className="flex gap-2"><input type="checkbox" name="enabled" defaultChecked={view.settings.enabled} />Agent actif pour ce client</label>
            <label className="block">Ton des réponses<textarea name="tone_notes" rows={3} maxLength={1000} defaultValue={view.settings.toneNotes} placeholder="Ex. chaleureux, tutoiement, toujours remercier pour la confiance" className={`${input} mt-1`} /></label>
            <p className="text-xs text-muted">Les consignes de communication et les faits confirmés de la fiche client sont aussi utilisés.</p>
            <label className="block">Signature<input name="signature" maxLength={120} defaultValue={view.settings.signature} placeholder="Ex. Julien, Toitures Martin" className={`${input} mt-1`} /></label>
            <label className="block">Publication automatique des avis positifs
              <select name="auto_publish_min_rating" defaultValue={view.settings.autoPublishMinRating ? String(view.settings.autoPublishMinRating) : ""} className={`${input} mt-1`}>
                <option value="">Non : tout est validé à la main</option><option value="5">Oui, avis 5 étoiles</option><option value="4">Oui, avis 4 et 5 étoiles</option>
              </select></label>
            <label className="block">Délai de relecture avant publication automatique (heures)<input name="auto_publish_delay_hours" type="number" min={1} max={72} defaultValue={view.settings.autoPublishDelayHours} className={`${input} mt-1`} /></label>
            <p className="text-xs text-muted">Un avis de 3 étoiles ou moins n’est jamais publié automatiquement.</p>
            <label className="block">Lien « Laisser un avis »<input name="review_url" type="url" maxLength={500} defaultValue={view.settings.reviewUrl ?? ""} placeholder={view.settings.detectedReviewUrl ?? "https://g.page/r/…/review"} className={`${input} mt-1`} /></label>
            {view.settings.detectedReviewUrl && !view.settings.reviewUrl && <p className="text-xs text-muted">Lien détecté sur la fiche, utilisé par défaut.</p>}
            <label className="block">Délai avant la demande d’avis (jours)<input name="request_delay_days" type="number" min={0} max={14} defaultValue={view.settings.requestDelayDays} className={`${input} mt-1`} /></label>
            <label className="block">Objet de la demande<input name="request_subject" maxLength={120} defaultValue={view.settings.requestSubject ?? ""} placeholder={DEFAULT_REQUEST_SUBJECT} className={`${input} mt-1`} /></label>
            <label className="block">Message de la demande<textarea name="request_template" rows={8} maxLength={2000} defaultValue={view.settings.requestTemplate ?? ""} placeholder={DEFAULT_REQUEST_TEMPLATE} className={`${input} mt-1`} /></label>
            <p className="text-xs text-muted">Variables : {"{prenom}"}, {"{prestation}"}, {"{entreprise}"}, {"{lien}"} (obligatoire). Vide = message par défaut.</p>
            <button className={`${button} border border-border`}>Enregistrer les réglages</button>
          </form>
        </Panel>
      </div>
    </div>}
  </>;
}
