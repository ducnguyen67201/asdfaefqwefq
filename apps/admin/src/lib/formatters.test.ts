import { describe, expect, it } from 'vitest';

import type { UsageItem } from '../api/contracts';

import {
  durationLabel,
  initials,
  moneyLabel,
  usageMetric,
} from './formatters';

function usageItem(overrides: Partial<UsageItem>): UsageItem {
  return {
    activityTitle: null,
    amountMicroUsd: 0,
    audioDurationMs: 0,
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    characterCount: 0,
    createdAt: '2026-08-26T00:00:00Z',
    durationMs: 0,
    id: 'usage-id',
    inputTokens: 0,
    lane: 'responses',
    model: 'test-model',
    outputTokens: 0,
    reasoningTokens: 0,
    taskId: 'task-id',
    usageSource: 'provider',
    user: { email: 'user@example.com', id: 'user-id', name: '', plan: 'free' },
    ...overrides,
  };
}

describe('admin formatters', () => {
  it('derives initials from a name and falls back to email', () => {
    expect(initials('Ada Lovelace', 'ada@example.com')).toBe('AL');
    expect(initials('', 'grace.hopper@example.com')).toBe('G');
  });

  it('formats short and long durations without hiding precision', () => {
    expect(durationLabel(1_500)).toBe('1.5s');
    expect(durationLabel(90_000)).toBe('1.5m');
  });

  it('keeps sub-cent costs visible', () => {
    expect(moneyLabel(5_000)).toBe('$0.0050');
  });

  it('selects lane-specific usage metrics', () => {
    expect(
      usageMetric(
        usageItem({ cachedInputTokens: 500, inputTokens: 1_000, outputTokens: 250 }),
      ),
    ).toEqual({ detail: '500 cached', primary: '1,000 in · 250 out' });
    expect(
      usageMetric(usageItem({ characterCount: 420, durationMs: 2_000, lane: 'speech' })),
    ).toEqual({ detail: '2.0s duration', primary: '420 characters' });
  });
});
