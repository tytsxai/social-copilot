import type { LLMInput } from '../types/llm';

export interface InputBudgets {
  maxMemorySummaryChars: number;
  maxThoughtHintChars: number;
  maxProfileNotesChars: number;
}

export const DEFAULT_INPUT_BUDGETS: InputBudgets = {
  maxMemorySummaryChars: 2000,
  maxThoughtHintChars: 600,
  maxProfileNotesChars: 2048,
};

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function clampHead(value: string, maxChars: number): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars);
}

function clampTail(value: string, maxChars: number): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  return value.slice(-maxChars);
}

export function normalizeAndClampLLMInput(input: LLMInput, budgets: InputBudgets): LLMInput {
  const memorySummary = typeof input.memorySummary === 'string'
    ? clampHead(normalizeText(input.memorySummary), budgets.maxMemorySummaryChars)
    : undefined;

  const thoughtHint = typeof input.thoughtHint === 'string'
    ? clampHead(normalizeText(input.thoughtHint), budgets.maxThoughtHintChars)
    : undefined;

  const profile = input.profile
    ? {
      ...input.profile,
      notes: typeof input.profile.notes === 'string'
        ? clampTail(normalizeText(input.profile.notes), budgets.maxProfileNotesChars)
        : input.profile.notes,
    }
    : undefined;

  return {
    ...input,
    profile,
    memorySummary,
    thoughtHint,
  };
}

