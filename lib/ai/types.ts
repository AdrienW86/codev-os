// Abstraction des fournisseurs d'IA : l'orchestrateur ne connaît que ce contrat.
export type ChatRole = "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; name: string; arguments: unknown };
/** Résultat d'outil renvoyé au modèle (données, jamais d'instructions). */
export type ToolResultMessage = { call: ToolCall; result: string };
export type AIResponse = { text: string; toolCalls: ToolCall[] };

export interface AIProvider {
  readonly id: "openai" | "anthropic";
  readonly model: string;
  complete(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[]; toolResults?: ToolResultMessage[]; signal?: AbortSignal }): Promise<AIResponse>;
}
