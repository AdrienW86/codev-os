"use server";

import { adminMutation, formText, type MutationState } from "@/lib/core/mutation";
import { createAgendaItem, setAgendaItemStatus } from "@/lib/agenda/service";

const paths = ["/agenda", "/dashboard"];

export async function createAgendaItemAction(_: MutationState, form: FormData): Promise<MutationState> {
  const input = {
    kind: formText(form, "kind", 20), title: formText(form, "title", 201), notes: formText(form, "notes", 4001) || undefined,
    clientId: formText(form, "client_id", 40) || null, startsLocal: `${formText(form, "date", 10)}T${formText(form, "time", 5)}`,
    durationMinutes: formText(form, "duration", 5) || "60", recurrence: formText(form, "recurrence", 10) || "none",
    recurrenceUntil: formText(form, "recurrence_until", 10) || null, priority: formText(form, "priority", 10) || "normal",
  };
  return adminMutation("agenda", (actor) => createAgendaItem(actor, input), paths);
}

export async function completeAgendaItemAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = formText(form, "id", 40);
  return adminMutation("agenda", (actor) => setAgendaItemStatus(actor, id, "done"), paths);
}

export async function cancelAgendaItemAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = formText(form, "id", 40);
  return adminMutation("agenda", (actor) => setAgendaItemStatus(actor, id, "cancelled"), paths);
}
