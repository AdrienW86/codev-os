import "server-only";
// Adaptateurs OpenAI (Chat Completions) et Anthropic (Messages), sans SDK : appels HTTPS via la liste
// blanche de providerJson. Les clés restent côté serveur ; aucune n'est journalisée ni renvoyée.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import type { AIProvider, AIResponse, ChatMessage, ToolCall, ToolResultMessage, ToolSpec } from "@/lib/ai/types";

type Env = Record<string, string | undefined>;
const MAX_TOKENS = 800;

function parseArguments(raw: unknown) {
  if (typeof raw !== "string") return raw ?? {};
  try { return JSON.parse(raw); } catch { return { __invalid: true }; }
}

/** Modèles de raisonnement OpenAI (gpt-5*, o1/o3/o4…) : température non réglable. */
export const isOpenAIReasoningModel = (model: string) => /^(o\d|gpt-5)/i.test(model);

export function createOpenAIProvider(apiKey: string, model: string, fetchImpl?: FetchLike): AIProvider {
  return {
    id: "openai", model,
    async ping(signal) {
      await providerJson("openai", `https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { fetchImpl, signal, timeoutMs: 10_000, headers: { Authorization: `Bearer ${apiKey}` } });
    },
    async complete({ system, messages, tools, toolResults = [], signal }) {
      const pending = toolResults.length ? [
        { role: "assistant", content: null, tool_calls: toolResults.map(({ call }) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) } })) },
        ...toolResults.map(({ call, result }) => ({ role: "tool", tool_call_id: call.id, content: result })),
      ] : [];
      const data = await providerJson<{ choices?: { message?: { content?: unknown; tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[] } }[] }>("openai", "https://api.openai.com/v1/chat/completions", {
        method: "POST", fetchImpl, signal, timeoutMs: 30_000,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // max_completion_tokens : accepté par tous les modèles de chat actuels (max_tokens est refusé par gpt-5 / o*).
          model, max_completion_tokens: isOpenAIReasoningModel(model) ? MAX_TOKENS * 4 : MAX_TOKENS,
          ...(isOpenAIReasoningModel(model) ? {} : { temperature: 0.2 }),
          messages: [{ role: "system", content: system }, ...messages, ...pending],
          ...(tools.length ? { tools: tools.map((tool) => ({ type: "function", function: tool })), tool_choice: "auto", parallel_tool_calls: false } : {}),
        }),
      });
      const message = data.choices?.[0]?.message;
      if (!message) throw new ProviderError("openai", "malformed");
      const toolCalls: ToolCall[] = (message.tool_calls ?? []).flatMap((call) => typeof call.function?.name === "string" ? [{ id: String(call.id ?? call.function.name), name: call.function.name, arguments: parseArguments(call.function.arguments) }] : []);
      return { text: typeof message.content === "string" ? message.content : "", toolCalls };
    },
  };
}

export function createAnthropicProvider(apiKey: string, model: string, fetchImpl?: FetchLike): AIProvider {
  return {
    id: "anthropic", model,
    async ping(signal) {
      await providerJson("anthropic", `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, { fetchImpl, signal, timeoutMs: 10_000, headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } });
    },
    async complete({ system, messages, tools, toolResults = [], signal }) {
      const pending = toolResults.length ? [
        { role: "assistant", content: toolResults.map(({ call }) => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments ?? {} })) },
        { role: "user", content: toolResults.map(({ call, result }) => ({ type: "tool_result", tool_use_id: call.id, content: result })) },
      ] : [];
      const data = await providerJson<{ content?: { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown }[] }>("anthropic", "https://api.anthropic.com/v1/messages", {
        method: "POST", fetchImpl, signal, timeoutMs: 30_000,
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model, max_tokens: MAX_TOKENS, temperature: 0.2, system,
          messages: [...messages, ...pending],
          ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
        }),
      });
      if (!Array.isArray(data.content)) throw new ProviderError("anthropic", "malformed");
      const text = data.content.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text as string).join("\n");
      const toolCalls: ToolCall[] = data.content.flatMap((block) => block.type === "tool_use" && typeof block.name === "string" ? [{ id: String(block.id ?? block.name), name: block.name, arguments: block.input ?? {} }] : []);
      return { text, toolCalls };
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
