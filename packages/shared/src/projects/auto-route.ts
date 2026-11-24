import type { ProjectConfig } from './types.ts';

// Local, deterministic defaults for the common departmental projects. These only apply when
// that project actually exists; custom projects use their name and distinctive description.
// We deliberately don't call a model or learn from other chats (privacy, latency, no new cost).
const DEPARTMENT_SIGNALS: Record<string, string[]> = {
  growth: [
    'cold email', 'outbound', 'prospects', 'prospecting', 'lead generation', 'seo', 'marketing',
    'campaign', 'campaigns', 'conversion', 'landing page', 'advertising', 'sales', 'gtm',
    'customer acquisition', 'fundraising', 'pitch deck',
  ],
  operations: [
    'craft agents', 'veto agents', 'mcp', 'agent skills', 'agent workflow', 'automation',
    'automations', 'payroll', 'invoices', 'invoice', 'accounting', 'bookkeeping', 'billing',
    'reconcile', 'calendar', 'scheduling', 'hiring', 'recruiting', 'legal', 'compliance',
    'workspace setup', 'tool setup',
  ],
  product: [
    'bug', 'bugs', 'checkout', 'onboarding', 'ui', 'ux', 'accessibility', 'database',
    'migration', 'unit tests', 'feature', 'features', 'prototype', 'frontend', 'backend',
    'api endpoint', 'app design', 'code review', 'refactor',
  ],
};
const STOP_WORDS = new Set(('a an and are as at be by can for from how i in is it my of on or our that the this to we with you your '
  + 'project projects work important plan planning help improve add build create make new set fix using use').split(' '));

function words(text: string): string[] {
  return text.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? [];
}
function phrase(text: string): string { return words(text).join(' '); }
function contains(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}
function descriptiveTerms(project: ProjectConfig): Set<string> {
  return new Set(words(`${project.description ?? ''} ${project.details ?? ''}`.slice(0, 8_000))
    .filter(word => word.length >= 4 && !STOP_WORDS.has(word)));
}

/**
 * Return a strong, unique match, or null. Repeated words don't raise confidence and ties do
 * not depend on directory order. Input and project descriptions stay entirely on this machine.
 * This is categorization, not authorization: callers must never change permissions, execution
 * directories, model choice or source access based on this result.
 */
export function chooseProjectForMessage(message: string, projects: readonly ProjectConfig[]): string | null {
  const active = projects.filter(project => !project.archivedAt);
  if (!active.length) return null;
  const text = phrase(message.slice(0, 8_000));
  if (!text) return null;
  const messageWords = new Set(words(message.slice(0, 8_000)));
  const terms = active.map(descriptiveTerms);
  const frequency = new Map<string, number>();
  for (const set of terms) for (const term of set) frequency.set(term, (frequency.get(term) ?? 0) + 1);

  const scores = active.map((project, index) => {
    const name = phrase(project.name);
    const slug = phrase(project.slug);
    const department = DEPARTMENT_SIGNALS[name] ? name : DEPARTMENT_SIGNALS[slug] ? slug : undefined;
    // Department names are common nouns ("product launch"); don't let one word decide.
    const names = new Set([name, slug].filter(value => value && !STOP_WORDS.has(value)));
    let score = [...names].some(value => contains(text, value)) ? (department ? 2 : 8) : 0;
    if (department) {
      for (const signal of DEPARTMENT_SIGNALS[department]!) {
        if (contains(text, signal)) score += signal.includes(' ') ? 6 : 4;
      }
    }
    for (const term of terms[index]!) {
      if (frequency.get(term) === 1 && messageWords.has(term)) score += 4;
    }
    return { id: project.id, score };
  }).sort((a, b) => b.score - a.score);

  const best = scores[0]!;
  const second = scores[1]?.score ?? 0;
  return best.score >= 6 && best.score - second >= 3 ? best.id : null;
}
