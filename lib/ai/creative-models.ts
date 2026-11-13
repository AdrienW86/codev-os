// Allowlisted task-specific models. No production cutover until representative evals pass.
export const DEFAULT_CREATIVE_MODEL = "gpt-4.1-mini-2025-04-14" as const;
export type CreativeTask = "publications" | "blog" | "visual" | "video" | "media";
const taskVariables: Record<CreativeTask, string> = {
  publications: "CODEV_PUBLICATIONS_MODEL",
  blog: "CODEV_BLOG_MODEL",
  visual: "CODEV_VISUAL_MODEL",
  video: "CODEV_VIDEO_MODEL",
  media: "CODEV_MEDIA_MODEL",
};
export const APPROVED_CREATIVE_MODELS = [
  DEFAULT_CREATIVE_MODEL, "gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol",
] as const;
const approved = new Set<string>(APPROVED_CREATIVE_MODELS);

export function creativeModelFor(task: CreativeTask, env: Record<string, string | undefined> = process.env): string {
  const raw = env[taskVariables[task]];
  if (raw === undefined || raw.trim() === "") return DEFAULT_CREATIVE_MODEL;
  const model = raw.trim();
  if (!approved.has(model)) throw new Error("AI_MODEL_NOT_APPROVED");
  return model;
}
// Tarifs publics USD par million de tokens ; conversion prudente x1,25 conservée.
const rates: Record<string, readonly [number, number]> = {
  [DEFAULT_CREATIVE_MODEL]: [0.4, 1.6],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-6-luna": [0.1, 0.5],
  "gpt-6.1-terra": [1, 5],
  "gpt-6.1-sol": [2, 10],
};
export function estimateCreativeCostEur(model: string, inputTokens: number, outputTokens: number): number {
  const [inRate, outRate] = rates[model] ?? [10, 50];
  if (![inputTokens, outputTokens].every(x => Number.isInteger(x) && x >= 0)) throw new Error("AI_INVALID_USAGE");
  return Math.ceil((inputTokens * inRate + outputTokens * outRate) * 1.25) / 1_000_000;
}
export function creativeReasoning(model: string): { effort: "none" | "low" } | null {
  if (model === "gpt-6-luna" || model === "gpt-6.1-terra") return { effort: "none" };
  if (model === "gpt-6.1-sol") return { effort: "low" };
  return null;
}
