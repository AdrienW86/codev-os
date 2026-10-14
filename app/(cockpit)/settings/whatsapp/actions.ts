"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import { phoneSchema, folderSchema } from "@/lib/whatsapp/payload";
import { checkFolder, importDriveToken, createImportFolder, ImportFailure } from "@/lib/whatsapp/providers";
import { driveErrorMessage, logDriveFailure, type DriveErrorCode } from "@/lib/whatsapp/drive-errors";
import { processOneMedia } from "@/lib/whatsapp/service";
export type ImportState = { message?: string; ok?: boolean; code?: string };
// Échec Drive d'import : code fermé journalisé côté serveur et message distinct pour l'interface, sans secret.
class StepFailure extends Error { constructor(public readonly code: DriveErrorCode) { super(code); } }
function driveFailure(action: string, error: unknown): ImportState {
  const failure = error instanceof ImportFailure ? { code: error.code, ...error.context } : error instanceof StepFailure ? { code: error.code } : { code: "unexpected", stage: error instanceof Error ? error.name.slice(0, 40) : typeof error };
  logDriveFailure(action, failure);
  return { message: driveErrorMessage(failure.code, "variable" in failure ? failure.variable : null), code: failure.code };
}
async function step<T>(code: DriveErrorCode, work: () => Promise<T>) {
  try { return await work(); } catch { throw new StepFailure(code); }
}
const mapping = z.object({ sender: phoneSchema, client_id: z.uuid(), drive_folder_id: folderSchema, rights_confirmed: z.boolean(), enabled: z.boolean() }).refine(value => !value.enabled || value.rights_confirmed);

export async function saveSender(_state: ImportState, form: FormData): Promise<ImportState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Quittez la simulation avant de configurer l’import." };
  const parsed = mapping.safeParse({ sender: String(form.get("sender") ?? "").replace(/[\s+()-]/g, ""), client_id: form.get("client_id"), drive_folder_id: form.get("drive_folder_id"), rights_confirmed: form.get("rights_confirmed") === "on", enabled: form.get("enabled") === "on" });
  if (!parsed.success) return { message: "Vérifiez le numéro international, le client, le dossier et l’autorisation d’utilisation des photos." };
  try {
    const db = getSupabaseServerClient();
    const { data: client, error: clientError } = await step("database_unavailable", async () => await db.from("clients").select("id").eq("id", parsed.data.client_id).maybeSingle());
    if (clientError) throw new StepFailure("database_unavailable");
    if (!client) return { message: "Client introuvable.", code: "client_not_found" };
    try { await checkFolder(await importDriveToken(), parsed.data.drive_folder_id); }
    catch (error) {
      if (error instanceof ImportFailure && (error.code === "drive_folder" || error.code === "drive_not_found")) {
        logDriveFailure("whatsapp.sender.configure", { code: error.code, ...error.context });
        return { message: driveErrorMessage("drive_folder"), code: error.code };
      }
      throw error;
    }
    await step("audit_unavailable", () => writeAudit({ kind: "admin", userId }, { action: "whatsapp.sender.configure.request", resource_type: "client", resource_id: client.id, metadata: { drive_folder_id: parsed.data.drive_folder_id } }));
    const { error } = await db.from("whatsapp_senders").upsert({ ...parsed.data, updated_by: userId });
    if (error) return { message: "Association refusée : vérifiez la migration et que ce dossier n’appartient pas à un autre client." };
    revalidatePath("/settings/whatsapp");
    return { message: "Association enregistrée. Les prochains médias pourront être importés dans ce dossier.", ok: true };
  } catch (error) { return driveFailure("whatsapp.sender.configure", error); }
}
export async function runImport(): Promise<ImportState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Import indisponible en simulation." };
  try {
    const status = await processOneMedia({ kind: "admin", userId });
    revalidatePath("/settings/whatsapp");
    const messages: Record<string, string> = { disabled: "Activez la réception côté serveur avant d’importer.", idle: "Aucun média prêt : associez les expéditeurs, confirmez les droits ou attendez la reprise.", imported: "Un média importé dans Drive.", duplicate: "Média déjà présent : aucun fichier supplémentaire créé.", retry: "Import interrompu. Une reprise est prévue ; consultez le code dans la file." };
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
    const { data: client, error } = await step("database_unavailable", async () => await getSupabaseServerClient().from("clients").select("id,name").eq("id", id.data).maybeSingle());
    if (error) throw new StepFailure("database_unavailable");
    if (!client) return { message: "Client introuvable.", code: "client_not_found" };
    await step("audit_unavailable", () => writeAudit({ kind: "admin", userId }, { action: "whatsapp.folder.create.request", resource_type: "client", resource_id: client.id }));
    const folder = await createImportFolder(await importDriveToken(), client.name);
    // Le dossier existe déjà dans Drive : un échec du journal ne doit pas faire croire à une création ratée.
    try { await writeAudit({ kind: "admin", userId }, { action: "whatsapp.folder.created", resource_type: "client", resource_id: client.id, metadata: { drive_folder_id: folder } }); }
    catch { logDriveFailure("whatsapp.folder.create", { code: "audit_unavailable", stage: "after_create" }); }
    return { message: `Dossier créé. Copiez cet ID dans l’association ci-dessous : ${folder}`, ok: true };
  } catch (error) { return driveFailure("whatsapp.folder.create", error); }
}

