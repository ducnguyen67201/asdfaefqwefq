import { describe, expect, it, vi } from 'vitest';

import type { TaskUpdate } from '../../shared/contracts';

import { ActivityProgressReporter } from './activity-progress-reporter';

function update(phase: TaskUpdate['snapshot']['phase']): TaskUpdate {
  const taskId = '00000000-0000-4000-8000-000000000001';
  const timestamp = '2026-08-25T00:00:00.000Z';
  return {
    snapshot: {
      taskId, request: 'Help with loops.', phase, goal: null, messages: [],
      pendingInteraction: null, approvalGrant: null, progress: null, outcomes: null,
      queuedSteering: [], runtimeResume: null, createdAt: timestamp, updatedAt: timestamp, lastEvent: null,
    },
    event: {
      eventId: '00000000-0000-4000-8000-000000000002', taskId, phase,
      timestamp, status: 'success', summary: 'Updated.', nextActions: [], artifacts: [],
    },
  };
}

describe('ActivityProgressReporter', () => {
  it('maps blocked to paused rather than failed and flushes terminal completion', async () => {
    const updateWorkSession = vi.fn(async () => undefined);
    let now = 20_000;
    const reporter = new ActivityProgressReporter({ updateWorkSession }, () => now);
    reporter.bind('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');
    await reporter.report(update('blocked'));
    expect(updateWorkSession).toHaveBeenLastCalledWith('00000000-0000-4000-8000-000000000003', { state: 'paused' });
    now += 1;
    await reporter.report(update('completed'));
    expect(updateWorkSession).toHaveBeenLastCalledWith('00000000-0000-4000-8000-000000000003', { state: 'completed' });
  });

  it('marks a bound Work Session failed when task creation aborts', async () => {
    const updateWorkSession = vi.fn(async () => undefined);
    const reporter = new ActivityProgressReporter({ updateWorkSession });
    reporter.bind(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
    );

    await reporter.fail('00000000-0000-4000-8000-000000000001');
    await reporter.fail('00000000-0000-4000-8000-000000000001');

    expect(updateWorkSession).toHaveBeenCalledOnce();
    expect(updateWorkSession).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000003',
      { state: 'failed' },
    );
  });
});
