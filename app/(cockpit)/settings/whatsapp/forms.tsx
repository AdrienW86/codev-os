"use client";
import { useActionState } from "react";
import { Action } from "@/components/ui/button";
import { saveSender, runImport, retryImport, createFolder, type ImportState } from "./actions";
const initial: ImportState = {};
const input = "block w-full rounded-lg border border-border bg-background p-3";
export function SenderForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveSender, initial);
  return <form action={action} className="grid max-w-xl gap-4">
    <label>Numéro WhatsApp international<input className={input} name="sender" placeholder="33612345678" required maxLength={30} inputMode="tel" /></label>
    <label>Client<select className={input} name="client_id" required><option value="">Choisir le client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>ID du dossier Drive dédié<input className={input} name="drive_folder_id" required maxLength={200} /></label>
    <p className="text-sm text-muted">Le dossier doit être autorisé à l’application d’import Drive. Pour alimenter les publications, utilisez ce même dossier dans la configuration du projet.</p>
    <label className="flex gap-3"><input type="checkbox" name="rights_confirmed" />Le client autorise l’utilisation de ces photos pour ses contenus.</label>
    <label className="flex gap-3"><input type="checkbox" name="enabled" defaultChecked />Activer cet expéditeur</label>
    <Action type="submit" disabled={pending} variant="primary">{pending ? "Vérification…" : "Enregistrer l’association"}</Action>
    <p role="status">{state.message}</p>
  </form>;
}
export function ProcessForm() {
  const [state, action, pending] = useActionState(runImport, initial);
  return <form action={action}><Action type="submit" disabled={pending}>{pending ? "Import en cours…" : "Traiter la prochaine photo"}</Action><p className="mt-3 text-sm" role="status">{state.message}</p></form>;
}
export function RetryForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(retryImport, initial);
  return <form action={action}><input type="hidden" name="id" value={id} /><Action type="submit" disabled={pending}>Réessayer</Action><p role="status">{state.message}</p></form>;
}

export function FolderForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createFolder, initial);
  return <form action={action} className="mb-6 grid max-w-xl gap-3"><p>Si vous n’avez pas encore de dossier autorisé, créez-en un dédié au client.</p><label>Client<select className={input} name="client_id" required><option value="">Choisir le client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><Action type="submit" disabled={pending}>{pending ? "Création…" : "Créer un dossier Drive dédié"}</Action><p role="status" className="break-all">{state.message}</p></form>;
}
