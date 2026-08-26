export interface VoiceDraftSnapshot {
  selectionEnd: number;
  selectionStart: number;
  value: string;
}

export interface VoiceDraftResult {
  caret: number;
  value: string;
}

const WORD_CHARACTER = /[\p{Letter}\p{Number}]/u;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function captureVoiceDraftSnapshot(
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
  hasTextareaFocus: boolean,
): VoiceDraftSnapshot {
  const fallback = value.length;
  const start = hasTextareaFocus
    ? clamp(selectionStart ?? fallback, 0, value.length)
    : fallback;
  const end = hasTextareaFocus
    ? clamp(selectionEnd ?? start, start, value.length)
    : fallback;
  return { selectionEnd: end, selectionStart: start, value };
}

function needsBoundarySpace(left: string, right: string): boolean {
  return WORD_CHARACTER.test(left) && WORD_CHARACTER.test(right);
}

function firstCharacter(value: string): string {
  return Array.from(value)[0] ?? '';
}

function lastCharacter(value: string): string {
  return Array.from(value).at(-1) ?? '';
}

export function applyDictationTranscript(
  snapshot: VoiceDraftSnapshot,
  transcript: string,
): VoiceDraftResult {
  const before = snapshot.value.slice(0, snapshot.selectionStart);
  const after = snapshot.value.slice(snapshot.selectionEnd);
  const normalized = transcript;
  const leadingSpace =
    before && normalized && needsBoundarySpace(lastCharacter(before), firstCharacter(normalized))
      ? ' '
      : '';
  const trailingSpace =
    after && normalized && needsBoundarySpace(lastCharacter(normalized), firstCharacter(after))
      ? ' '
      : '';
  const inserted = `${leadingSpace}${normalized}${trailingSpace}`;
  return {
    caret: before.length + inserted.length,
    value: `${before}${inserted}${after}`,
  };
}
