import { validatePublicHttpsUrl } from '../../shared/classroom-url-policy';
import type { ApplicationSurfaceVerifier } from '../application/application-surface-verifier';
import type {
  ApplicationLaunchReceipt,
  LaunchableApplication,
} from '../application/desktop-application-launcher';
import type { CuaService } from '../cua/cua-service';

import type {
  ResolvedToolInvocation,
  ToolExecutionResult,
} from './agent-contracts';
import type {
  ObserveSurfaceToolInput,
  PrepareBrowserAccessToolInput,
  SurfaceControlToolInput,
} from './cua-semantic-agent-tools';
import {
  RuntimeToolDispatcher,
  type RuntimeToolExecutionAdapter,
} from './runtime-tool-dispatcher';
import type {
  DesktopControlToolInput,
  GuidanceToolInput,
  OpenApplicationToolInput,
  OpenUrlToolInput,
} from './runtime-tool-registry';
import type { TaskRuntime } from './task-runtime';

interface ExecutionCoordinatorOptions {
  additionalToolAdapters?: readonly RuntimeToolExecutionAdapter[];
  applicationSurfaceVerifier?: Pick<ApplicationSurfaceVerifier, 'verify'>;
  cua: Pick<
    CuaService,
    | 'endTaskSession'
    | 'executeCommand'
    | 'executeSurfaceCommand'
    | 'inspectSurfaceRegion'
    | 'observe'
    | 'observeCurrentSurface'
    | 'prepareBrowserAccess'
    | 'startTaskSession'
  >;
  openApplication?: (
    application: LaunchableApplication,
  ) => Promise<ApplicationLaunchReceipt>;
  openExternal?: (url: string) => Promise<void>;
  onDesktopControlChange?: (
    taskId: string,
    active: boolean,
  ) => Promise<void> | void;
  presentGuidance?: (
    input: GuidanceToolInput,
    context: { signal: AbortSignal; taskId: string },
  ) => Promise<void>;
  runtime: TaskRuntime;
  toolDispatcher?: Pick<RuntimeToolDispatcher, 'dispatch'>;
}

/**
 * Electron-only execution adapter for tool calls authorized by the Rust engine.
 * It owns native handles and dispatches exactly once; it does not plan, route
 * models, compile intent, or make policy decisions.
 */
export class TaskExecutionCoordinator {
  private readonly activeTaskIds = new Set<string>();

  private readonly cua: ExecutionCoordinatorOptions['cua'];

  private readonly onDesktopControlChange: NonNullable<
    ExecutionCoordinatorOptions['onDesktopControlChange']
  >;

  private readonly toolDispatcher: Pick<RuntimeToolDispatcher, 'dispatch'>;

