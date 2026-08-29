import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CompanionStateSchema,
  type CompanionAppearance,
  type CompanionPetMood,
  type CompanionPetNudge,
  type CompanionState,
} from '../shared/contracts';

import {
  COMPANION_ANIMATIONS,
  companionAnimationLabel,
  customCompanionHovered,
  selectCompanionAnimation,
} from './companion-animation';

const DEFAULT_APPEARANCE: CompanionAppearance = { kind: 'default' };
const CUSTOM_APPEARANCE: CompanionAppearance = {
  assetUrl: `trocode-companion://asset/active/${'a'.repeat(64)}`,
  kind: 'custom',
  revision: 'a'.repeat(64),
};

function nudge(mood: CompanionPetMood): CompanionPetNudge {
  return {
    id: randomUUID(),
    language: 'en',
    message: 'A short local message.',
    mood,
    side: 'right',
  };
}

describe('companion animation model', () => {
  it('defines a valid distinct atlas row for every operational state', () => {
    const rows = CompanionStateSchema.options.map(
      (state) => COMPANION_ANIMATIONS[state].row,
    );

    expect(rows).toEqual([0, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(rows).size).toBe(8);
    for (const state of CompanionStateSchema.options) {
      expect(COMPANION_ANIMATIONS[state].durationMs).toBeGreaterThan(0);
      expect(companionAnimationLabel(state)).toContain('Tro desktop pet:');
    }
  });

  it.each(
    CompanionStateSchema.options.filter((state) => state !== 'idle'),
  )('never lets hover override the %s operational state', (state) => {
    expect(
      selectCompanionAnimation({
        appearance: DEFAULT_APPEARANCE,
        hovered: true,
        nudge: null,
        state,
      }),
    ).toBe(state);
  });

  it('uses hover only for the idle bundled companion', () => {
    expect(
      selectCompanionAnimation({
        appearance: DEFAULT_APPEARANCE,
        hovered: true,
        nudge: null,
        state: 'idle',
      }),
    ).toBe('hover');
    expect(customCompanionHovered(CUSTOM_APPEARANCE, 'idle', true)).toBe(true);
    expect(customCompanionHovered(CUSTOM_APPEARANCE, 'working', true)).toBe(false);
  });

  it.each([
    ['encouraging', 'hover'],
    ['waiting', 'idle'],
    ['celebrating', 'completed'],
  ] as const)('maps classroom mood %s to %s', (mood, animation) => {
    expect(
      selectCompanionAnimation({
        appearance: DEFAULT_APPEARANCE,
        hovered: false,
        nudge: nudge(mood),
        state: 'idle',
      }),
    ).toBe(animation);
  });

  it.each([
    ['processing', 'thinking', 'processing'],
    ['working', 'working', 'working'],
    ['working', 'verifying', 'processing'],
  ] as const)(
    'maps %s plus task mood %s to %s',
    (state: CompanionState, mood: CompanionPetMood, animation) => {
      expect(
        selectCompanionAnimation({
          appearance: DEFAULT_APPEARANCE,
          hovered: false,
          nudge: nudge(mood),
          state,
        }),
      ).toBe(animation);
    },
  );

  it('keeps custom companions on their operational state path', () => {
    expect(
      selectCompanionAnimation({
        appearance: CUSTOM_APPEARANCE,
        hovered: true,
        nudge: nudge('celebrating'),
        state: 'idle',
      }),
    ).toBe('idle');
  });
});
