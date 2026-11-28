"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminWriter } from "@/lib/core/guards";
import { cancelReviewRequest, createReviewRequest, publishReviewReply, redraftReview, saveReviewDraft, saveReviewSettings, skipReview } from "@/lib/reviews/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const field = (data: FormData, name: string) => { const v = data.get(name); return typeof v === "string" ? v : ""; };

function done(clientId: string, result: { ok: boolean; message: string }, anchor = ""): never {
  revalidatePath("/avis");
  redirect(`/avis?${new URLSearchParams({ client: clientId, msg: result.message.slice(0, 300), ok: result.ok ? "1" : "0" })}${anchor}`);
}

async function guarded(data: FormData, run: (actor: Awaited<ReturnType<typeof requireAdminWriter>>, clientId: string) => Promise<{ ok: boolean; message: string }>, anchor = ""): Promise<never> {
  const clientId = field(data, "client_id");
  if (!UUID.test(clientId)) redirect("/avis");
  let result: { ok: boolean; message: string };
  try { result = await run(await requireAdminWriter(), clientId); }
  catch { result = { ok: false, message: "Action impossible (droits, mode simulation ou service indisponible)." }; }
  done(clientId, result, anchor);
}

export async function publishReplyAction(data: FormData) {
  // Avis négatif : la case de confirmation est exigée (réponse publique au nom du client, visible de tous).
  if (field(data, "negative") === "1" && field(data, "confirm") !== "on") done(field(data, "client_id"), { ok: false, message: "Cochez la confirmation avant de publier la réponse à un avis négatif." });
  await guarded(data, (actor, clientId) => publishReviewReply(actor, clientId, field(data, "id"), field(data, "reply").slice(0, 4096)));
}
export async function saveDraftAction(data: FormData) {
  await guarded(data, (actor, clientId) => saveReviewDraft(actor, clientId, field(data, "id"), field(data, "reply").slice(0, 4096)));
}
export async function skipReviewAction(data: FormData) {
  await guarded(data, (actor, clientId) => skipReview(actor, clientId, field(data, "id")));
}
export async function redraftReviewAction(data: FormData) {
  await guarded(data, (actor, clientId) => redraftReview(actor, clientId, field(data, "id")));
}
export async function saveReviewSettingsAction(data: FormData) {
  await guarded(data, (actor, clientId) => saveReviewSettings(actor, clientId, data), "#reglages");
}
export async function createReviewRequestAction(data: FormData) {
  await guarded(data, (actor, clientId) => createReviewRequest(actor, clientId, data), "#demandes");
}
export async function cancelReviewRequestAction(data: FormData) {
  await guarded(data, (actor, clientId) => cancelReviewRequest(actor, clientId, field(data, "id")), "#demandes");
}
