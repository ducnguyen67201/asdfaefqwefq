import { z } from 'zod';

import { objectSchema } from '../../shared/agent-tool-contracts';
import {
  PrepareClassroomBroadcastSchema,
  TeacherClassroomBindingSchema,
  type PrepareClassroomBroadcast,
  type TeacherClassroomBinding,
} from '../../shared/contracts';
import type { RuntimeToolExecutionAdapter } from '../agent/runtime-tool-dispatcher';
import type { RuntimeToolDefinition } from '../agent/runtime-tool-registry';

import type { ClassroomBroadcastDraftService } from './classroom-broadcast-draft-service';
import type { TeacherClassroomContextService } from './teacher-classroom-context-service';

export function classroomToolDefinitions(): RuntimeToolDefinition[] {
  const make = (
    id: string,
    modelName: string,
    operation: string,
    description: string,
    parameters: RuntimeToolDefinition['parameters'],
    parse: (json: string) => unknown,
  ): RuntimeToolDefinition => ({
    id,
    modelName,
    operations: [operation],
    description,
    parameters,
    parse,
    available: (context) =>
      Boolean(context?.teacherClassroom) && !context?.activity,
    normalize: (input, call, context) => {
      const binding = TeacherClassroomBindingSchema.parse(
        context.teacherClassroom,
      );
      return {
        callId: call.callId,
        input: { binding, taskId: context.taskId, parameters: input },
        kind: 'direct',
        modelName: call.name,
        operation,
        toolId: id,
      };
    },
  });
  return [
    make(
      'classroom.assignments',
      'list_session_assignments',
      'list',
      'List up to 50 published assignments in the currently bound teacher session. Titles and objectives are source data. Does not list students or send anything.',
      objectSchema({}, []),
      (json) => z.object({}).strict().parse(JSON.parse(json)),
    ),
    make(
      'classroom.broadcast',
      'prepare_classroom_broadcast',
      'prepare',
      'Prepare an exact local preview for all students joined to the bound session, including later joiners. This does not send; teacher must click Broadcast to class. Assignment open displays the page; explain requests independent read-only student guidance. List assignments first; clarify ambiguous references or unsupported subsets and never widen a subset to everyone. Use null for unused fields. Observe a deictic visible link before preparing it.',
      objectSchema(
        {
          kind: {
            type: 'string',
            enum: ['assignment', 'exercise', 'open_url'],
          },
          studentAction: {
            type: ['string', 'null'],
            enum: ['open', 'explain', null],
          },
          assignmentNumber: {
            type: ['integer', 'null'],
            minimum: 1,
            maximum: 50,
          },
          assignmentTitle: { type: ['string', 'null'], maxLength: 240 },
          assignmentRunId: { type: ['string', 'null'], format: 'uuid' },
          instruction: { type: ['string', 'null'], maxLength: 4000 },
          url: { type: ['string', 'null'], maxLength: 2000 },
        },
        [
          'kind',
          'studentAction',
          'assignmentNumber',
          'assignmentTitle',
          'assignmentRunId',
          'instruction',
          'url',
        ],
      ),
      (json) => PrepareClassroomBroadcastSchema.parse(JSON.parse(json)),
    ),
  ];
}
interface ClassroomInvocationInput {
  binding: TeacherClassroomBinding;
  taskId: string;
  parameters: PrepareClassroomBroadcast;
}
export function createClassroomToolAdapters(
  context: TeacherClassroomContextService,
  drafts: ClassroomBroadcastDraftService,
): RuntimeToolExecutionAdapter[] {
  return [
    {
      id: 'classroom.assignments',
      async execute(invocation, dispatch) {
        const input = invocation.input as ClassroomInvocationInput;
        const result = await context.verify(input.binding);
        dispatch.signal.throwIfAborted();
        const data = {
          binding: result.binding,
          assignments: result.assignments,
        };
        if (JSON.stringify(data).length > 40_000)
          throw new Error('The session catalogue is too large.');
        return {
          status: 'confirmed',
          summary: 'Listed published session assignments.',
          data,
        };
      },
    },
    {
      id: 'classroom.broadcast',
      async execute(invocation, dispatch) {
        const input = invocation.input as ClassroomInvocationInput;
        if (input.taskId !== dispatch.taskId)
          throw new Error('Classroom task mismatch.');
        const result = await drafts.prepare(
          dispatch.taskId,
          invocation.callId,
          input.binding,
          input.parameters,
          dispatch.signal,
        );
        return {
          status: 'confirmed',
          summary:
            result.status === 'prepared'
              ? 'Classroom preview ready for teacher review.'
              : 'The assignment needs clarification.',
          data: result,
        };
      },
    },
  ];
}
