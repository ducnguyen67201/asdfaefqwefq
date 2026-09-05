import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { z } from 'zod';

import * as C from '../../shared/classroom-broadcast-contracts';
import { CLASSROOM_BROADCAST_CHANNELS as channels } from '../../shared/classroom-desktop-api';
import type { ClassroomBroadcastDraftService } from '../knowledge/classroom-broadcast-draft-service';
import type { ClassroomBroadcastService } from '../knowledge/classroom-broadcast-service';
import type { ClassroomGuidanceCoordinator } from '../knowledge/classroom-guidance-coordinator';
import type { KnowledgeSpaceClient } from '../knowledge/knowledge-space-client';
import type { TeacherClassroomContextService } from '../knowledge/teacher-classroom-context-service';
export interface ClassroomBroadcastFeatures {
  context: TeacherClassroomContextService;
  drafts: ClassroomBroadcastDraftService;
  broadcasts: ClassroomBroadcastService;
  guidance: ClassroomGuidanceCoordinator;
  client: KnowledgeSpaceClient;
}
export function registerClassroomBroadcastIpc(
  window: BrowserWindow,
  features: ClassroomBroadcastFeatures | undefined,
  authorize: (event: IpcMainInvokeEvent) => Promise<void>,
): () => void {
  const registered: string[] = [];
  const handle = (
    channel: string,
    fn: (input: unknown) => Promise<unknown> | unknown,
  ): void => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      await authorize(event);
      if (!features) throw new Error('Classroom broadcasts are unavailable.');
      return fn(input);
    });
    registered.push(channel);
  };
  handle(channels.selectTeacherClassroom, async (raw) => {
    const input = C.TeacherClassroomSelectSchema.parse(raw);
    return C.TeacherClassroomSelectionSchema.parse(
      await features!.context.select(input.spaceId, input.sessionId),
    );
  });
  handle(channels.clearTeacherClassroom, (raw) =>
    features!.context.clear(
      C.TeacherClassroomClearSchema.parse(raw).selectionId,
    ),
  );
  handle(channels.getTeacherClassroom, async () => {
    const selected = features!.context.get();
    if (selected) await features!.context.resolve(selected.selectionId);
    return C.TeacherClassroomSelectionSchema.nullable().parse(
      features!.context.get(),
    );
  });
  handle(channels.getClassroomBroadcastDrafts, async (raw) =>
    C.BroadcastDraftProjectionSchema.parse(
      await features!.drafts.list(
        z.object({ taskId: z.string().uuid() }).strict().parse(raw).taskId,
      ),
    ),
  );
  handle(channels.confirmClassroomBroadcast, async (raw) =>
    C.ClassroomBroadcastDraftSchema.parse(
      await features!.drafts.confirm(C.BroadcastDraftActionSchema.parse(raw)),
    ),
  );
  handle(channels.cancelClassroomBroadcast, async (raw) =>
    C.ClassroomBroadcastDraftSchema.parse(
      await features!.drafts.cancel(C.BroadcastDraftActionSchema.parse(raw)),
    ),
  );
  handle(channels.reconcileClassroomBroadcast, async (raw) =>
    C.ClassroomBroadcastDraftSchema.parse(
      await features!.drafts.reconcile(C.BroadcastDraftLookupSchema.parse(raw)),
    ),
  );
  handle(channels.getClassroomBroadcastNotice, () =>
    C.BroadcastNoticeSchema.nullable().parse(features!.broadcasts.get()),
  );
  handle(channels.openClassroomBroadcastAssignment, async (raw) =>
    z
      .object({ attemptId: z.string().uuid() })
      .strict()
      .parse(
        await features!.broadcasts.openAssignment(
          C.BroadcastIdRequestSchema.parse(raw).broadcastId,
        ),
      ),
  );
  handle(channels.openClassroomBroadcastLink, (raw) =>
    features!.broadcasts.openLink(
      C.BroadcastIdRequestSchema.parse(raw).broadcastId,
    ),
  );
  handle(channels.dismissClassroomBroadcast, (raw) => {
    const { broadcastId } = C.BroadcastIdRequestSchema.parse(raw);
    features!.broadcasts.dismiss(broadcastId);
    features!.guidance.dismiss(broadcastId);
  });
  handle(channels.setClassroomGuidanceConsent, (raw) =>
    C.GuidanceStateSchema.parse(
      features!.guidance.setConsent(C.GuidanceConsentRequestSchema.parse(raw)),
    ),
  );
  handle(channels.startClassroomExplanation, async (raw) =>
    C.GuidanceStateSchema.parse(
      await features!.guidance.startExplanation(
        C.GuidanceStartLocalSchema.parse(raw),
      ),
    ),
  );
  handle(channels.continueClassroomExplanation, (raw) =>
    C.GuidanceStateSchema.parse(
      features!.guidance.continue(C.GuidanceContinueSchema.parse(raw)),
    ),
  );
  handle(channels.stopClassroomExplanation, async (raw) =>
    C.GuidanceStateSchema.parse(
      await features!.guidance.stop(
        z.object({ guidanceId: z.string().uuid() }).strict().parse(raw)
          .guidanceId,
      ),
    ),
  );
  handle(channels.getClassroomGuidanceState, () =>
    C.GuidanceStateSchema.parse(features!.guidance.get()),
  );
  handle(channels.getClassroomGuidanceSummary, async (raw) => {
    const input = z
      .object({
        spaceId: z.string().uuid(),
        sessionId: z.string().uuid(),
        broadcastId: z.string().uuid(),
      })
      .strict()
      .parse(raw);
    return C.GuidanceSummarySchema.parse(
      await features!.client.classroomGuidanceSummary(
        input.spaceId,
        input.sessionId,
        input.broadcastId,
      ),
    );
  });
  const send = (channel: string, value: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, value);
  };
  const unsubscribers = features
    ? [
        features.context.onChange((value) =>
          send(
            channels.teacherClassroomChanged,
            C.TeacherClassroomSelectionSchema.nullable().parse(value),
          ),
        ),
        features.drafts.onChange((value) =>
          send(
            channels.classroomBroadcastDraftsChanged,
            C.BroadcastDraftProjectionSchema.parse(value),
          ),
        ),
        features.broadcasts.onChange((value) =>
          send(
            channels.classroomBroadcastChanged,
            C.BroadcastNoticeSchema.nullable().parse(value),
          ),
        ),
        features.guidance.onChange((value) =>
          send(
            channels.classroomGuidanceChanged,
            C.GuidanceStateSchema.parse(value),
          ),
        ),
      ]
    : [];
  return () => {
    unsubscribers.forEach((stop) => stop());
    registered.forEach((channel) => ipcMain.removeHandler(channel));
  };
}