// Affectation explicite d'un média d'un numéro inconnu : jamais automatique, droits confirmés par l'administrateur.
const assignment = z.object({ id: z.uuid(), target: z.string().regex(/^[0-9a-f-]{36}:[a-zA-Z0-9_-]{10,200}$/), rights: z.literal(true) });
export async function assignMedia(_state: ImportState, form: FormData): Promise<ImportState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Indisponible en simulation." };
  const parsed = assignment.safeParse({ id: form.get("id"), target: form.get("target"), rights: form.get("rights_confirmed") === "on" });
  if (!parsed.success) return { message: "Choisissez le client et confirmez l’autorisation d’utilisation." };
  const [clientId, folder] = [parsed.data.target.slice(0, 36), parsed.data.target.slice(37)];
  if (!z.uuid().safeParse(clientId).success) return { message: "Client invalide." };
  try {
    await writeAudit({ kind: "admin", userId }, { action: "whatsapp.assign.request", resource_type: "whatsapp_inbox", resource_id: parsed.data.id, metadata: { client_id: clientId, drive_folder_id: folder } });
    const { error } = await getSupabaseServerClient().rpc("whatsapp_assign", { p_inbox_id: parsed.data.id, p_client_id: clientId, p_folder: folder, p_actor_id: userId });
    if (error) return { message: "Affectation refusée : le média n’est plus en attente ou ce dossier n’est pas associé à ce client." };
    revalidatePath("/settings/whatsapp");
    return { message: "Média affecté. Il sera importé dans le dossier du client au prochain traitement.", ok: true };
  } catch { return { message: "Affectation indisponible." }; }
}
export async function dismissMedia(_state: ImportState, form: FormData): Promise<ImportState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Indisponible en simulation." };
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { message: "Média invalide." };
  try {
    await writeAudit({ kind: "admin", userId }, { action: "whatsapp.dismiss.request", resource_type: "whatsapp_inbox", resource_id: id.data });
    const { data, error } = await getSupabaseServerClient().from("whatsapp_inbox").update({ status: "dismissed", caption: null }).eq("id", id.data).eq("status", "pending").is("client_id", null).select("id");
    if (error || !data?.length) return { message: "Seul un média en attente d’affectation peut être écarté." };
    revalidatePath("/settings/whatsapp");
    return { message: "Média écarté : il ne sera pas importé.", ok: true };
  } catch { return { message: "Opération indisponible." }; }
}
// Droit à l'effacement : supprime l'association, écarte les médias non importés, efface numéro et messages.
export async function forgetSender(_state: ImportState, form: FormData): Promise<ImportState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Indisponible en simulation." };
  const sender = phoneSchema.safeParse(String(form.get("sender") ?? "").replace(/[\s+()-]/g, ""));
  if (!sender.success || form.get("confirm") !== "on") return { message: "Indiquez le numéro international et confirmez l’effacement." };
  try {
    await writeAudit({ kind: "admin", userId }, { action: "whatsapp.sender.forget.request", resource_type: "whatsapp_sender", resource_id: null });
    const { error } = await getSupabaseServerClient().rpc("whatsapp_forget_sender", { p_sender: sender.data, p_actor_id: userId });
    if (error) return { message: "Effacement non confirmé. Vérifiez la migration de la photothèque." };
    revalidatePath("/settings/whatsapp");
    return { message: "Numéro et messages effacés. Les fichiers déjà présents dans Drive restent à supprimer manuellement si nécessaire.", ok: true };
  } catch { return { message: "Effacement indisponible." }; }
}
