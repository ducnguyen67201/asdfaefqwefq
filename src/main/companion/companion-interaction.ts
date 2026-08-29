import {
  CompanionInteractionSchema,
  type AuthStatus,
  type CompanionInteraction,
  type PendingInteraction,
} from '../../shared/contracts';

function bounded(value: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function boundedOr(value: string, maximum: number, fallback: string): string {
  return bounded(value, maximum) || fallback;
}

export function isAuthenticatedCompanionSession(status: AuthStatus): boolean {
  return status.state === 'signed_in' && status.user !== null;
}

export function toCompanionInteraction(
  interaction: PendingInteraction,
  side: 'left' | 'right',
): CompanionInteraction {
  const base = {
    id: interaction.id,
    prompt: boundedOr(
      interaction.prompt,
      1_000,
      'Tro needs your input.',
    ),
    side,
    taskId: interaction.taskId,
  } as const;

  return CompanionInteractionSchema.parse({
    ...base,
    kind: 'clarification',
    ...(interaction.choices
      ? {
          choices: interaction.choices.slice(0, 9).map((choice, index) => ({
            id: boundedOr(choice.id, 100, `choice-${index + 1}`),
            label: boundedOr(choice.label, 240, `Option ${index + 1}`),
          })),
        }
      : {}),
  });
}
