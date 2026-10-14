import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listClients } from "@/lib/clients/data";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { ingestionEnabled } from "@/lib/whatsapp/service";
import { SenderForm, ProcessForm, RetryForm, FolderForm, AssignForm, ForgetSenderForm } from "./forms";
import { mediaExpiry } from "@/lib/whatsapp/library-model";
import { inboxErrorLabel } from "@/lib/whatsapp/drive-errors";
export const metadata = { title: "Médias WhatsApp" };
export const maxDuration = 120;
export default async function WhatsAppPage() {
  await requireAdmin();
  if (await getActiveScenario()) return <Panel className="p-6">Quittez la simulation pour configurer la réception des photos WhatsApp.</Panel>;
  const db = getSupabaseServerClient();
  const [mappings, inbox, waiting, clients] = await Promise.all([
    db.from("whatsapp_senders").select("*").order("updated_at", { ascending: false }).limit(200),
    db.from("whatsapp_inbox").select("*").order("created_at", { ascending: false }).limit(100),
    db.from("whatsapp_inbox").select("*").is("client_id", null).eq("status", "pending").order("created_at", { ascending: false }).limit(100),
    listClients(),
  ]);
  const names = new Map(clients.map(c => [c.id, c.name]));
  const configured = !mappings.error && !inbox.error && !waiting.error;
  const statuses = { pending: "En attente", processing: "En cours", imported: "Importé", duplicate: "Doublon exact ignoré", failed: "Échec", dismissed: "Écarté" };
  // Couples client/dossier déjà associés avec droits confirmés : seules cibles possibles d'une affectation manuelle.
  const targets = [...new Map((mappings.data ?? []).filter(m => m.rights_confirmed).map(m => [`${m.client_id}:${m.drive_folder_id}`, { value: `${m.client_id}:${m.drive_folder_id}`, label: `${names.get(m.client_id) ?? "Client"} · dossier ${m.drive_folder_id.slice(0, 8)}…` }])).values()];
  const mapped = new Set((mappings.data ?? []).filter(m => m.enabled && m.rights_confirmed).map(m => m.sender));
  const unassigned = (waiting.data ?? []).filter(item => item.sender && !mapped.has(item.sender));
  return <>
    <PageHeading eyebrow="Médias clients" title="Photos et vidéos WhatsApp → Drive" description="Réception des médias, classement par client, dédoublonnage exact et photothèque sur la fiche client." />
    <Link href="/settings?tab=connections" className="text-accent">Retour aux connexions</Link>
    <Panel className="my-6 p-6"><p>Réception : {ingestionEnabled() ? "activée côté serveur" : "désactivée côté serveur"}.</p><p className="mt-3 text-sm text-muted">Aucun historique WhatsApp n’est récupéré. Les originaux ne sont pas modifiés ni supprimés. Photos JPEG, PNG et WebP jusqu’à 8 Mo ; vidéos MP4 et 3GP jusqu’à 16 Mo. Meta ne conserve les médias reçus que 7 jours : affectez rapidement les numéros inconnus.</p>
      {!configured && <p role="alert" className="mt-4">File indisponible : appliquez la migration WhatsApp avant de configurer l’import.</p>}
    </Panel>
    {configured && <>
      <Panel className="mb-6 p-6"><h2 className="mb-4 text-lg font-semibold">Associer ou modifier un expéditeur</h2><FolderForm clients={clients} /><SenderForm clients={clients} />
        <ul className="mt-6 space-y-3">{mappings.data?.map(m => <li key={m.sender}>+{m.sender} → {names.get(m.client_id) ?? "Client"} · {m.enabled ? "activé" : "en pause"} · dossier {m.drive_folder_id}</li>)}</ul>
      </Panel>
      <Panel className="mb-6 p-6"><h2 className="mb-2 text-lg font-semibold">En attente d’affectation <span className="text-sm font-normal text-muted">({unassigned.length})</span></h2>
        <p className="mb-4 text-sm text-muted">Numéros non reconnus : rien n’est importé tant qu’un administrateur n’a pas choisi le client.</p>
        {unassigned.length ? <ul className="divide-y divide-border">{unassigned.map(item => <li key={item.id} className="py-4">
          <p>+{item.sender} · {item.mime_type.startsWith("video/") ? "Vidéo" : "Photo"} · {new Date(item.received_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</p>
          {item.caption && <p className="mt-1 text-sm whitespace-pre-line">« {item.caption} »</p>}
          <p className="text-sm text-muted">Disponible chez Meta jusqu’au {mediaExpiry(item.received_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}</p>
          <AssignForm id={item.id} targets={targets} />
        </li>)}</ul> : <p className="text-sm">Aucun média en attente d’affectation.</p>}
      </Panel>
      <Panel className="p-6"><h2 className="mb-4 text-lg font-semibold">File d’import</h2><ProcessForm /><p className="my-4 text-sm text-muted">Les 100 dernières réceptions. Un numéro non associé reste en attente. Un automate serveur peut traiter la file en continu ; aucun planning n’est activé automatiquement.</p>
        <ul className="divide-y divide-border">{inbox.data?.map(item => <li key={item.id} className="py-4">
          <p>{item.sender ? `+${item.sender}` : "Numéro effacé"} · {item.mime_type.startsWith("video/") ? "Vidéo" : "Photo"} · {item.client_id ? <Link className="text-accent" href={`/clients/${item.client_id}?tab=media`}>{names.get(item.client_id) ?? "Client"}</Link> : "À associer"} · {statuses[item.status]}</p>
          <p className="text-sm text-muted">{new Date(item.received_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} · {item.attempts}/5 tentatives{item.error_code ? ` · ${inboxErrorLabel(item.error_code)}` : ""}</p>
          {item.drive_file_id && <a className="text-accent" href={`https://drive.google.com/file/d/${item.drive_file_id}/view`} target="_blank" rel="noreferrer">Voir dans Drive</a>}
          {item.status === "failed" && <RetryForm id={item.id} />}
        </li>)}</ul>{!inbox.data?.length && <p>Aucun média reçu.</p>}
      </Panel>
      <Panel className="mt-6 p-6"><h2 className="mb-2 text-lg font-semibold">Données personnelles</h2>
        <p className="mb-4 text-sm text-muted">Effacement à la demande d’un contact. La purge automatique des messages et numéros des imports terminés s’active avec la variable serveur WHATSAPP_RETENTION_DAYS (30 jours minimum). Les fichiers Drive ne sont jamais supprimés automatiquement.</p>
        <ForgetSenderForm />
      </Panel>
    </>}
  </>;
}
