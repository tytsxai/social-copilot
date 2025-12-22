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

function isCjkChar(char: string): boolean {
  return /[\u4E00-\u9FFF]/.test(char);
}

function estimateTokenUnits(char: string): number {
  return isCjkChar(char) ? 0.5 : 0.25;
}

function clampHeadByTokens(value: string, maxTokens: number): string {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return '';
  let tokenCount = 0;
  let endIndex = 0;

  for (const char of value) {
    const nextCount = tokenCount + estimateTokenUnits(char);
    if (nextCount - maxTokens > Number.EPSILON) break;
    tokenCount = nextCount;
    endIndex += char.length;
  }

  return value.slice(0, endIndex);
}

function clampTailByTokens(value: string, maxTokens: number): string {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return '';
  let tokenCount = 0;
  let startIndex = value.length;

  for (let i = value.length - 1; i >= 0; i -= 1) {
    const char = value[i] ?? '';
    const nextCount = tokenCount + estimateTokenUnits(char);
    if (nextCount - maxTokens > Number.EPSILON) break;
    tokenCount = nextCount;
    startIndex = i;
  }

  return value.slice(startIndex);
}

export function normalizeAndClampLLMInput(input: LLMInput, budgets: InputBudgets): LLMInput {
  const memorySummary = typeof input.memorySummary === 'string'
    ? clampHeadByTokens(normalizeText(input.memorySummary), budgets.maxMemorySummaryChars)
    : undefined;

  const thoughtHint = typeof input.thoughtHint === 'string'
    ? clampHeadByTokens(normalizeText(input.thoughtHint), budgets.maxThoughtHintChars)
    : undefined;

  const profile = input.profile
    ? {
      ...input.profile,
      notes: typeof input.profile.notes === 'string'
        ? clampTailByTokens(normalizeText(input.profile.notes), budgets.maxProfileNotesChars)
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
