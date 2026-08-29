import { describe, expect, it } from 'vitest';

import {
  computerPermissionWaitPresentation,
  isTaskCancellable,
  isTaskSteerable,
  shouldAutoStartTask,
  shouldStopTaskForEscape,
} from './task-execution';

describe('task execution presentation policy', () => {
  it('names only the permissions required by the blocked computer action', () => {
    expect(computerPermissionWaitPresentation(['accessibility'])).toEqual({
      body:
        'Tro paused computer observation or control because Accessibility is not ready. Open system settings to grant access, or continue without computer use.',
      title: 'Accessibility permission required',
    });
    expect(
      computerPermissionWaitPresentation([
        'accessibility',
        'screen_recording',
      ]),
    ).toEqual({
      body:
        'Tro paused computer observation or control because Accessibility and Screen Recording are not ready. Open system settings to grant access, or continue without computer use.',
      title: 'Accessibility and Screen Recording permissions required',
    });
  });

  it('auto-starts a ready task once execution dependencies are available', () => {
    expect(
      shouldAutoStartTask({ phase: 'ready' }, {
        agentReady: true,
        isBusy: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoStartTask({ phase: 'ready' }, {
        agentReady: false,
        isBusy: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoStartTask({ phase: 'ready' }, {
        agentReady: true,
        isBusy: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoStartTask({ phase: 'planning' }, {
        agentReady: true,
        isBusy: false,
      }),
    ).toBe(false);
  });

  it('treats every non-terminal task phase as cancellable', () => {
    expect(isTaskCancellable({ phase: 'ready' })).toBe(true);
    expect(isTaskCancellable({ phase: 'completed' })).toBe(false);
    expect(isTaskCancellable({ phase: 'failed' })).toBe(false);
    expect(isTaskCancellable({ phase: 'cancelled' })).toBe(false);
    expect(isTaskCancellable(null)).toBe(false);
  });

  it('uses the authoritative available actions for v4 steering', () => {
    const lifecycle = {
      state: 'blocked' as const,
      runVersion: 3,
      phase: 'blocked' as const,
      terminal: true,
      availableActions: ['retry_as_new_task' as const],
      waitingOn: null,
      failure: null,
      cancellationSource: null,
    };

    expect(isTaskSteerable({ phase: 'blocked', lifecycle })).toBe(false);
    expect(isTaskCancellable({ phase: 'blocked', lifecycle })).toBe(false);
    expect(isTaskSteerable({ phase: 'planning' })).toBe(true);
  });

  it('uses a non-repeating Escape press to stop a cancellable task', () => {
    expect(
      shouldStopTaskForEscape(
        { key: 'Escape', repeat: false, target: null },
        { phase: 'observing' },
        { documentHasFocus: true, modalOpen: false },
      ),
    ).toBe(true);
    expect(
      shouldStopTaskForEscape(
        { key: 'Escape', repeat: true, target: null },
        { phase: 'observing' },
        { documentHasFocus: true, modalOpen: false },
      ),
    ).toBe(false);
    expect(
      shouldStopTaskForEscape(
        { key: 'Enter', repeat: false, target: null },
        { phase: 'observing' },
        { documentHasFocus: true, modalOpen: false },
      ),
    ).toBe(false);
    expect(
      shouldStopTaskForEscape(
        { key: 'Escape', repeat: false, target: null },
        { phase: 'completed' },
        { documentHasFocus: true, modalOpen: false },
      ),
    ).toBe(false);
  });

  it('suppresses Escape for permission, modal, blurred, and editable contexts', () => {
    const lifecycle = {
      state: 'awaiting_permission' as const,
      runVersion: 2,
      phase: 'awaiting_permission' as const,
      terminal: false,
      availableActions: ['cancel' as const],
      waitingOn: {
        kind: 'permission' as const,
        interactionId: '11111111-1111-4111-8111-111111111111',
        invocationId: '22222222-2222-4222-8222-222222222222',
        requiredPermissions: ['accessibility' as const],
        since: '2026-08-26T00:00:00.000Z',
      },
      failure: null,
      cancellationSource: null,
    };
    expect(
      shouldStopTaskForEscape(
        { key: 'Escape', repeat: false, target: null },
        { phase: 'awaiting_permission', lifecycle },
        { documentHasFocus: true, modalOpen: false },
      ),
    ).toBe(false);
    expect(
      shouldStopTaskForEscape(
        {
          key: 'Escape',
          repeat: false,
          target: { tagName: 'INPUT' } as unknown as EventTarget,
        },
        { phase: 'planning' },
        { documentHasFocus: true, modalOpen: false },
      ),
    ).toBe(false);
    expect(
      shouldStopTaskForEscape(
        { key: 'Escape', repeat: false, target: null },
        { phase: 'planning' },
        { documentHasFocus: true, modalOpen: true },
      ),
    ).toBe(false);
  });
});
