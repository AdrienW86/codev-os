// Choix du modèle IA par agent (harness). Module pur : aucune lecture réseau, aucune clé renvoyée ni journalisée.
// Chaque agent appartient à une famille (rédaction, vision, contrôle, stratégie). Clé Anthropic présente et client
// activé (fiche client → Agents) : la famille tourne sur le modèle Claude recommandé (réglable par variable
// d'environnement) ; sinon, comportement d'avant (OpenAI).

type Env = Record<string, string | undefined>;

export type AiFamily = "writing" | "vision" | "review" | "strategy";
export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type ModelChoice =
  | { provider: "openai"; model: string }
  | { provider: "anthropic"; model: string; effort: AiEffort };

/** Modèle OpenAI historique des agents (sorties structurées strictes). Repli quand Anthropic n'est pas configuré. */
export const OPENAI_AGENT_MODEL = "gpt-4.1-mini-2025-04-14";
/** Modèle Claude recommandé pour toutes les familles (rédaction, vision, contrôle, stratégie). */
export const ANTHROPIC_AGENT_MODEL = "claude-opus-5-5";

/** Famille de chaque agent. Un agent absent de la liste (ancien parcours, appel non rattaché) reste sur OpenAI. */
export const agentFamilies: Readonly<Record<string, AiFamily>> = {
  publications: "writing", blog: "writing", visual: "writing", video: "writing", newsletter: "writing", copywriter: "writing",
  "media-library": "vision", "photo-observation": "vision",
  "fact-check": "review", "editorial-review": "review",
  director: "strategy", report: "strategy", seo: "strategy", "google-ads": "strategy", monitoring: "strategy",
  prospection: "strategy", veille: "strategy", "editorial-planning": "strategy",
};

/** Niveau de réflexion par famille : élevé pour écrire et observer, maximal pour contrôler (le contrôle doit être plus exigeant que la rédaction). */
export const familyEffort: Readonly<Record<AiFamily, AiEffort>> = { writing: "high", vision: "high", review: "max", strategy: "high" };

const EFFORTS: readonly AiEffort[] = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_MODEL = /^claude-[a-z0-9.-]{1,60}$/;
const OPENAI_MODEL = /^(gpt-|o\d)[a-z0-9.-]{1,60}$/i;

const clean = (value: string | undefined) => value?.trim() || undefined;

/**
 * Modèle d'un agent. Réglages facultatifs (Vercel → Environment Variables) :
 * - AGENTS_AI_PROVIDER=openai|anthropic : force un fournisseur pour tous les agents et tous les clients (par défaut : Claude
 *   pour les seuls clients activés, claudeAllowed) ;
 * - AI_MODEL_WRITING / AI_MODEL_VISION / AI_MODEL_REVIEW / AI_MODEL_STRATEGY : autre modèle Claude pour une famille ;
 * - AI_EFFORT_<FAMILLE> : low | medium | high | xhigh | max.
 * Une valeur invalide est ignorée (jamais transmise au fournisseur).
 */
export function modelForAgent(agent: string | undefined, env: Env = process.env, options: { claudeAllowed?: boolean } = {}): ModelChoice {
  const hasOpenAI = Boolean(clean(env.OPENAI_API_KEY)), hasAnthropic = Boolean(clean(env.ANTHROPIC_API_KEY));
  const forced = clean(env.AGENTS_AI_PROVIDER)?.toLowerCase();
  const family = agent ? agentFamilies[agent] : undefined;
  const openai = (): ModelChoice => {
    const custom = clean(env.AI_MODEL_OPENAI);
    return { provider: "openai", model: custom && OPENAI_MODEL.test(custom) ? custom : OPENAI_AGENT_MODEL };
  };
  const anthropic = (): ModelChoice => {
    const f = family ?? "writing";
    const custom = clean(env[`AI_MODEL_${f.toUpperCase()}`]);
    const effort = clean(env[`AI_EFFORT_${f.toUpperCase()}`])?.toLowerCase() as AiEffort | undefined;
    return {
      provider: "anthropic",
      model: custom && CLAUDE_MODEL.test(custom) ? custom : ANTHROPIC_AGENT_MODEL,
      effort: effort && EFFORTS.includes(effort) ? effort : familyEffort[f],
    };
  };
  if (forced === "openai" && hasOpenAI) return openai();
  if (forced === "anthropic" && hasAnthropic) return anthropic();
  // Agent non rattaché à une famille : parcours historique inchangé tant qu'OpenAI est disponible.
  if (!family) return hasOpenAI || !hasAnthropic ? openai() : anthropic();
  // Client non activé : OpenAI comme avant ; sans clé OpenAI, Claude plutôt qu'une panne.
  return hasAnthropic && (options.claudeAllowed || !hasOpenAI) ? anthropic() : openai();
}

/** Modèles Claude qui refusent l'appel d'outil forcé (tool_choice any/tool → erreur 400) : « auto » à la place. */
export const rejectsForcedToolUse = (model: string) => /^claude-(opus-5-5|sonnet-5-5|fable-5-[12]|mythos-5-[12])/.test(model);

/**
 * Schéma JSON accepté par les sorties structurées Anthropic : les contraintes numériques, de longueur et de taille de
 * tableau n'y sont pas prises en charge. Elles sont retirées du schéma envoyé ; chaque appelant valide déjà la sortie.
 */
const UNSUPPORTED_SCHEMA_KEYS = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "format"]);
export function anthropicSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(anthropicSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    // « properties » et « $defs » contiennent des noms de champs, jamais des mots-clés : on ne filtre que leurs valeurs.
    if (key === "properties" || key === "$defs" || key === "definitions") {
      out[key] = Object.fromEntries(Object.entries((value ?? {}) as Record<string, unknown>).map(([name, sub]) => [name, anthropicSchema(sub)]));
    } else if (!UNSUPPORTED_SCHEMA_KEYS.has(key)) out[key] = anthropicSchema(value);
  }
  return out;
}

type OpenAIContent = { type?: unknown; text?: unknown; image_url?: unknown };
type AnthropicContent = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

/** Entrée au format OpenAI Responses (texte, ou messages avec input_text / input_image en data URL) → messages Anthropic. */
export function anthropicMessages(input: unknown): { role: "user" | "assistant"; content: string | AnthropicContent[] }[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [{ role: "user", content: JSON.stringify(input) }];
  return input.map((message) => {
    const m = message as { role?: unknown; content?: unknown };
    const role = m.role === "assistant" ? "assistant" : "user";
    if (typeof m.content === "string") return { role, content: m.content };
    const parts = Array.isArray(m.content) ? (m.content as OpenAIContent[]) : [];
    const content = parts.flatMap((part): AnthropicContent[] => {
      if (part.type === "input_text" && typeof part.text === "string") return [{ type: "text", text: part.text }];
      if (part.type === "input_image" && typeof part.image_url === "string") {
        const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url);
        if (!match) throw new Error("Unsupported image input");
        return [{ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } }];
      }
      throw new Error("Unsupported AI input");
    });
    return { role, content };
  });
}
