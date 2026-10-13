// Modules Publications de l'assistant (phase 6) chargés pour les suites qui chargent intents.ts / orchestrator.ts /
// tools.ts : dépendances pures, sans base ni réseau.
import { loadTs } from "./load-ts.mjs";

export function publicationsModules(text = loadTs("lib/assistant/text.ts")) {
  const mediaModel = loadTs("lib/media-intelligence/model.ts");
  const model = loadTs("lib/assistant/publications-model.ts", { "@/lib/media-intelligence/model": mediaModel });
  const intents = loadTs("lib/assistant/publications-intents.ts", { "@/lib/assistant/text": text, "@/lib/assistant/publications-model": model });
  return { mediaModel, model, intents, mocks: { "@/lib/assistant/publications-model": model, "@/lib/assistant/publications-intents": intents } };
}
