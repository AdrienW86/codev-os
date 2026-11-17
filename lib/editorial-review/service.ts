import "server-only";
// Contrôles indépendants (lot 4) : deux appels IA distincts, chacun sous le périmètre de son propre agent (modèle de la
// famille « contrôle », effort maximal ; budget du client). Fermé par défaut : un contrôle qui n'a pas pu tourner
// (IA indisponible, plafond atteint, réponse illisible) fait refuser le texte, jamais l'accepter sans vérification.
import { withCharter } from "@/lib/harness/charter";
import { structuredResponse, withAiScope, isBudgetExceeded } from "@/lib/ai/metered";
import type { RegisterChannel, RegisterEntry } from "@/lib/editorial-register/model";
import {
  DUPLICATE_INSTRUCTIONS, DUPLICATE_SCHEMA, FACT_CHECK_INSTRUCTIONS, FACT_CHECK_SCHEMA, readDuplicateCheck, readFactCheck, reviewMessage,
  type DuplicateCheck, type FactCheck,
} from "./model";

export type ReviewInput = {
  clientId: string; channel: RegisterChannel; title: string; text: string;
  /** Faits autorisés : seule source des affirmations sur l'entreprise. */facts: string;
  exclusions: readonly string[];
  /** Registre éditorial du client (lot 3) : seules les entrées du même canal sont comparées. */register: readonly RegisterEntry[];
};
export type ReviewOutcome =
  | { ok: true; fact: FactCheck; duplicate: DuplicateCheck | null }
  | { ok: false; reason: "rejected"; message: string; fact: FactCheck | null; duplicate: DuplicateCheck | null }
  | { ok: false; reason: "unavailable"; message: string };

const log = (step: string, code: string) => console.error("[editorial-review]", { step, code });

export async function reviewContent(input: ReviewInput): Promise<ReviewOutcome> {
  const sameChannel = input.register.filter((e) => e.channel === input.channel).slice(0, 60);
  const [fact, duplicate] = await Promise.allSettled([
    withAiScope({ agent: "fact-check", clientId: input.clientId }, async () => {
      const { value } = await structuredResponse(withCharter("fact-check", FACT_CHECK_INSTRUCTIONS), JSON.stringify({
        text_to_check_untrusted: `${input.title}\n\n${input.text}`.slice(0, 16000), facts_untrusted: input.facts.slice(0, 8000),
        client_exclusions_never_write: input.exclusions.slice(0, 30),
      }), FACT_CHECK_SCHEMA, { maxOutputTokens: 3000, timeoutMs: 120000 });
      return readFactCheck(value, input.facts);
    }),
    sameChannel.length ? withAiScope({ agent: "editorial-review", clientId: input.clientId }, async () => {
      const { value } = await structuredResponse(withCharter("editorial-review", DUPLICATE_INSTRUCTIONS), JSON.stringify({
        new_content_untrusted: { title: input.title, opening: input.text.slice(0, 1500) },
        register: sameChannel.map((e, id) => ({ id, date: e.date.slice(0, 10), topic: e.topic.slice(0, 200) })),
      }), DUPLICATE_SCHEMA, { maxOutputTokens: 800, timeoutMs: 90000 });
      return readDuplicateCheck(value, sameChannel);
    }) : Promise.resolve(null),
  ]);
  if (fact.status === "rejected" || duplicate.status === "rejected") {
    const error = fact.status === "rejected" ? fact.reason : (duplicate as PromiseRejectedResult).reason;
    log(fact.status === "rejected" ? "fact-check" : "duplicate", isBudgetExceeded(error) ? "budget" : "failed");
    return { ok: false, reason: "unavailable", message: isBudgetExceeded(error)
      ? "Contrôle indépendant impossible : plafond IA du mois atteint pour ce client. Rien n’a été enregistré."
      : "Contrôle indépendant indisponible (IA). Rien n’a été enregistré ; réessayez plus tard." };
  }
  if (fact.value.passed && (!duplicate.value || duplicate.value.passed)) return { ok: true, fact: fact.value, duplicate: duplicate.value };
  return { ok: false, reason: "rejected", message: reviewMessage(fact.value, duplicate.value), fact: fact.value, duplicate: duplicate.value };
}
