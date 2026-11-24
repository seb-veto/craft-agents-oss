/**
 * Session title generation utilities.
 *
 * Shared helpers for building title prompts and validating results.
 * Actual title generation is handled by agent classes using their respective SDKs:
 * - ClaudeAgent: Uses Claude SDK query()
 * - PiAgent: Uses Pi SDK queryLlm()
 */

/** Slice text at the last word boundary within `max` characters. */
export function sliceAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const lastSpace = text.lastIndexOf(' ', max);
  return lastSpace > 0 ? text.slice(0, lastSpace) : text.slice(0, max);
}

/**
 * Check if text before a colon looks like LLM preamble.
 * Matches: "Title", "Topic", "Sure", "Sure, the title is", "Here's the topic", etc.
 */
function isPreamblePrefix(text: string): boolean {
  const lower = text.trim().toLowerCase();
  // Exact single-word preamble
  if (/^(?:title|topic|sure|okay|ok)$/.test(lower)) return true;
  // Starts with a known opener and optionally references title/topic
  if (/^(?:sure|okay|ok|here(?:'s| is))\b/.test(lower)) return true;
  // "the title/topic is" or similar
  if (/^the\s+(?:title|topic)\b/.test(lower)) return true;
  return false;
}

/**
 * Sanitize a language preference string before prompt interpolation.
 * Returns undefined for invalid/suspicious inputs so the caller falls back to auto-detect.
 */
export function sanitizeLanguage(language?: string): string | undefined {
  if (!language) return undefined;
  const trimmed = language.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || trimmed.length > 40) return undefined;
  // Allow letters (any script), Unicode marks, spaces, hyphens
  if (!/^[\p{L}\p{M}\s\-]+$/u.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Title style shared by the initial and regenerate prompts: short, recognizable task
 * names (an imperative verb and object, or a concrete role/check label) rather than
 * descriptions of the conversation.
 */
const TITLE_STYLE_RULES = [
  'Use 2-6 words. For work, start with a plain imperative verb and its object ("Fix Login Redirects", "Ship Designer"). For a standing role, recurring check or system, use a concrete noun label ("Codex Health Check", "Software Factory").',
  'Keep product names, version numbers and iteration suffixes exactly ("Ship Palomar v0.01.01"). If the user names the chat, use that name exactly.',
  'Do not describe the conversation or its state: no "-ing" openers, no words like Question, Discussion, Request, Investigation or Help, no status words, emoji, ticket IDs or markdown.',
];

/** The model's answer when the messages do not say what the task is. */
export const NO_TITLE_SENTINEL = 'NONE';

const TITLE_EXAMPLES =
  'Examples: "Ship Designer", "Ship Palomar v0.01.01", "Codex Health Check", "Software Factory", "Resource the insight factory", "Fix Login Redirects"';

/**
 * Build a language instruction for title prompts.
 * Explicit preference takes priority; otherwise auto-detect from message content.
 */
function buildLanguageInstruction(language?: string): string {
  const safe = sanitizeLanguage(language);
  if (safe) {
    return `Reply in ${safe}.`;
  }
  return 'Reply in the same language as the user\'s messages.';
}

/**
 * Build a prompt for generating a session title from a user message.
 *
 * @param message - The user's message to generate a title from
 * @param options.language - Preferred language for the title
 * @returns Formatted prompt string
 */
export function buildTitlePrompt(message: string, options?: { language?: string }): string {
  const snippet = sliceAtWord(message, 500);
  return [
    'Name the task this chat is for, the way a person labels it in a sidebar. Reply with ONLY the title, in plain text.',
    ...TITLE_STYLE_RULES,
    `If the message does not say what the task is (for example "Can you take this on?" or "continue"), reply with exactly ${NO_TITLE_SENTINEL}.`,
    buildLanguageInstruction(options?.language),
    TITLE_EXAMPLES,
    '',
    'User: ' + snippet,
    '',
    'Title:',
  ].join('\n');
}

/** Max characters for a message to be considered potentially low-signal. */
const LOW_SIGNAL_MAX_CHARS = 12;
/** Max words for a message to be considered potentially low-signal. */
const LOW_SIGNAL_MAX_WORDS = 2;

/**
 * Check if a message is likely low-signal (short acknowledgement/command).
 * Language-agnostic: uses length + word count only.
 */
export function isLowSignal(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length > LOW_SIGNAL_MAX_CHARS) return false;
  if (trimmed.split(/\s+/).length > LOW_SIGNAL_MAX_WORDS) return false;
  // If it contains a question mark, it's probably a real question
  if (trimmed.includes('?')) return false;
  return true;
}

/**
 * Select a spread of user messages that captures the session's purpose:
 * first (original intent), a recent-biased middle, and last (current state).
 *
 * Strips trailing low-signal messages (short acknowledgements like "ok", "thanks")
 * before selecting, so the spread focuses on substantive content.
 * Falls back to unfiltered if all messages are low-signal.
 *
 * For 4+ messages, picks at indices 0, ~66%, and last — biasing toward
 * where the conversation ended up rather than the exact midpoint.
 */
export function selectSpreadMessages(allUserMessages: string[]): string[] {
  const count = allUserMessages.length;
  if (count === 0) return [];

  // Strip trailing low-signal messages
  let filtered = allUserMessages;
  let trimEnd = allUserMessages.length;
  while (trimEnd > 0 && isLowSignal(allUserMessages[trimEnd - 1]!)) {
    trimEnd--;
  }
  if (trimEnd > 0) {
    filtered = allUserMessages.slice(0, trimEnd);
  }
  // else: all messages are low-signal, keep original array

  const n = filtered.length;
  if (n === 1) return [filtered[0]!];
  if (n === 2) return [filtered[0]!, filtered[1]!];
  if (n === 3) return [filtered[0]!, filtered[1]!, filtered[2]!];

  const midIndex = Math.floor(n * 2 / 3);
  return [filtered[0]!, filtered[midIndex]!, filtered[n - 1]!];
}

/** Build a label for the user messages section based on how many were selected. */
function messagesSectionLabel(count: number): string {
  if (count === 1) return 'User message:';
  if (count === 2) return 'User messages (first, last):';
  return 'Selected user messages:';
}

/**
 * Build a prompt for regenerating a session title from recent messages.
 *
 * @param recentUserMessages - Spread of user messages (first, middle, last)
 * @param lastAssistantResponse - The most recent assistant response
 * @param options.language - Preferred language for the title
 * @returns Formatted prompt string
 */
export function buildRegenerateTitlePrompt(
  recentUserMessages: string[],
  lastAssistantResponse: string,
  options?: { language?: string }
): string {
  const userContext = recentUserMessages
    .map((msg) => sliceAtWord(msg, 500))
    .join('\n\n');
  const assistantSnippet = sliceAtWord(lastAssistantResponse, 500);

  const lines: string[] = [
    'Name the task this chat is for, based on these messages, the way a person labels it in a sidebar. Name the lasting goal, not the latest step. Reply with ONLY the title, in plain text.',
    ...TITLE_STYLE_RULES,
    'Ignore short acknowledgement messages (like "ok", "thanks", "do it") that don\'t carry topic information.',
    `If the messages never say what the task is, reply with exactly ${NO_TITLE_SENTINEL}.`,
    buildLanguageInstruction(options?.language),
    TITLE_EXAMPLES,
  ];

  lines.push(
    '',
    messagesSectionLabel(recentUserMessages.length),
    userContext,
    '',
    'Latest assistant response:',
    assistantSnippet,
    '',
    'Title:',
  );

  return lines.join('\n');
}

/** Max word count for a valid title. Anything above this is likely preamble leakage. */
const MAX_TITLE_WORDS = 10;

/**
 * Titles that describe a missing task instead of naming one ("Unclear Topic",
 * "Ambiguous request: ..."). Treated like no title so the next message can name the chat.
 */
const NON_TITLE_PATTERN =
  /^(?:untitled|new chat|(?:ambiguous|unclear|vague|unknown|unspecified|undefined|no)(?:\s+\S+)?\s+(?:request|topic|task|question|inquiry|query|message|context)s?)\b/i;

/**
 * Validate and clean a generated title.
 *
 * Iteratively strips known LLM preamble artifacts (leading "Title:", "Sure:", etc.),
 * then removes quotes and markdown formatting, and checks length/word-count bounds.
 *
 * @param title - The raw title from the model
 * @returns Cleaned title, or null if invalid
 */
export function validateTitle(title: string | null | undefined): string | null {
  if (!title) return null;

  let cleaned = title.trim();

  // Iterative preamble stripping: handles chained preambles like "Sure: Title: Foo"
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    const colonIndex = cleaned.indexOf(':');
    if (colonIndex > 0 && colonIndex < 40) {
      const beforeColon = cleaned.slice(0, colonIndex);
      if (isPreamblePrefix(beforeColon)) {
        cleaned = cleaned.slice(colonIndex + 1).trim();
      }
    }
  }

  // Strip surrounding quotes
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }

  // Strip surrounding bold markers **title**
  if (cleaned.startsWith('**') && cleaned.endsWith('**')) {
    cleaned = cleaned.slice(2, -2);
  }

  // Strip leading markdown heading markers (one or more #, -, *)
  cleaned = cleaned.replace(/^[#\-*]+\s+/, '');

  cleaned = cleaned.trim();

  // Reject empty, too long, or too many words (likely preamble leakage)
  if (cleaned.length === 0 || cleaned.length >= 100) return null;
  // The model found no task to name, or named the missing task itself
  if (cleaned.replace(/[.!]+$/, '').toUpperCase() === NO_TITLE_SENTINEL) return null;
  if (NON_TITLE_PATTERN.test(cleaned)) return null;
  if (cleaned.split(/\s+/).length > MAX_TITLE_WORDS) return null;

  return cleaned;
}
