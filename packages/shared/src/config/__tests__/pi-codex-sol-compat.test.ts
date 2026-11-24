import { describe, expect, it } from 'bun:test';
import '../../../tests/setup/register-pi-model-resolver.ts';
import { getDefaultModelForConnection } from '../llm-connections.ts';
import { getAllPiModels, getPiModelsForAuthProvider } from '../models-pi.ts';
import { withCodexSol62Fallback } from '../pi-codex-sol-compat.ts';

type CatalogModel = { id: string; name: string; contextWindow: number; transport: string };
const base: Readonly<CatalogModel> = Object.freeze({ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 272_000, transport: 'codex' });

describe('Codex Sol compatibility catalog', () => {
  it('appends to the Codex catalog without touching the original array or model', () => {
    const original = Object.freeze([base]);
    const result = withCodexSol62Fallback('openai-codex', original);
    expect(result).toEqual([base, { ...base, id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', contextWindow: 500_000 }]);
    expect(result[0]).toBe(base);
    expect(original).toEqual([base]);
    expect(withCodexSol62Fallback('openai-codex', result)).toBe(result);
  });

  it('preserves native metadata and does not add a model without the Codex base', () => {
    const models = [base, { ...base, id: 'gpt-6.2-sol', name: 'Native', contextWindow: 872_000 }];
    expect(withCodexSol62Fallback('openai-codex', models)).toBe(models);
    const withoutBase: typeof models = [];
    expect(withCodexSol62Fallback('openai-codex', withoutBase)).toBe(withoutBase);
    expect(withCodexSol62Fallback('openai', [base])).toEqual([base]);
  });

  it('exposes Sol through Pi discovery and leaves the Codex default policy alone', () => {
    const match = getPiModelsForAuthProvider('openai-codex').filter(model => model.id === 'pi/gpt-6.2-sol');
    expect(match).toHaveLength(1);
    expect(match[0]?.contextWindow).toBeGreaterThanOrEqual(500_000);
    expect(getAllPiModels()).toContainEqual(match[0]!);
    expect(getDefaultModelForConnection('pi', 'openai-codex')).toBe('pi/gpt-6-astra');
  });
});
