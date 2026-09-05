// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { classroomFixture } from '../main/knowledge/classroom-broadcast.fixture';
import type { AppLanguage, BroadcastNotice, GuidanceState } from '../shared/contracts';
import type { DesktopApi } from '../shared/desktop-api';

import { ClassroomExplanationPanel } from './ClassroomExplanationPanel';

describe('individual explanation controls', () => {
  it.each<AppLanguage>(['en', 'vi'])('requires a student gesture and binds continuation to the displayed step (%s)', async (language) => {
    const f = classroomFixture();
    let listener: ((state: GuidanceState) => void) | undefined;
    let noticeListener: ((notice: BroadcastNotice | null) => void) | undefined;
    const initial: GuidanceState = { revision: 1, sessionId: f.binding.sessionId, consent: null, pending: [f.broadcast], active: null, message: null };
    const waiting: GuidanceState = { ...initial, revision: 3, pending: [], active: { guidanceId: f.assignment.runId, taskId: f.session.attemptId, broadcastId: f.broadcast.id, stepRevision: 3, phase: 'waiting', text: '<script>A loop repeats.</script>', contextMode: 'text_only' } };
    const start = vi.fn(async () => { listener?.(waiting); return waiting; });
    const next = vi.fn(async () => { const updated: GuidanceState = { ...waiting, revision: 4, active: { ...waiting.active!, phase: 'planning' } }; listener?.(updated); return updated; });
    const consent = vi.fn(async () => initial);
    const old = window.tro;
    window.tro = {
      onClassroomBroadcastChanged: (fn: (notice: BroadcastNotice | null) => void) => { noticeListener = fn; return () => { noticeListener = undefined; }; },
      getClassroomBroadcastNotice: async () => ({ revision: 1, sessionId: f.binding.sessionId, anchorAttemptId: f.session.attemptId, broadcast: null, offline: false }),
      onClassroomGuidanceChanged: (fn: (state: GuidanceState) => void) => { listener = fn; return () => { listener = undefined; }; },
      getClassroomGuidanceState: async () => ({ ...initial, pending: [] }),
      startClassroomExplanation: start,
      continueClassroomExplanation: next,
      setClassroomGuidanceConsent: consent,
    } as unknown as DesktopApi;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const button = (label: string) => [...container.querySelectorAll('button')].find((element) => element.textContent === label)!;
    try {
      await act(async () => root.render(<ClassroomExplanationPanel appLanguage={language} onOpenClasswork={vi.fn()} />));
      expect(start).not.toHaveBeenCalled();
      expect(consent).not.toHaveBeenCalled();
      expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false);
      await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
      expect(consent).toHaveBeenCalledWith({ sessionId: f.binding.sessionId, enabled: true, contextMode: 'screen_if_permitted' });
      await act(async () => {
        listener?.({ ...initial, revision: 2 });
        noticeListener?.({ revision: 2, sessionId: f.binding.sessionId, anchorAttemptId: f.session.attemptId, broadcast: f.broadcast, offline: false });
      });
      await act(async () => button(language === 'en' ? 'Explain without screen' : 'Giải thích không dùng màn hình').click());
      expect(start).toHaveBeenCalledOnce();
      expect(start).toHaveBeenCalledWith({ broadcastId: f.broadcast.id, contextMode: 'text_only' });
      expect(container.querySelector('script')).toBeNull();
      expect(container.textContent).toContain('<script>A loop repeats.</script>');
      expect(next).not.toHaveBeenCalled();
      await act(async () => button(language === 'en' ? 'Next' : 'Tiếp theo').click());
      expect(next).toHaveBeenCalledWith({ guidanceId: waiting.active!.guidanceId, stepRevision: 3, action: 'next', text: null });
      expect(button(language === 'en' ? 'Next' : 'Tiếp theo')).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      window.tro = old;
    }
  });
});
