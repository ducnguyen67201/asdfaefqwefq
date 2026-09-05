import type { ClassroomBroadcastDraft } from '../../shared/contracts';
const transitions: Record<
  ClassroomBroadcastDraft['state'],
  readonly ClassroomBroadcastDraft['state'][]
> = {
  prepared: ['sending', 'cancelled', 'expired', 'stale'],
  sending: ['sent', 'failed', 'unknown'],
  unknown: ['unknown', 'sent'],
  sent: [],
  cancelled: [],
  expired: [],
  stale: [],
  failed: [],
};
export function assertBroadcastTransition(
  from: ClassroomBroadcastDraft['state'],
  to: ClassroomBroadcastDraft['state'],
): void {
  if (!transitions[from].includes(to))
    throw new Error(`Broadcast cannot move from ${from} to ${to}.`);
}
