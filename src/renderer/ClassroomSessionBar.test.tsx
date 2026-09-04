// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ClassroomCoachLaunch,
  ClassroomDirectiveNotice,
  ClassroomSessionProjection,
} from '../shared/contracts';
import type { DesktopApi } from '../shared/desktop-api';

import { ClassroomSessionBar } from './ClassroomSessionBar';

const session: ClassroomSessionProjection = {
  activity: {
    launchTarget: 'current_surface',
    objective: 'Build a Scratch scene.',
    requiresSubmission: false,
    title: 'Scratch loops',
  },
  activityVersionId: '00000000-0000-4000-8000-000000000003',
  attemptId: '00000000-0000-4000-8000-000000000004',
  attemptState: 'in_progress',
  autoCoachConsent: true,
  autoOpenConsent: false,
  currentDirective: null,
  joinedAt: '2026-08-25T00:00:00.000Z',
  leftAt: null,
  role: 'student',
  run: {
    id: '00000000-0000-4000-8000-000000000002',
    mode: 'live',
    state: 'open',
    status: 'live',
  },
  space: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Scratch class',
  },
};

describe('ClassroomSessionBar Coach broadcasts', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('launches the existing Coach path once when main claims a Teacher broadcast', async () => {
    let onCoachLaunch: ((launch: ClassroomCoachLaunch) => void) | null = null;
    let onDirective: ((notice: ClassroomDirectiveNotice | null) => void) | null =
      null;
    const dismissClassroomDirective = vi.fn(async () => undefined);
    let finishLaunch!: () => void;
    const launch = vi.fn(
      () => new Promise<void>((resolve) => {
        finishLaunch = resolve;
      }),
    );
    window.tro = {
      dismissClassroomDirective,
      onClassroomCoachLaunchRequested: vi.fn((listener) => {
        onCoachLaunch = listener;
        return () => undefined;
      }),
      onClassroomDirectiveChanged: vi.fn((listener) => {
        onDirective = listener;
        return () => undefined;
      }),
      onClassroomSessionChanged: vi.fn(() => () => undefined),
      restoreClassroomSession: vi.fn(async () => session),
    } as unknown as DesktopApi;

    await act(async () => {
      root.render(
        <ClassroomSessionBar
          appLanguage="en"
          onLaunch={launch}
          onOpenClasswork={vi.fn()}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const directive = {
      id: '00000000-0000-4000-8000-000000000005',
      sequence: 1,
      kind: 'explain_assignment' as const,
      delivery: 'consent_required' as const,
      instruction: 'Explain the visible assignment.',
      criterionIds: [],
      createdAt: '2026-08-25T00:01:00.000Z',
    };
    const coachLaunch: ClassroomCoachLaunch = {
      directiveId: directive.id,
      request: {
        activityAttemptId: session.attemptId,
        activityIntent: 'work',
        executionProfile: 'everyday',
        requestedMode: 'coach',
        screenContext: 'required',
        workspaceSelectionId: null,
        text: 'Explain the visible assignment.',
      },
    };

    await act(async () => {
      onDirective?.({ directive, status: 'received' });
      onCoachLaunch?.(coachLaunch);
      onCoachLaunch?.(coachLaunch);
      onDirective?.({
        directive: {
          ...directive,
          id: '00000000-0000-4000-8000-000000000006',
          kind: 'exercise',
          delivery: 'manual_only',
          instruction: 'Continue with the newest exercise.',
          sequence: 2,
        },
        status: 'received',
      });
      finishLaunch();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(launch).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledWith(coachLaunch.request);
    expect(dismissClassroomDirective).toHaveBeenCalledWith(directive.id);
    expect(container.textContent).toContain('Continue with the newest exercise.');
  });
});
