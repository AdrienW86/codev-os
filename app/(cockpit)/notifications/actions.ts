"use server";
import { requireAdmin } from "@/lib/require-admin";
import { revalidatePath } from "next/cache";
import { markNotificationRead, revokeDevice, saveNotificationPreferences, subscribeDevice } from "@/lib/notifications/service";
import type { MutationState } from "@/lib/core/mutation";
import { requireAdminWriter } from "@/lib/core/guards";
export async function readNotificationAction(_: MutationState, form: FormData) {
  await requireAdmin();
  try { await requireAdminWriter(); await markNotificationRead(form.get("id")); revalidatePath("/", "layout"); return { ok: true, message: "Notification lue." }; } catch { return { ok: false, message: "Lecture non enregistrée. Quittez la simulation si elle est active." }; }
}
export async function savePreferencesAction(_: MutationState, form: FormData) {
  await requireAdmin();
  try { await requireAdminWriter(); await saveNotificationPreferences({ categories: form.getAll("category"), push_categories: form.getAll("push_category"), push_enabled: form.get("push_enabled") === "yes" }); revalidatePath("/", "layout"); return { ok: true, message: "Préférences enregistrées." }; } catch { return { ok: false, message: "Préférences non enregistrées." }; }
}
export async function subscribePushAction(input: unknown) {
  await requireAdmin();
  try { await requireAdminWriter(); await subscribeDevice(input); revalidatePath("/notifications"); return { ok: true }; } catch { return { ok: false, message: "Abonnement non enregistré. Quittez la simulation, vérifiez la configuration et la limite d’appareils." }; }
}
export async function revokePushAction(deviceId: unknown) {
  await requireAdmin();
  try { await requireAdminWriter(); await revokeDevice(deviceId); revalidatePath("/notifications"); return { ok: true }; } catch { return { ok: false, message: "Révocation non enregistrée." }; }
}
