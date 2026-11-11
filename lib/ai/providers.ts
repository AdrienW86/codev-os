import "server-only";
// Adaptateurs OpenAI (Chat Completions) et Anthropic (Messages), sans SDK : appels HTTPS via la liste
// blanche de providerJson. Les clés restent côté serveur ; aucune n'est journalisée ni renvoyée.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import type { AIProvider, AIResponse, AIUsage, ChatMessage, ToolCall, ToolResultMessage, ToolSpec } from "@/lib/ai/types";

type Env = Record<string, string | undefined>;
const MAX_TOKENS = 800;
const outputBudget = (requested: number | undefined) => Math.min(Math.max(Math.round(requested ?? MAX_TOKENS), 200), 8000);
/** Une sortie plus longue demande plus de temps : 30 s par défaut, jusqu’à 90 s pour 8000 jetons. */
const timeoutFor = (tokens: number) => Math.min(90_000, Math.max(30_000, tokens * 12));

function parseArguments(raw: unknown) {
  if (typeof raw !== "string") return raw ?? {};
  try { return JSON.parse(raw); } catch { return { __invalid: true }; }
}

/** Jetons facturés renvoyés par le fournisseur ; absents ou invalides : aucune mesure inventée. */
function usageOf(input: unknown, output: unknown): { usage?: AIUsage } {
  return Number.isInteger(input) && Number.isInteger(output) && (input as number) >= 0 && (output as number) >= 0 ? { usage: { inputTokens: input as number, outputTokens: output as number } } : {};
}

/** Modèles de raisonnement OpenAI (gpt-5*, o1/o3/o4…) : température non réglable. */
export const isOpenAIReasoningModel = (model: string) => /^(o\d|gpt-5)/i.test(model);

export function createOpenAIProvider(apiKey: string, model: string, fetchImpl?: FetchLike): AIProvider {
  return {
    id: "openai", model,
    async ping(signal) {
      await providerJson("openai", `https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { fetchImpl, signal, timeoutMs: 10_000, headers: { Authorization: `Bearer ${apiKey}` } });
    },
    async complete({ system, messages, tools, toolChoice = "auto", toolResults = [], signal, maxTokens }) {
      const budget = outputBudget(maxTokens);
      const pending = toolResults.length ? [
        { role: "assistant", content: null, tool_calls: toolResults.map(({ call }) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) } })) },
        ...toolResults.map(({ call, result }) => ({ role: "tool", tool_call_id: call.id, content: result })),
      ] : [];
      const data = await providerJson<{ usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }; choices?: { message?: { content?: unknown; tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[] } }[] }>("openai", "https://api.openai.com/v1/chat/completions", {
        method: "POST", fetchImpl, signal, timeoutMs: timeoutFor(budget),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // max_completion_tokens : accepté par tous les modèles de chat actuels (max_tokens est refusé par gpt-5 / o*).
          model, max_completion_tokens: isOpenAIReasoningModel(model) ? budget * 4 : budget,
          ...(isOpenAIReasoningModel(model) ? {} : { temperature: 0.2 }),
          messages: [{ role: "system", content: system }, ...messages, ...pending],
          ...(tools.length ? { tools: tools.map((tool) => ({ type: "function", function: tool })), tool_choice: toolChoice, parallel_tool_calls: false } : {}),
        }),
      });
      const message = data.choices?.[0]?.message;
      if (!message) throw new ProviderError("openai", "malformed");
      const toolCalls: ToolCall[] = (message.tool_calls ?? []).flatMap((call) => typeof call.function?.name === "string" ? [{ id: String(call.id ?? call.function.name), name: call.function.name, arguments: parseArguments(call.function.arguments) }] : []);
      return { text: typeof message.content === "string" ? message.content : "", toolCalls, ...usageOf(data.usage?.prompt_tokens, data.usage?.completion_tokens) };
    },
  };
}

export function createAnthropicProvider(apiKey: string, model: string, fetchImpl?: FetchLike): AIProvider {
  return {
    id: "anthropic", model,
    async ping(signal) {
      await providerJson("anthropic", `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, { fetchImpl, signal, timeoutMs: 10_000, headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } });
    },
    async complete({ system, messages, tools, toolChoice = "auto", toolResults = [], signal, maxTokens }) {
      const budget = outputBudget(maxTokens);
      const pending = toolResults.length ? [
        { role: "assistant", content: toolResults.map(({ call }) => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments ?? {} })) },
        { role: "user", content: toolResults.map(({ call, result }) => ({ type: "tool_result", tool_use_id: call.id, content: result })) },
      ] : [];
      const data = await providerJson<{ usage?: { input_tokens?: unknown; output_tokens?: unknown }; content?: { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown }[] }>("anthropic", "https://api.anthropic.com/v1/messages", {
        method: "POST", fetchImpl, signal, timeoutMs: timeoutFor(budget),
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model, max_tokens: budget, temperature: 0.2, system,
          messages: [...messages, ...pending],
          ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })), tool_choice: toolChoice === "required" ? { type: "any" } : { type: "auto" } } : {}),
        }),
      });
      if (!Array.isArray(data.content)) throw new ProviderError("anthropic", "malformed");
      const text = data.content.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text as string).join("\n");
      const toolCalls: ToolCall[] = data.content.flatMap((block) => block.type === "tool_use" && typeof block.name === "string" ? [{ id: String(block.id ?? block.name), name: block.name, arguments: block.input ?? {} }] : []);
      return { text, toolCalls, ...usageOf(data.usage?.input_tokens, data.usage?.output_tokens) };
    },
  };
}

/**
 * Choix du fournisseur : AI_PROVIDER=openai|anthropic s'il est configuré, sinon le premier disponible.
 * `null` : aucun fournisseur → l'orchestrateur utilise l'analyseur d'intentions déterministe.
 */
export function selectAIProvider(env: Env = process.env, fetchImpl?: FetchLike): AIProvider | null {
  const openai = env.OPENAI_API_KEY?.trim();
  const anthropic = env.ANTHROPIC_API_KEY?.trim();
  const preferred = env.AI_PROVIDER?.trim().toLowerCase();
  const build = (id: "openai" | "anthropic") => id === "openai"
    ? (openai ? createOpenAIProvider(openai, env.ASSISTANT_OPENAI_MODEL?.trim() || "gpt-4.1-mini", fetchImpl) : null)
    : (anthropic ? createAnthropicProvider(anthropic, env.ASSISTANT_ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5", fetchImpl) : null);
  if (preferred === "openai" || preferred === "anthropic") return build(preferred) ?? build(preferred === "openai" ? "anthropic" : "openai");
  return build("openai") ?? build("anthropic");
}

export type { AIResponse, ChatMessage, ToolSpec, ToolResultMessage };
