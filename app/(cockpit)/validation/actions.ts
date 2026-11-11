"use server";

import { adminMutation, type MutationState } from "@/lib/core/mutation";
import { archiveSupersededReports } from "@/lib/review/inbox-service";

export async function archiveSupersededReportsAction(_: MutationState, _form: FormData): Promise<MutationState> {
  void _form;
  return adminMutation("review-inbox", (actor) => archiveSupersededReports(actor), ["/validation", "/reports", "/dashboard"]);
}
