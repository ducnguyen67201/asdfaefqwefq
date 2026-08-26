import { randomUUID } from 'node:crypto';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  AppLanguage,
  CompanionPetMood,
  CompanionPetNudge as CompanionPetNudgeProjection,
} from '../shared/contracts';

import {
  ClassroomPetNudge,
  classroomPetMoodLabel,
} from './ClassroomPetNudge';

function nudge(
  overrides: Partial<CompanionPetNudgeProjection> = {},
): CompanionPetNudgeProjection {
  return {
    id: randomUUID(),
    language: 'en',
    message: "You've got this.",
    mood: 'encouraging',
    side: 'right',
    ...overrides,
  };
}

describe('ClassroomPetNudge', () => {
  it.each([
    ['en', 'encouraging', 'Keep going'],
    ['en', 'waiting', 'While you wait'],
    ['en', 'celebrating', 'Nice work'],
    ['vi', 'encouraging', 'Tiếp tục nhé'],
    ['vi', 'waiting', 'Trong lúc chờ'],
    ['vi', 'celebrating', 'Làm tốt lắm'],
  ] as const)(
    'labels %s %s copy as %s',
    (language: AppLanguage, mood: CompanionPetMood, label: string) => {
      expect(classroomPetMoodLabel(language, mood)).toBe(label);
      const markup = renderToStaticMarkup(
        createElement(ClassroomPetNudge, {
          nudge: nudge({ language, mood }),
        }),
      );
      expect(markup).toContain(`>${label}</span>`);
    },
  );

  it('renders a labelled polite status with no controls', () => {
    const markup = renderToStaticMarkup(
      createElement(ClassroomPetNudge, { nudge: nudge() }),
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain(
      'aria-labelledby="classroom-pet-nudge-title classroom-pet-nudge-mood"',
    );
    expect(markup).toContain('Tro pet');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<a ');
  });

  it('renders hostile-looking content only as escaped plain text', () => {
    const markup = renderToStaticMarkup(
      createElement(ClassroomPetNudge, {
        nudge: nudge({
          message:
            '<img src=x onerror=alert(1)> https://malicious.example',
        }),
      }),
    );

    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).toContain('https://malicious.example');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<a ');
  });
});
