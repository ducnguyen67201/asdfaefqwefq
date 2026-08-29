import type {
  CompanionAppearance,
  CompanionPetMood,
  CompanionPetNudge,
  CompanionState,
} from '../shared/contracts';

export type CompanionAnimation = CompanionState | 'hover';

export interface CompanionAnimationDefinition {
  durationMs: number;
  iteration: 'loop' | 'once';
  label: string;
  row: number;
}

export const COMPANION_ANIMATIONS: Readonly<
  Record<CompanionAnimation, CompanionAnimationDefinition>
> = {
  idle: { durationMs: 1_800, iteration: 'loop', label: 'Idle', row: 0 },
  hover: { durationMs: 900, iteration: 'loop', label: 'Waving hello', row: 1 },
  guiding: { durationMs: 1_000, iteration: 'loop', label: 'Guiding', row: 2 },
  listening: { durationMs: 1_100, iteration: 'loop', label: 'Listening', row: 3 },
  processing: { durationMs: 1_300, iteration: 'loop', label: 'Thinking', row: 4 },
  sending: { durationMs: 780, iteration: 'loop', label: 'Sending', row: 5 },
  working: { durationMs: 1_050, iteration: 'loop', label: 'Working', row: 6 },
  completed: { durationMs: 850, iteration: 'once', label: 'Completed', row: 7 },
  error: { durationMs: 900, iteration: 'once', label: 'Needs attention', row: 8 },
};

const CLASSROOM_MOOD_ANIMATION: Readonly<
  Partial<Record<CompanionPetMood, CompanionAnimation>>
> = {
  celebrating: 'completed',
  encouraging: 'hover',
  waiting: 'idle',
};

const TASK_MOOD_ANIMATION: Readonly<
  Partial<Record<CompanionPetMood, CompanionAnimation>>
> = {
  thinking: 'processing',
  verifying: 'processing',
  working: 'working',
};

export interface SelectCompanionAnimationInput {
  appearance: CompanionAppearance;
  hovered: boolean;
  nudge: CompanionPetNudge | null;
  state: CompanionState;
}

export function selectCompanionAnimation({
  appearance,
  hovered,
  nudge,
  state,
}: SelectCompanionAnimationInput): CompanionAnimation {
  if (appearance.kind === 'custom') return state;

  if (state === 'processing' || state === 'working') {
    return nudge ? TASK_MOOD_ANIMATION[nudge.mood] ?? state : state;
  }

  if (state !== 'idle') return state;

  const classroomExpression = nudge
    ? CLASSROOM_MOOD_ANIMATION[nudge.mood]
    : undefined;
  if (classroomExpression) return classroomExpression;
  return hovered ? 'hover' : 'idle';
}

export function companionAnimationLabel(animation: CompanionAnimation): string {
  return `Tro desktop pet: ${COMPANION_ANIMATIONS[animation].label}`;
}

export function customCompanionHovered(
  appearance: CompanionAppearance,
  state: CompanionState,
  hovered: boolean,
): boolean {
  return appearance.kind === 'custom' && state === 'idle' && hovered;
}
