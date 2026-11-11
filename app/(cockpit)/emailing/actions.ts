"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminWriter } from "@/lib/core/guards";
import { approveNewsletter, cancelNewsletter, generateNewsletter, importContacts, sendNewsletterBatch } from "@/lib/emailing/newsletter-service";
import { isConsentBasis } from "@/lib/emailing/contacts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const field = (data: FormData, name: string) => { const v = data.get(name); return typeof v === "string" ? v : ""; };

function done(clientId: string, result: { ok: boolean; message: string }): never {
  revalidatePath("/emailing");
  redirect(`/emailing?${new URLSearchParams({ client: clientId, msg: result.message.slice(0, 300), ok: result.ok ? "1" : "0" })}`);
}

async function guarded(clientId: string, run: (actor: Awaited<ReturnType<typeof requireAdminWriter>>) => Promise<{ ok: boolean; message: string }>): Promise<never> {
  if (!UUID.test(clientId)) redirect("/emailing");
  let result: { ok: boolean; message: string };
  try { result = await run(await requireAdminWriter()); }
  catch { result = { ok: false, message: "Action impossible (droits, mode simulation ou service indisponible)." }; }
  done(clientId, result);
}

export async function generateNewsletterAction(data: FormData) {
  const clientId = field(data, "client_id");
  await guarded(clientId, (actor) => generateNewsletter(actor, clientId));
}
export async function approveNewsletterAction(data: FormData) {
  const clientId = field(data, "client_id");
  await guarded(clientId, (actor) => approveNewsletter(actor, field(data, "id")));
}
export async function cancelNewsletterAction(data: FormData) {
  const clientId = field(data, "client_id");
  await guarded(clientId, (actor) => cancelNewsletter(actor, field(data, "id")));
}
export async function sendNewsletterAction(data: FormData) {
  const clientId = field(data, "client_id");
  if (field(data, "confirm") !== "on") done(clientId, { ok: false, message: "Cochez la confirmation avant d'envoyer." });
  await guarded(clientId, (actor) => sendNewsletterBatch(actor, field(data, "id")));
}
export async function importContactsAction(data: FormData) {
  const clientId = field(data, "client_id");
  const basis = field(data, "basis");
  if (!isConsentBasis(basis)) done(clientId, { ok: false, message: "Choisissez la base légale du consentement." });
  await guarded(clientId, (actor) => importContacts(actor, clientId, field(data, "emails").slice(0, 400_000), basis, field(data, "source")));
}
