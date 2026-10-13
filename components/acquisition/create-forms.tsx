import { createAcquisitionProspect, createAcquisitionTemplate, createInternalAcquisitionWorkspace } from "@/app/(cockpit)/acquisition/actions";
import { ACQUISITION_CATEGORIES } from "@/lib/acquisition/model";
import type { AcquisitionWorkspace } from "@/lib/acquisition/model";

const input="mt-1 w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm";
const button="mt-3 rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-semibold text-accent-foreground";

export function AcquisitionCreateForms({workspaces}:{workspaces:AcquisitionWorkspace[]}) {
  if(!workspaces.length) return <section className="rounded-xl border border-border bg-surface p-5">
    <h2 className="text-lg font-semibold">Initialiser l'espace CODE-V</h2>
    <p className="mt-2 text-sm text-muted">Création d'un espace interne, avec arrêt d'urgence actif, quota à zéro et aucun expéditeur configuré. Aucun e-mail ne sera envoyé.</p>
    <form action={createInternalAcquisitionWorkspace} className="mt-4 flex flex-wrap items-end gap-3">
      <div><label htmlFor="acq-confirm" className="block text-sm">Saisir CODE-V pour confirmer</label><input id="acq-confirm" name="confirmation" required pattern="CODE-V" className={input} autoComplete="off"/></div>
      <button type="submit" className={button}>Créer l'espace CODE-V</button>
    </form>
  </section>;
  return <section className="grid gap-5 lg:grid-cols-2" aria-label="Ajouter des éléments au CRM">
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Ajouter un prospect</h2>
      <p className="mt-1 text-sm text-muted">Une fiche reste au statut « Découvert » jusqu'à vérification. Aucune prise de contact automatique.</p>
      <form action={createAcquisitionProspect} className="mt-4 space-y-3">
        <div><label htmlFor="acq-prospect-workspace" className="text-sm">Entreprise gérée</label>
          <select className={input} id="acq-prospect-workspace" name="workspace_id" required>{workspaces.map(w=><option value={w.id} key={w.id}>{w.label}</option>)}</select></div>
        <div><label htmlFor="acq-company" className="text-sm">Nom de l'entreprise</label>
          <input id="acq-company" name="company_name" required minLength={2} maxLength={180} className={input}/></div>
        <div><label htmlFor="acq-category" className="text-sm">Catégorie</label>
          <select id="acq-category" name="category" className={input}>{ACQUISITION_CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
        <div><label htmlFor="acq-website" className="text-sm">Site web (facultatif)</label>
          <input id="acq-website" name="website" placeholder="https://entreprise.fr" type="url" maxLength={2048} className={input}/></div>
        <div><label htmlFor="acq-source" className="text-sm">Source vérifiable (URL)</label>
          <input id="acq-source" name="source_url" placeholder="https://…" type="url" required maxLength={2048} className={input}/></div>
        <div><label htmlFor="acq-why" className="text-sm">Observation factuelle</label>
          <textarea id="acq-why" name="explanation" rows={3} required minLength={15} maxLength={2000} className={input}/></div>
        <button type="submit" className={button}>Enregistrer le prospect</button>
      </form>
    </div>
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Créer un modèle d'e-mail</h2>
      <p className="mt-1 text-sm text-muted">Modèle enregistré inactif. Seuls les faits vérifiés du prospect pourront être employés dans les brouillons.</p>
      <form action={createAcquisitionTemplate} className="mt-4 space-y-3">
        <div><label htmlFor="acq-tmpl-workspace" className="text-sm">Entreprise gérée</label>
          <select className={input} id="acq-tmpl-workspace" name="workspace_id" required>{workspaces.map(w=><option value={w.id} key={w.id}>{w.label}</option>)}</select></div>
        <div><label htmlFor="acq-tmpl-category" className="text-sm">Catégorie</label>
          <select id="acq-tmpl-category" name="category" className={input}>{ACQUISITION_CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
        <div><label htmlFor="acq-tmpl-name" className="text-sm">Nom interne</label>
          <input id="acq-tmpl-name" name="name" required maxLength={100} className={input}/></div>
        <div><label htmlFor="acq-tmpl-subject" className="text-sm">Objet du message</label>
          <input id="acq-tmpl-subject" name="subject" required maxLength={240} className={input}/></div>
        <div><label htmlFor="acq-tmpl-body" className="text-sm">Texte du message</label>
          <textarea id="acq-tmpl-body" name="body" required rows={7} maxLength={8000} className={input}/></div>
        <button type="submit" className={button}>Enregistrer le modèle inactif</button>
      </form>
    </div>
  </section>;
}