import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listClients } from "@/lib/clients/data";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { ingestionEnabled } from "@/lib/whatsapp/service";
import { SenderForm, ProcessForm, RetryForm, FolderForm } from "./forms";
export const metadata = { title: "Photos WhatsApp" };
export const maxDuration = 120;
export default async function WhatsAppPage() {
  await requireAdmin();
  if (await getActiveScenario()) return <Panel className="p-6">Quittez la simulation pour configurer la réception des photos WhatsApp.</Panel>;
  const db = getSupabaseServerClient();
  const [mappings, inbox, clients] = await Promise.all([
    db.from("whatsapp_senders").select("*").order("updated_at", { ascending: false }).limit(200),
    db.from("whatsapp_inbox").select("*").order("created_at", { ascending: false }).limit(100),
    listClients(),
  ]);
  const names = new Map(clients.map(c => [c.id, c.name]));
  const configured = !mappings.error && !inbox.error;
  const statuses = { pending: "En attente", processing: "En cours", imported: "Importée", duplicate: "Doublon exact ignoré", failed: "Échec" };
  return <>
    <PageHeading eyebrow="Médias clients" title="Photos WhatsApp → Drive" description="Réception des nouvelles photos, classement par client et dédoublonnage exact." />
    <Link href="/settings?tab=connections" className="text-accent">Retour aux connexions</Link>
    <Panel className="my-6 p-6"><p>Réception : {ingestionEnabled() ? "activée côté serveur" : "désactivée côté serveur"}.</p><p className="mt-3 text-sm text-muted">Aucun historique WhatsApp n’est récupéré. Les originaux ne sont pas supprimés. Les photos ressemblantes restent conservées. Seules les photos JPEG, PNG et WebP jusqu’à 8 Mo sont importées.</p>
      {!configured && <p role="alert" className="mt-4">File indisponible : appliquez la migration WhatsApp avant de configurer l’import.</p>}
    </Panel>
    {configured && <>
      <Panel className="mb-6 p-6"><h2 className="mb-4 text-lg font-semibold">Associer ou modifier un expéditeur</h2><FolderForm clients={clients} /><SenderForm clients={clients} />
        <ul className="mt-6 space-y-3">{mappings.data?.map(m => <li key={m.sender}>+{m.sender} → {names.get(m.client_id) ?? "Client"} · {m.enabled ? "activé" : "en pause"} · dossier {m.drive_folder_id}</li>)}</ul>
      </Panel>
      <Panel className="p-6"><h2 className="mb-4 text-lg font-semibold">File d’import</h2><ProcessForm /><p className="my-4 text-sm text-muted">Les 100 dernières réceptions. Un numéro non associé reste en attente. Un automate serveur peut traiter la file en continu ; aucun planning n’est activé automatiquement.</p>
        <ul className="divide-y divide-border">{inbox.data?.map(item => <li key={item.id} className="py-4">
          <p>+{item.sender} · {item.client_id ? names.get(item.client_id) ?? "Client" : "À associer"} · {statuses[item.status]}</p>
          <p className="text-sm text-muted">{new Date(item.received_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} · {item.attempts}/5 tentatives{item.error_code ? ` · ${item.error_code}` : ""}</p>
          {item.drive_file_id && <a className="text-accent" href={`https://drive.google.com/file/d/${item.drive_file_id}/view`} target="_blank" rel="noreferrer">Voir dans Drive</a>}
          {item.status === "failed" && <RetryForm id={item.id} />}
        </li>)}</ul>{!inbox.data?.length && <p>Aucune photo reçue.</p>}
      </Panel>
    </>}
  </>;
}
