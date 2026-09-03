import { describe, expect, it } from 'vitest';

import { CompanionGuidanceSchema } from '../shared/contracts';

import {
  guidanceStatusLabel,
  guidanceTargetLabel,
} from './GuidanceCallout';

describe('guidance callout status', () => {
  it('localizes automatic action-preview states to Vietnamese', () => {
    const guidance = CompanionGuidanceSchema.parse({
      kind: 'action_preview',
      language: 'vi',
      message: 'Tiếp theo: Mở mục Sự kiện.',
      side: 'right',
    });

    expect(guidanceStatusLabel(guidance, null)).toBe('Sắp thực hiện');
    expect(guidanceStatusLabel(guidance, 'loading')).toBe(
      'Đang tải giọng nói',
    );
    expect(guidanceStatusLabel(guidance, 'speaking')).toBe('Đang nói');
  });

  it('keeps English status labels for English previews', () => {
    const guidance = CompanionGuidanceSchema.parse({
      kind: 'action_preview',
      language: 'en',
      message: 'Next: Open Events.',
      side: 'right',
    });

    expect(guidanceStatusLabel(guidance, null)).toBe('Up next');
    expect(guidanceStatusLabel(guidance, 'paused')).toBe('Paused');
  });

  it('localizes immediate thinking feedback without a response timer', () => {
    const guidance = CompanionGuidanceSchema.parse({
      kind: 'thinking',
      language: 'vi',
      message: 'Mình đang nhìn bài của em…',
      side: 'right',
    });

    expect(guidanceStatusLabel(guidance, null)).toBe('Đang suy nghĩ');
  });

  it('shows deterministic sequence progress beside the visible target', () => {
    const guidance = CompanionGuidanceSchema.parse({
      kind: 'guidance',
      language: 'vi',
      message: 'Mở mục Biến số.',
      sequence: { current: 2, total: 4 },
      side: 'right',
      target: 'Nút Biến số',
    });

    expect(guidanceTargetLabel(guidance)).toBe('Bước 2/4 · Nút Biến số');
  });
});
