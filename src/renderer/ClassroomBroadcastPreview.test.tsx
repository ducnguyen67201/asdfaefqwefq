// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { classroomFixture } from '../main/knowledge/classroom-broadcast.fixture';
import {
  ClassroomBroadcastDraftSchema,
  type BroadcastDraftProjection,
} from '../shared/contracts';
import type { DesktopApi } from '../shared/desktop-api';

import { ClassroomBroadcastPreview } from './ClassroomBroadcastPreview';

describe('teacher broadcast review', () => {
  it('shows exact source text and only sends from the explicit button', async () => {
    const f = classroomFixture();
    const taskId = f.session.attemptId;
    const draft = ClassroomBroadcastDraftSchema.parse({
      draftId: f.broadcast.id,
      taskId,
      sourceCallId: 'call',
      binding: f.binding,
      revision: 1,
      payloadDigest: 'a'.repeat(64),
      audience: 'session_participants',
      payload: {
        ...f.broadcast.payload,
        instruction: '<script>Do not execute</script>',
      },
      createdAt: f.broadcast.createdAt,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      state: 'prepared',
    });
    let listener: ((value: BroadcastDraftProjection) => void) | null = null;
    const confirm = vi.fn(async () => {
      listener?.({
        taskId,
        revision: 2,
        drafts: [{ ...draft, state: 'sent', revision: 2 }],
      });
      return { ...draft, state: 'sent' as const };
    });
    const old = window.tro;
    window.tro = {
      onClassroomBroadcastDraftsChanged: (fn: (value:BroadcastDraftProjection)=>void) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
      getClassroomBroadcastDrafts: async () => ({
        taskId,
        revision: 1,
        drafts: [draft],
      }),
      confirmClassroomBroadcast: confirm,
    } as unknown as DesktopApi;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <ClassroomBroadcastPreview appLanguage="en" taskId={taskId} />,
        ),
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(container.querySelector('script')).toBeNull();
      expect(container.textContent).toContain(
        '<script>Do not execute</script>',
      );
      const button = [...container.querySelectorAll('button')].find(
        (b) => b.textContent === 'Broadcast to class',
      )!;
      await act(async () => {
        button.click();
        button.click();
      });
      expect(confirm).toHaveBeenCalledWith({
        taskId,
        draftId: draft.draftId,
        revision: 1,
      });
      expect(container.textContent).toContain('Broadcast saved.');
    } finally {
      await act(async () => root.unmount());
      container.remove();
      window.tro = old;
    }
  });
});
