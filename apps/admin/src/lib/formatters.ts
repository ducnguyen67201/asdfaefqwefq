import type { UsageItem, UsageLane } from '../api/contracts';

export const usageLaneLabels: Record<UsageLane, string> = {
  realtime_transcription: 'Live voice',
  responses: 'Agent task',
  speech: 'Spoken reply',
  transcription: 'Voice transcription',
};

export function initials(name: string | null, email: string): string {
  const source = name?.trim() || email.split('@')[0] || '';
  return source
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

export function dateLabel(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date);
}

export function dateTimeLabel(value: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date);
}

export function moneyLabel(microUsd: number): string {
  const amount = Number(microUsd || 0) / 1_000_000;
  if (amount > 0 && amount < 0.01) return `$${amount.toFixed(4)}`;
  return new Intl.NumberFormat(undefined, {
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(amount);
}

export function chartMoneyLabel(microUsd: number): string {
  const amount = Number(microUsd || 0) / 1_000_000;
  if (amount === 0) return '$0';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 0.1) return `$${amount.toFixed(3)}`;
  if (amount < 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(1)}`;
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    notation: Number(value) >= 10_000 ? 'compact' : 'standard',
  }).format(Number(value || 0));
}

export function durationLabel(milliseconds: number): string {
  const seconds = Number(milliseconds || 0) / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

export function shortIdentifier(value: string): string {
  return value.slice(0, 8);
}

export function chartDateLabel(
  value: string,
  granularity: 'day' | 'hour' | 'month',
): string {
  const options: Intl.DateTimeFormatOptions =
    granularity === 'hour'
      ? { day: 'numeric', hour: 'numeric', month: 'short' }
      : granularity === 'month'
        ? { month: 'short', year: '2-digit' }
        : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

export function usageMetric(item: UsageItem) {
  if (item.lane === 'responses') {
    return {
      detail: item.cachedInputTokens
        ? `${compactNumber(item.cachedInputTokens)} cached`
        : `${durationLabel(item.durationMs)} duration`,
      primary: `${compactNumber(item.inputTokens)} in · ${compactNumber(item.outputTokens)} out`,
    };
  }
  if (item.lane === 'speech') {
    return {
      detail: `${durationLabel(item.durationMs)} duration`,
      primary: `${compactNumber(item.characterCount)} characters`,
    };
  }
  return {
    detail: `${durationLabel(item.durationMs)} processing`,
    primary: `${durationLabel(item.audioDurationMs)} audio`,
  };
}