  constructor({
    additionalToolAdapters = [],
    applicationSurfaceVerifier = {
      verify: async () => ({
        status: 'unknown' as const,
        summary: 'Trusted application-surface verification is not configured.',
      }),
    },
    cua,
    openApplication = async () => {
      throw new Error('Application launch is not configured.');
    },
    openExternal = async () => {
      throw new Error('URL navigation is not configured.');
    },
    onDesktopControlChange = async () => undefined,
    presentGuidance = async () => undefined,
    runtime,
    toolDispatcher,
  }: ExecutionCoordinatorOptions) {
    this.cua = cua;
    this.onDesktopControlChange = onDesktopControlChange;
    this.toolDispatcher =
      toolDispatcher ??
      new RuntimeToolDispatcher([
        {
          id: 'desktop.observe',
          execute: async (_invocation, context) => ({
            observation: await cua.observe(context.taskId, context.signal),
            status: 'confirmed',
            summary: 'Captured a fresh desktop observation.',
          }),
        },
        {
          id: 'computer.observe',
          execute: async (invocation, context) => {
            const input = invocation.input as ObserveSurfaceToolInput;
            if (invocation.operation === 'inspect_surface_region') {
              if (!input.observationId || !input.region) {
                throw new Error(
                  'Original-resolution inspection requires a current observation and region.',
                );
              }
              const crop = cua.inspectSurfaceRegion(
                context.taskId,
                input.observationId,
                input.region,
              );
              return {
                data: {
                  crop: {
                    height: crop.height,
                    observationId: crop.observationId,
                    region: crop.region,
                    width: crop.width,
                  },
                },
                imageDataUrl: crop.dataUrl,
                status: 'confirmed' as const,
                summary: `Captured a ${crop.width} by ${crop.height} original-resolution crop.`,
              };
            }
            const observation =
              (await cua.observeCurrentSurface(
                context.taskId,
                { query: input.query },
                context.signal,
              )) ?? (await cua.observe(context.taskId, context.signal));
            return {
              observation,
              status: 'confirmed' as const,
              summary: 'Captured a fresh application-surface observation.',
            };
          },
        },
        {
          id: 'application.launch',
          execute: async (invocation, context) => {
            const input = invocation.input as OpenApplicationToolInput;
            const receipt = await openApplication(input.application);
            const snapshot = runtime.getSnapshot(context.taskId);
            const criterion =
              snapshot.goal?.schemaVersion === 9
                ? snapshot.goal.outcomeContract.criteria.find(
                    (candidate) =>
                      candidate.verifier.kind === 'application_surface' &&
                      candidate.verifier.application === input.application,
                  )
                : undefined;
            if (!criterion) {
              return {
                status: 'unknown' as const,
                summary:
                  'The launch was accepted, but the current contract has no trusted application-surface verifier.',
              };
            }
            const verification = await applicationSurfaceVerifier.verify(
              context.taskId,
              criterion.id,
              receipt,
              context.signal,
            );
            return {
              ...(verification.evidence
                ? {
                    data: {
                      applicationSurfaceEvidence: {
                        observationFingerprint:
                          verification.evidence.observationFingerprint,
                        observationId: verification.evidence.observationId,
                      },
                    },
                  }
                : {}),
              status: verification.status,
              summary: verification.summary,
            };
          },
        },
        {
          id: 'browser.navigate',
          execute: async (invocation) => {
            const input = invocation.input as OpenUrlToolInput;
            const target = validatePublicHttpsUrl(input.url);
            if (!target) {
              throw new Error('Browser navigation requires a credential-free public HTTPS URL.');
            }
            await openExternal(target.toString());
            return {
              status: 'confirmed',
              summary: 'The browser accepted the HTTPS navigation request.',
            };
          },
        },
        {
          id: 'desktop.control',
          execute: (invocation, context) => {
            const input = invocation.input as DesktopControlToolInput;
            return cua.executeCommand(
              context.taskId,
              input.command,
              context.signal,
            );
          },
        },
        {
          id: 'computer.control',
          execute: (invocation, context) => {
            const input = invocation.input as SurfaceControlToolInput;
            return cua.executeSurfaceCommand(
              context.taskId,
              input.observationId,
              input.command,
              context.signal,
            );
          },
        },
        {
          id: 'browser.prepare',
          execute: (invocation, context) => {
            const input = invocation.input as PrepareBrowserAccessToolInput;
            return cua.prepareBrowserAccess(
              context.taskId,
              input.observationId,
              context.signal,
            );
          },
        },
        {
          id: 'task.guidance',
          execute: async (invocation, context) => {
            const input = invocation.input as GuidanceToolInput;
            const result = await cua.executeCommand(
              context.taskId,
              { kind: 'point', x: input.x, y: input.y },
              context.signal,
            );
            await presentGuidance(input, context);
            return result;
          },
        },
        ...additionalToolAdapters,
      ]);
  }

  async dispatchHostedTool(
    invocation: ResolvedToolInvocation,
    context: { signal: AbortSignal; taskId: string },
  ): Promise<ToolExecutionResult> {
    if (
      invocation.toolId === 'desktop.observe' ||
      invocation.toolId === 'desktop.control' ||
      invocation.toolId === 'computer.observe' ||
      invocation.toolId === 'computer.control' ||
      invocation.toolId === 'browser.prepare'
    ) {
      await this.cua.startTaskSession(context.taskId, context.signal);
      this.activeTaskIds.add(context.taskId);
    }
    const controlsDesktop =
      invocation.toolId === 'desktop.control' ||
      invocation.toolId === 'computer.control';
    if (controlsDesktop) {
      await this.onDesktopControlChange(context.taskId, true);
    }
    try {
      return await this.toolDispatcher.dispatch(invocation, context);
    } finally {
      if (controlsDesktop) {
        await this.onDesktopControlChange(context.taskId, false);
      }
    }
  }

  async endHostedTask(taskId: string): Promise<void> {
    this.activeTaskIds.delete(taskId);
    await this.cua.endTaskSession(taskId);
  }

  async shutdown(): Promise<void> {
    const taskIds = [...this.activeTaskIds];
    this.activeTaskIds.clear();
    await Promise.all(taskIds.map((taskId) => this.cua.endTaskSession(taskId)));
  }
}
