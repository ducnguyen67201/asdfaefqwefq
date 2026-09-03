import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CompanionGuidanceSchema } from '../shared/contracts';

import {
  GuidanceResponseTimer,
  guidanceStatusLabel,
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
    expect(
      renderToStaticMarkup(
        createElement(GuidanceResponseTimer, { guidance }),
      ),
    ).toBe('');
  });

  it('shows a localized timed learner turn without confirmation controls', () => {
    const guidance = CompanionGuidanceSchema.parse({
      kind: 'guidance',
      language: 'vi',
      message: 'Mở mục Biến số để tạo nơi lưu điểm.',
      phase: 'waiting',
      responseWindowSeconds: 20,
      side: 'right',
      taskId: '00000000-0000-4000-8000-000000000001',
    });

    expect(guidanceStatusLabel(guidance, null)).toBe('Đến lượt em');
    const markup = renderToStaticMarkup(
      createElement(GuidanceResponseTimer, { guidance }),
    );
    expect(markup).toContain('Em thử ngay nhé');
    expect(markup).toContain('20s');
    expect(markup).not.toContain('Em làm xong');
    expect(markup).not.toContain('button');
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    expect(css).toContain('.guidance-callout--coach');
    expect(css).toContain('pointer-events: none;');
  });

  it('shows checking feedback without stale learner controls', () => {
    const guidance = CompanionGuidanceSchema.parse({
      kind: 'thinking',
      language: 'en',
      message: "Let's check what changed…",
      phase: 'checking',
      side: 'right',
      taskId: '00000000-0000-4000-8000-000000000001',
    });
    expect(guidanceStatusLabel(guidance, null)).toBe('Checking');
    expect(renderToStaticMarkup(createElement(GuidanceResponseTimer, {
      guidance,
    }))).toBe('');
  });
});
