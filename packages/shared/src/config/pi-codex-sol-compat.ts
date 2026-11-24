export const CODEX_SOL_62_ID = 'gpt-6.2-sol';
export const CODEX_SOL_COMPAT_BASE_ID = 'gpt-6.1-sol';

/**
 * Bridge the pinned Pi catalog until it carries GPT-6.2 Sol natively.
 * Keep the existing Codex transport and use the new model ID and context window
 * from the authenticated Codex catalog. This is not a pricing definition.
 */
export function makeCodexSol62Fallback<T extends { id: string; name: string; contextWindow: number }>(base: T): T {
  return { ...base, id: CODEX_SOL_62_ID, name: 'GPT-6.2 Sol', contextWindow: 500_000 };
}

/** Add only to the Codex subscription catalog, without mutating SDK data or reordering it. */
export function withCodexSol62Fallback<T extends { id: string; name: string; contextWindow: number }>(
  provider: string,
  models: readonly T[],
): readonly T[] {
  if (provider !== 'openai-codex' || models.some(model => model.id === CODEX_SOL_62_ID)) return models;
  const base = models.find(model => model.id === CODEX_SOL_COMPAT_BASE_ID);
  return base ? [...models, makeCodexSol62Fallback(base)] : models;
}
