"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminWriter } from "@/lib/core/guards";
import { addManualLead, cancelLeadMessage, retryLead, rotateFormKey, saveLeadSettings, sendLeadMessage, setLeadState } from "@/lib/leads/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const field = (data: FormData, name: string) => { const v = data.get(name); return typeof v === "string" ? v : ""; };

function done(clientId: string, result: { ok: boolean; message: string }, anchor = ""): never {
  revalidatePath("/leads");
  redirect(`/leads?${new URLSearchParams({ client: clientId, msg: result.message.slice(0, 300), ok: result.ok ? "1" : "0" })}${anchor}`);
}

async function guarded(data: FormData, run: (actor: Awaited<ReturnType<typeof requireAdminWriter>>, clientId: string) => Promise<{ ok: boolean; message: string }>, anchor = ""): Promise<never> {
  const clientId = field(data, "client_id");
  if (!UUID.test(clientId)) redirect("/leads");
  let result: { ok: boolean; message: string };
  try { result = await run(await requireAdminWriter(), clientId); }
  catch { result = { ok: false, message: "Action impossible (droits, mode simulation ou service indisponible)." }; }
  done(clientId, result, anchor);
}

export async function saveLeadSettingsAction(data: FormData) {
  await guarded(data, (actor, clientId) => saveLeadSettings(actor, clientId, {
    enabled: field(data, "enabled") === "on", auto_reply: field(data, "auto_reply") === "on", followups: Number(field(data, "followups") || 0),
    notify_email: field(data, "notify_email"), reply_to: field(data, "reply_to"), callback_promise: field(data, "callback_promise"),
    phone: field(data, "phone"), signature: field(data, "signature"), allowed_origins: field(data, "allowed_origins"),
  }), "#reglages");
}
export async function rotateFormKeyAction(data: FormData) {
  if (field(data, "confirm") !== "on") done(field(data, "client_id"), { ok: false, message: "Cochez la case : l’ancien formulaire cessera de fonctionner." }, "#reglages");
  await guarded(data, (actor, clientId) => rotateFormKey(actor, clientId), "#reglages");
}
export async function sendLeadMessageAction(data: FormData) {
  const id = field(data, "message_id");
  await guarded(data, (actor) => sendLeadMessage(id, actor, { subject: field(data, "subject").slice(0, 200), body: field(data, "body").slice(0, 5500) }), `#lead-${field(data, "lead_id")}`);
}
export async function cancelLeadMessageAction(data: FormData) {
  await guarded(data, (actor) => cancelLeadMessage(actor, field(data, "message_id")), `#lead-${field(data, "lead_id")}`);
}
export async function setLeadStateAction(data: FormData) {
  await guarded(data, (actor) => setLeadState(actor, field(data, "lead_id"), field(data, "state")), `#lead-${field(data, "lead_id")}`);
}
export async function retryLeadAction(data: FormData) {
  await guarded(data, (actor) => retryLead(actor, field(data, "lead_id")), `#lead-${field(data, "lead_id")}`);
}
export async function addManualLeadAction(data: FormData) {
  await guarded(data, (actor, clientId) => addManualLead(actor, clientId, {
    name: field(data, "name"), email: field(data, "email"), phone: field(data, "phone"), postcode: field(data, "postcode"), city: field(data, "city"), subject: field(data, "subject"), message: field(data, "message"),
  }));
}
