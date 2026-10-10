"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import { phoneSchema, folderSchema } from "@/lib/whatsapp/payload";
import { checkFolder, importDriveToken, createImportFolder } from "@/lib/whatsapp/providers";
import { processOneImage } from "@/lib/whatsapp/service";
export type ImportState = { message?: string; ok?: boolean };
const mapping = z.object({ sender: phoneSchema, client_id: z.uuid(), drive_folder_id: folderSchema, rights_confirmed: z.boolean(), enabled: z.boolean() }).refine(value => !value.enabled || value.rights_confirmed);

export async function saveSender(_state: ImportState, form: FormData): Promise<ImportState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Quittez la simulation avant de configurer l’import." };
  const parsed = mapping.safeParse({ sender: String(form.get("sender") ?? "").replace(/[\s+()-]/g, ""), client_id: form.get("client_id"), drive_folder_id: form.get("drive_folder_id"), rights_confirmed: form.get("rights_confirmed") === "on", enabled: form.get("enabled") === "on" });
  if (!parsed.success) return { message: "Vérifiez le numéro international, le client, le dossier et l’autorisation d’utilisation des photos." };
  try {
    const db = getSupabaseServerClient();
    const { data: client, error: clientError } = await db.from("clients").select("id").eq("id", parsed.data.client_id).single();
    if (clientError || !client) return { message: "Client introuvable." };
    await checkFolder(await importDriveToken(), parsed.data.drive_folder_id);
    await writeAudit({ kind: "admin", userId }, { action: "whatsapp.sender.configure.request", resource_type: "client", resource_id: client.id, metadata: { drive_folder_id: parsed.data.drive_folder_id } });
    const { error } = await db.from("whatsapp_senders").upsert({ ...parsed.data, updated_by: userId });
    if (error) return { message: "Association refusée : vérifiez la migration et que ce dossier n’appartient pas à un autre client." };
    revalidatePath("/settings/whatsapp");
    return { message: "Association enregistrée. Les prochaines photos pourront être importées dans ce dossier.", ok: true };
  } catch { return { message: "Dossier non accessible en écriture ou configuration Drive d’import absente. Le connecteur de lecture ne suffit pas." }; }
}
export async function runImport(): Promise<ImportState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Import indisponible en simulation." };
  try {
    const status = await processOneImage({ kind: "admin", userId });
    revalidatePath("/settings/whatsapp");
    const messages: Record<string, string> = { disabled: "Activez la réception côté serveur avant d’importer.", idle: "Aucune photo prête : associez les expéditeurs, confirmez les droits ou attendez la reprise.", imported: "Une photo importée dans Drive.", duplicate: "Photo déjà présente : aucun fichier supplémentaire créé.", retry: "Import interrompu. Une reprise est prévue ; consultez le code dans la file." };
    return { message: messages[status] ?? "Import indisponible.", ok: status === "imported" || status === "duplicate" };
  } catch { return { message: "File indisponible. Vérifiez la migration et la configuration serveur." }; }
}
export async function retryImport(_state: ImportState, form: FormData): Promise<ImportState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Indisponible en simulation." };
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { message: "Import invalide." };
  try {
    await writeAudit({ kind: "admin", userId }, { action: "whatsapp.retry.request", resource_type: "whatsapp_inbox", resource_id: id.data });
    const { data, error } = await getSupabaseServerClient().from("whatsapp_inbox").update({ status: "pending", attempts: 0, error_code: null, retry_at: new Date().toISOString() }).eq("id", id.data).eq("status", "failed").select("id");
    if (error || !data?.length) return { message: "Seul un import en échec peut être relancé." };
    revalidatePath("/settings/whatsapp");
    return { message: "Import remis en attente.", ok: true };
  } catch { return { message: "Reprise indisponible." }; }
}

export async function createFolder(_state: ImportState, form: FormData): Promise<ImportState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Indisponible en simulation." };
  const id = z.uuid().safeParse(form.get("client_id"));
  if (!id.success) return { message: "Choisissez le client." };
  try {
    const { data: client, error } = await getSupabaseServerClient().from("clients").select("id,name").eq("id", id.data).single();
    if (error || !client) return { message: "Client introuvable." };
    await writeAudit({ kind: "admin", userId }, { action: "whatsapp.folder.create.request", resource_type: "client", resource_id: client.id });
    const folder = await createImportFolder(await importDriveToken(), client.name);
    await writeAudit({ kind: "admin", userId }, { action: "whatsapp.folder.created", resource_type: "client", resource_id: client.id, metadata: { drive_folder_id: folder } });
    return { message: `Dossier créé. Copiez cet ID dans l’association ci-dessous : ${folder}`, ok: true };
  } catch { return { message: "Création indisponible. Vérifiez les credentials Drive d’import et la permission drive.file." }; }
}
