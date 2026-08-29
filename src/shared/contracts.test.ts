import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ActivateCompanionCandidateRequestSchema,
  ActivateSavedCompanionRequestSchema,
  ActivateMembershipRequestSchema,
  ActionEffectSchema,
  AgentActivityUpdateSchema,
  AgentTaskContractV3Schema,
  AgentTaskContractV4Schema,
  AgentTaskContractV5Schema,
  AgentTaskContractV6Schema,
  AppPreferencesSchema,
  CompanionAppearanceSchema,
  CompanionCustomizationStatusSchema,
  CompanionGenerationQuotaSchema,
  CompanionPetNudgeDraftSchema,
  CompanionPetNudgeSchema,
  GenerateCompanionImageRequestSchema,
  HostedDesktopInvocationSchema,
  IntentAuthorizationContractSchema,
  CompanionResponseActionRequestSchema,
  CompanionResponseCardSchema,
  SubmitTaskRequestSchema,
  CompanionSpeechPlaybackReportSchema,
  CompanionSpeechSchema,
  ClassroomDirectiveSchema,
  CreateKnowledgeClassSessionRequestSchema,
  CreateKnowledgeRunRequestSchema,
  MembershipStatusSchema,
  AddOrganizationMemberRequestSchema,
  CancelOrganizationMemberRequestSchema,
  OrganizationCurrentResponseSchema,
  OrganizationMemberListSchema,
  UpdateOrganizationRequestSchema,
  UpdateOrganizationResponseSchema,
  PlanIdSchema,
  SavedCompanionSchema,
  SaveKnowledgeActivityRequestSchema,
  LEGACY_VOICE_TRANSCRIPTION_MODEL,
  MAX_COMPANION_IMAGE_BYTES,
  TaskComposerFocusRequestSchema,
  TaskHistorySchema,
  TaskProgressSchema,
  TranscribeVoiceSegmentRequestSchema,
  UsageBudgetSnapshotSchema,
  VoiceSegmentTranscriptionSchema,
  VoiceStatusSchema,
  VOICE_TRANSCRIPTION_MODEL,
} from './contracts';

describe('companion customization contracts', () => {
  const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const activeHash = 'a'.repeat(64);
  const quota = {
    limit: 5,
    periodEndsAt: '2026-09-01T00:00:00.000Z',
    periodStartsAt: '2026-08-01T00:00:00.000Z',
    remaining: 2,
    used: 3,
  } as const;

  it('accepts bounded strict image generation and activation requests', () => {
    const imageBase64 = Buffer.from('png').toString('base64');
    expect(
      GenerateCompanionImageRequestSchema.parse({
        imageBase64,
        mimeType: 'image/png',
        prompt: '  Make it a blue space cat.  ',
        requestId: candidateId,
      }),
    ).toMatchObject({ prompt: 'Make it a blue space cat.' });
    expect(
      ActivateCompanionCandidateRequestSchema.parse({ candidateId }),
    ).toEqual({ candidateId });
    expect(
      GenerateCompanionImageRequestSchema.safeParse({
        extra: true,
        imageBase64,
        mimeType: 'image/png',
        prompt: 'cat',
        requestId: candidateId,
      }).success,
    ).toBe(false);
  });

  it('rejects malformed base64 and decoded images above five MiB', () => {
    const oversized = Buffer.alloc(MAX_COMPANION_IMAGE_BYTES + 1).toString(
      'base64',
    );
    for (const imageBase64 of ['not base64', 'AAA', 'AAAA=', oversized]) {
      expect(
        GenerateCompanionImageRequestSchema.safeParse({
          imageBase64,
          mimeType: 'image/jpeg',
          prompt: 'cat',
          requestId: candidateId,
        }).success,
      ).toBe(false);
    }
  });

  it('accepts only exact credential-free companion asset URLs', () => {
    for (const assetUrl of [
      `trocode-companion://asset/active/${activeHash}`,
      `trocode-companion://asset/candidate/${candidateId}`,
    ]) {
      expect(
        CompanionAppearanceSchema.safeParse({
          assetUrl,
          kind: 'custom',
          revision: activeHash,
        }).success,
      ).toBe(true);
    }
    for (const assetUrl of [
      `file:///active/${activeHash}`,
      `https://asset/active/${activeHash}`,
      `trocode-companion://user:pass@asset/active/${activeHash}`,
      `trocode-companion://asset/active/${activeHash}?token=secret`,
      `trocode-companion://asset/active/${activeHash.toUpperCase()}`,
      `trocode-companion://asset/../active/${activeHash}`,
    ]) {
      expect(
        CompanionAppearanceSchema.safeParse({
          assetUrl,
          kind: 'custom',
          revision: activeHash,
        }).success,
      ).toBe(false);
    }
  });

  it('requires internally consistent quota and available status', () => {
    expect(CompanionGenerationQuotaSchema.parse(quota)).toEqual(quota);
    expect(
      CompanionGenerationQuotaSchema.safeParse({
        ...quota,
        remaining: 1,
      }).success,
    ).toBe(false);
    expect(
      CompanionCustomizationStatusSchema.safeParse({
        appearance: { kind: 'default' },
        candidate: null,
        quota: null,
        savedCompanions: [],
        state: 'available',
        summary: 'Ready.',
      }).success,
    ).toBe(false);
  });

  it('binds saved companion selection and asset URLs to one hash', () => {
    const companionId = 'a'.repeat(64);
    expect(
      ActivateSavedCompanionRequestSchema.parse({ companionId }),
    ).toEqual({ companionId });
    expect(
      SavedCompanionSchema.safeParse({
        assetUrl: `trocode-companion://asset/active/${companionId}`,
        createdAt: '2026-08-25T00:00:00.000Z',
        id: companionId,
      }).success,
    ).toBe(true);
    expect(
      SavedCompanionSchema.safeParse({
        assetUrl: `trocode-companion://asset/active/${'b'.repeat(64)}`,
        createdAt: '2026-08-25T00:00:00.000Z',
        id: companionId,
      }).success,
    ).toBe(false);
  });
});

describe('organization management contracts', () => {
  const bannerDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const organization = {
    capacity: {
      assignedSeats: 10,
      maxSeats: 10,
      remainingSeats: 0,
      state: 'full',
    },
    homeBanner: null,
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Math Teachers',
    plan: 'pro',
    role: 'organizer',
  };

  it('accepts strict organization summaries and bounded member pages', () => {
    expect(
      OrganizationCurrentResponseSchema.parse({ organization }),
    ).toEqual({ organization });
    expect(
      OrganizationMemberListSchema.parse({
        items: [{
          createdAt: '2026-08-25T08:00:00.000Z',
          email: 'student@example.com',
          id: '22222222-2222-4222-8222-222222222222',
          joinedAt: null,
          name: null,
          role: 'member',
          state: 'pending',
        }],
        organization,
        page: { limit: 50, offset: 0, total: 1 },
      }),
    ).toMatchObject({ page: { total: 1 } });
  });

  it('normalizes email and rejects extra fields or malformed member IDs', () => {
    expect(
      AddOrganizationMemberRequestSchema.parse({
        email: ' Student@Example.com ',
      }),
    ).toEqual({ email: 'Student@Example.com' });
    expect(
      AddOrganizationMemberRequestSchema.safeParse({
        email: 'student@example.com',
        organizationId: organization.id,
      }).success,
    ).toBe(false);
    expect(
      CancelOrganizationMemberRequestSchema.safeParse({ memberId: 'member-1' })
        .success,
    ).toBe(false);
  });

  it('normalizes bounded organization names and rejects delegated authority', () => {
    expect(
      UpdateOrganizationRequestSchema.parse({
        name: '  Greenfield School  ',
      }),
    ).toEqual({ name: 'Greenfield School' });
    expect(
      UpdateOrganizationResponseSchema.parse({
        organization: { ...organization, name: 'Greenfield School' },
      }),
    ).toMatchObject({ organization: { name: 'Greenfield School' } });
    expect(
      UpdateOrganizationRequestSchema.safeParse({ name: '   ' }).success,
    ).toBe(false);
    expect(
      UpdateOrganizationRequestSchema.safeParse({ name: 'a'.repeat(100) })
        .success,
    ).toBe(true);
    expect(
      UpdateOrganizationRequestSchema.safeParse({ name: 'a'.repeat(101) })
        .success,
    ).toBe(false);
    expect(
      UpdateOrganizationRequestSchema.safeParse({
        name: 'Greenfield School',
        organizationId: organization.id,
      }).success,
    ).toBe(false);
  });

  it('accepts an image-only home banner or a default-banner reset', () => {
    expect(
      UpdateOrganizationRequestSchema.parse({
        homeBannerImageDataUrl: bannerDataUrl,
      }),
    ).toEqual({ homeBannerImageDataUrl: bannerDataUrl });
    expect(
      UpdateOrganizationRequestSchema.parse({
        homeBannerImageDataUrl: null,
      }),
    ).toEqual({ homeBannerImageDataUrl: null });
    expect(
      OrganizationCurrentResponseSchema.parse({
        organization: {
          ...organization,
          homeBanner: { imageDataUrl: bannerDataUrl },
        },
      }).organization?.homeBanner,
    ).toEqual({ imageDataUrl: bannerDataUrl });
    expect(
      UpdateOrganizationRequestSchema.safeParse({
        homeBannerImageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
      }).success,
    ).toBe(false);
    expect(
      UpdateOrganizationRequestSchema.safeParse({
        name: 'Math Teachers',
        homeBannerImageDataUrl: bannerDataUrl,
      }).success,
    ).toBe(false);
  });
});

describe('intent-aware execution contracts', () => {
  it('rejects hard-confirm grants and contradictory effect metadata', () => {
    expect(
      IntentAuthorizationContractSchema.safeParse({
        schemaVersion: 1,
        revision: 1,
        source: 'user_instruction',
        grants: [{
          id: 'send-calendar',
          effectKind: 'send_communication',
          resourceKinds: ['calendar_event'],
          permitsSafeDefaults: false,
        }],
      }).success,
    ).toBe(false);
    expect(
      ActionEffectSchema.safeParse({
        kind: 'create_resource',
        resourceKind: 'calendar_event',
        reversibility: 'reversible',
        externality: 'cloud_private',
        communication: 'invite',
        overwrite: 'none',
        sensitiveDataTransfer: false,
      }).success,
    ).toBe(false);
    expect(
      ActionEffectSchema.safeParse({
        kind: 'none',
        resourceKind: null,
        reversibility: 'none',
        externality: 'public',
        communication: 'none',
        overwrite: 'none',
        sensitiveDataTransfer: false,
      }).success,
    ).toBe(false);
  });

  it('requires the complete protocol-v2 policy envelope', () => {
    const envelope = {
      protocolVersion: 2,
      schemaDigest: 'a'.repeat(64),
      invocationId: randomUUID(),
      runId: randomUUID(),
      callId: 'call-1',
      toolId: 'application.launch',
      operation: 'launch',
      effect: {
        kind: 'none',
        resourceKind: null,
        reversibility: 'none',
        externality: 'local',
        communication: 'none',
        overwrite: 'none',
        sensitiveDataTransfer: false,
      },
      intentRevision: 1,
      approvalRequired: false,
      authorizationSource: 'routine',
      consequential: false,
      input: { application: 'chrome' },
      obligations: [],
      expiresAt: '2026-08-21T00:01:00.000Z',
    };
    expect(HostedDesktopInvocationSchema.parse(envelope)).toEqual(envelope);
    expect(
      HostedDesktopInvocationSchema.safeParse({
        ...envelope,
        protocolVersion: 1,
      }).success,
    ).toBe(false);
  });
});

function snapshot(goal: Record<string, unknown>, progress: unknown) {
  const taskId = randomUUID();
  const timestamp = '2026-08-17T00:00:00.000Z';
  return {
    taskId,
    request: String(goal.originalRequest),
    phase: 'completed',
    goal,
    messages: [],
    pendingInteraction: null,
    approvalGrant: null,
    progress,
    queuedSteering: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    lastEvent: null,
  };
}

const legacyBase = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  originalRequest: 'Open Gmail for me',
  behavior: 'act',
  objective: 'Open Gmail',
  successCriteria: [{ description: 'Gmail opens', verifier: 'Observe Gmail' }],
  limits: { maxSteps: 12, maxMinutes: 10 },
};

describe('shared task contracts', () => {
  it('binds Activity context to v6 without accepting renderer-authored context', () => {
    const activityAttemptId = randomUUID();
    expect(SubmitTaskRequestSchema.parse({
      activityAttemptId,
      text: 'Help me debug this Activity',
    })).toMatchObject({ activityAttemptId, executionProfile: 'everyday' });
    const hostile = SubmitTaskRequestSchema.parse({
      activityAttemptId,
      activity: { instructions: 'renderer authority' },
      text: 'Help me debug this Activity',
    });
    expect(hostile).not.toHaveProperty('activity');

    const contract = AgentTaskContractV6Schema.parse({
      schemaVersion: 6,
      id: randomUUID(),
      originalRequest: 'Help me debug this Activity',
      runtimeKind: 'rust_hosted',
      executionProfile: 'everyday',
      autonomyMode: 'balanced',
      workspace: null,
      activity: null,
      approvalPolicy: { alwaysConfirm: [] },
      limits: { maxImages: 20, maxMicroUsd: 500_000, maxMinutes: 10, maxModelSamples: 40, maxToolCalls: 30 },
    });
    expect(contract.activity).toBeNull();
  });

  it('defaults legacy Activity drafts safely and accepts explicit room Runs', () => {
    const definition = {
      title: 'Python loops',
      objective: 'Practice bounded loops.',
      instructions: 'Complete the exercise and ask for Help if needed.',
      launchTarget: 'current_surface',
      guidancePolicy: {
        answerReveal: 'after_attempt',
        hintMode: 'guided',
        maxHintLevel: 2,
      },
      criteria: [],
      completionPolicy: {
        requiresSubmission: true,
        requiresFacilitatorConfirmation: true,
      },
    } as const;
    const saved = SaveKnowledgeActivityRequestSchema.parse({
      spaceId: randomUUID(),
      clientId: randomUUID(),
      definition,
      sourceVersionIds: [],
    });
    expect(saved.definition.sessionPolicy).toEqual({
      allowedOrigins: [],
      allowRoomJoin: false,
    });
    expect(SaveKnowledgeActivityRequestSchema.safeParse({
      spaceId: randomUUID(),
      clientId: randomUUID(),
      definition: {
        ...definition,
        sessionPolicy: {
          allowedOrigins: ['https://class.example/exercise'],
          allowRoomJoin: true,
        },
      },
      sourceVersionIds: [],
    }).success).toBe(false);
    expect(SaveKnowledgeActivityRequestSchema.safeParse({
      spaceId: randomUUID(),
      clientId: randomUUID(),
      definition: {
        ...definition,
        sessionPolicy: {
          allowedOrigins: ['https://127.0.0.1'],
          allowRoomJoin: true,
        },
      },
      sourceVersionIds: [],
    }).success).toBe(false);
    expect(ClassroomDirectiveSchema.safeParse({
      id: randomUUID(),
      sequence: 1,
      kind: 'open_url',
      delivery: 'manual_only',
      instruction: 'Open this link.',
      criterionIds: [],
      url: 'https://[ff02::1]/exercise',
      origin: 'https://[ff02::1]',
      createdAt: '2026-08-25T00:00:00.000Z',
    }).success).toBe(false);

    expect(CreateKnowledgeRunRequestSchema.parse({
      spaceId: randomUUID(),
      clientId: randomUUID(),
      activityVersionId: randomUUID(),
      mode: 'live',
      opensAt: null,
      closesAt: null,
      target: { kind: 'room' },
      insightPolicy: 'explicit_and_operational',
    }).target).toEqual({ kind: 'room' });
    expect(CreateKnowledgeRunRequestSchema.safeParse({
      spaceId: randomUUID(),
      clientId: randomUUID(),
      activityVersionId: randomUUID(),
      mode: 'async',
      opensAt: null,
      closesAt: null,
      target: { kind: 'room' },
      insightPolicy: 'explicit_and_operational',
    }).success).toBe(false);

    const activityVersionIds = [randomUUID(), randomUUID()];
    expect(CreateKnowledgeClassSessionRequestSchema.parse({
      activityVersionIds,
      clientId: randomUUID(),
      spaceId: randomUUID(),
      title: '  Week 1: Debugging  ',
    })).toMatchObject({
      activityVersionIds,
      title: 'Week 1: Debugging',
    });
    expect(CreateKnowledgeClassSessionRequestSchema.safeParse({
      activityVersionIds: [activityVersionIds[0], activityVersionIds[0]],
      clientId: randomUUID(),
      spaceId: randomUUID(),
      title: 'Duplicate activity',
    }).success).toBe(false);
  });

  it('accepts explicit Check intent and leaves trusted Attempt inheritance to main', () => {
    const attemptId = randomUUID();
    expect(SubmitTaskRequestSchema.parse({
      text: 'Is this solution correct?',
      activityAttemptId: attemptId,
      activityIntent: 'check',
    })).toMatchObject({ activityAttemptId: attemptId, activityIntent: 'check' });
    expect(SubmitTaskRequestSchema.parse({
      text: 'Check this unrelated task.',
      activityIntent: 'check',
    })).toMatchObject({ activityAttemptId: null, activityIntent: 'check' });
  });
  it('validates bounded companion response cards across streaming and completion', () => {
    const cardId = randomUUID();
    const taskId = randomUUID();

    expect(
      CompanionResponseCardSchema.parse({
        cardId,
        message: '',
        phase: 'streaming',
        side: 'right',
        taskId,
      }),
    ).toEqual({ cardId, message: '', phase: 'streaming', side: 'right', taskId });

    expect(
      CompanionResponseCardSchema.parse({
        cardId,
        message: 'The task is complete.',
        phase: 'completed',
        side: 'left',
        taskId,
      }),
    ).toMatchObject({ cardId, phase: 'completed', taskId });

    for (const invalid of [
      { cardId: 'not-a-uuid', message: '', phase: 'streaming', side: 'right', taskId },
      { cardId, message: '', phase: 'streaming', side: 'right', taskId: 'not-a-uuid' },
      { cardId, message: ' '.repeat(4), phase: 'completed', side: 'right', taskId },
      { cardId, message: 'x'.repeat(8_001), phase: 'completed', side: 'right', taskId },
      { cardId, message: 'Done', phase: 'finished', side: 'right', taskId },
      { cardId, message: 'Done', phase: 'completed', side: 'center', taskId },
      {
        cardId,
        mediaUrl: 'https://provider.example/private-audio',
        message: 'Done',
        phase: 'completed',
        providerPayload: { token: 'secret' },
        side: 'right',
        taskId,
      },
    ]) {
      expect(CompanionResponseCardSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('validates strict, bounded classroom pet nudges', () => {
    const id = randomUUID();
    const message = 'x'.repeat(160);

    for (const mood of ['encouraging', 'waiting', 'celebrating'] as const) {
      expect(
        CompanionPetNudgeSchema.parse({
          id,
          language: 'en',
          message,
          mood,
          side: 'right',
        }),
      ).toEqual({ id, language: 'en', message, mood, side: 'right' });
    }

    expect(
      CompanionPetNudgeDraftSchema.parse({
        id,
        language: 'vi',
        message: '<img src=x onerror=alert(1)>',
        mood: 'encouraging',
      }).message,
    ).toBe('<img src=x onerror=alert(1)>');

    for (const invalid of [
      { id: 'invalid', language: 'en', message: 'Keep going', mood: 'encouraging' },
      { id, language: 'en', message: '', mood: 'encouraging' },
      { id, language: 'en', message: 'x'.repeat(161), mood: 'encouraging' },
      { id, language: 'en', message: 'Keep going', mood: 'watching' },
      { id, language: 'en', message: 'Keep going', mood: 'encouraging', extra: true },
      { id, language: 'en', message: 'Keep going', mood: 'encouraging', side: 'center' },
      { id, language: 'en', message: 'Keep going', mood: 'encouraging', side: 'right', extra: true },
    ]) {
      const schema = 'side' in invalid
        ? CompanionPetNudgeSchema
        : CompanionPetNudgeDraftSchema;
      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });

  it('limits companion response actions to stable card and task identifiers', () => {
    const cardId = randomUUID();
    const taskId = randomUUID();
    const actions = [
      'dismiss',
      'open_task',
      'ask_follow_up',
      'read_aloud',
      'stop_reading',
    ] as const;

    for (const action of actions) {
      expect(
        CompanionResponseActionRequestSchema.parse({ action, cardId, taskId }),
      ).toEqual({ action, cardId, taskId });
    }
    expect(
      CompanionResponseActionRequestSchema.safeParse({
        action: 'run_arbitrary_command',
        cardId,
        taskId,
      }).success,
    ).toBe(false);
    expect(
      CompanionResponseActionRequestSchema.safeParse({
        action: 'dismiss',
        cardId,
        label: 'Trust this arbitrary renderer label',
        target: 'https://untrusted.example',
        taskId,
      }).success,
    ).toBe(false);
  });

  it('accepts only a strict task id for composer focus requests', () => {
    const taskId = randomUUID();

    expect(TaskComposerFocusRequestSchema.parse({ taskId })).toEqual({
      taskId,
    });
    expect(
      TaskComposerFocusRequestSchema.safeParse({
        action: 'submit',
        taskId,
        text: 'This must not become a hidden follow-up.',
      }).success,
    ).toBe(false);
  });

  it('bounds normalized agent activity without exposing raw provider payloads', () => {
    const activity = AgentActivityUpdateSchema.parse({
      activityId: randomUUID(),
      sequence: 2,
      taskId: randomUUID(),
      timestamp: '2026-08-17T00:00:00.000Z',
      kind: 'tool_started',
      summary: 'Using observe_desktop.',
      tool: { name: 'observe_desktop', status: 'running' },
    });
    expect(activity.sequence).toBe(2);
    expect(activity).not.toHaveProperty('arguments');
    expect(() =>
      AgentActivityUpdateSchema.parse({
        ...activity,
        textDelta: 'x'.repeat(2_001),
      }),
    ).toThrow();
    expect(() =>
      AgentActivityUpdateSchema.parse({
        ...activity,
        kind: 'text_delta',
        tool: undefined,
      }),
    ).toThrow();
  });

  it('accepts only credential-free private companion audio URLs', () => {
    const id = randomUUID();
    expect(
      CompanionSpeechSchema.parse({
        id,
        mediaUrl: `trocode-audio://speech/${id}`,
        mimeType: 'audio/mpeg',
        source: 'elevenlabs',
        text: 'Read the task result.',
      }),
    ).toMatchObject({ id, source: 'elevenlabs' });

    for (const mediaUrl of [
      `https://speech/${id}`,
      `file:///tmp/${id}`,
      `data:audio/mpeg;base64,AQID`,
      `trocode-audio://speech/${id}?token=secret`,
      `trocode-audio://other/${id}`,
    ]) {
      expect(() =>
        CompanionSpeechSchema.parse({
          id,
          mediaUrl,
          mimeType: 'audio/mpeg',
          source: 'elevenlabs',
          text: 'Read the task result.',
        }),
      ).toThrow();
    }
  });

  it('bounds speech playback reports to fixed status and reason enums', () => {
    const id = randomUUID();
    expect(
      CompanionSpeechPlaybackReportSchema.parse({
        id,
        phase: 'fallback_started',
        reason: 'startup_timeout',
        source: 'elevenlabs',
      }),
    ).toMatchObject({ id, reason: 'startup_timeout' });
    expect(() =>
      CompanionSpeechPlaybackReportSchema.parse({
        id,
        phase: 'failed',
        reason: 'provider said secret key invalid',
        source: 'elevenlabs',
      }),
    ).toThrow();
  });

  it('accepts hosted access-code membership contracts', () => {
    expect(PlanIdSchema.options).toEqual(['free', 'basic', 'pro', 'max']);
    expect(
      MembershipStatusSchema.parse({
        expiresAt: null,
        plan: 'free',
        referenceCode: null,
        required: true,
        state: 'inactive',
        summary: 'Enter an access code to continue.',
      }),
    ).toMatchObject({ plan: 'free', referenceCode: null, state: 'inactive' });
    expect(ActivateMembershipRequestSchema.parse({ code: 'CODEA' })).toEqual({
      code: 'CODEA',
    });
  });

  it('parses v3 contract and tool-call progress', () => {
    expect(
      AgentTaskContractV3Schema.parse({
        schemaVersion: 3,
        id: randomUUID(),
        originalRequest: 'Write a chord progression.',
        approvalPolicy: { alwaysConfirm: ['send', 'delete'] },
        limits: { maxToolCalls: 30, maxMinutes: 10 },
      }),
    ).not.toHaveProperty('behavior');
    expect(
      TaskProgressSchema.parse({ kind: 'tool_calls', completed: 2, limit: 30 }),
    ).toEqual({ kind: 'tool_calls', completed: 2, limit: 30 });
  });

  it('parses v4 cost limits and sanitized budget snapshots', () => {
    expect(
      AgentTaskContractV4Schema.parse({
        approvalPolicy: { alwaysConfirm: ['send'] },
        id: randomUUID(),
        limits: {
          maxImages: 20,
          maxMicroUsd: 500_000,
          maxMinutes: 10,
          maxModelSamples: 40,
          maxToolCalls: 30,
        },
        originalRequest: 'Complete a useful task.',
        schemaVersion: 4,
      }),
    ).toMatchObject({ schemaVersion: 4 });
    const usageBudget = UsageBudgetSnapshotSchema.parse({
      actualMicroUsd: 1_000,
      daily: { limitMicroUsd: 2_000_000, remainingMicroUsd: 1_999_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
      enforcementMode: 'enforce',
      estimatedMicroUsd: 0,
      messages: {
        limit: 25,
        periodEndsAt: '2026-08-24T00:00:00.000Z',
        periodStartsAt: '2026-08-17T00:00:00.000Z',
        remaining: 24,
        used: 1,
      },
      monthEndsAt: '2026-09-01T00:00:00.000Z',
      monthly: { limitMicroUsd: 20_000_000, remainingMicroUsd: 19_999_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
      periodStartsAt: '2026-08-01T00:00:00.000Z',
      plan: 'free',
      pricing: { currency: 'usd', monthlyCents: 0 },
      source: 'hosted',
      task: { limitMicroUsd: 500_000, remainingMicroUsd: 499_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
      warningThresholdMicroUsd: 16_000_000,
    });
    expect(usageBudget).toMatchObject({
      messages: { limit: 25, remaining: 24, used: 1 },
      plan: 'free',
      pricing: { currency: 'usd', monthlyCents: 0 },
    });
    expect(usageBudget).not.toHaveProperty('prompt');
  });

  it('binds v5 Workspace contracts and submissions to one trusted selection', () => {
    const workspace = {
      selectionId: randomUUID(),
      canonicalPath: '/Users/person/project',
      displayName: 'project',
      selectedAt: '2026-08-18T00:00:00.000Z',
    };
    expect(
      AgentTaskContractV5Schema.parse({
        approvalPolicy: { alwaysConfirm: ['send'] },
        autonomyMode: 'balanced',
        executionProfile: 'workspace',
        id: randomUUID(),
        limits: {
          maxImages: 20,
          maxMicroUsd: 500_000,
          maxMinutes: 10,
          maxModelSamples: 40,
          maxToolCalls: 30,
        },
        originalRequest: 'Fix the tests.',
        runtimeKind: 'rust_hosted',
        schemaVersion: 5,
        workspace,
      }),
    ).toMatchObject({ runtimeKind: 'rust_hosted', workspace });
    expect(
      SubmitTaskRequestSchema.parse({
        executionProfile: 'workspace',
        text: 'Fix the tests.',
        workspaceSelectionId: workspace.selectionId,
      }),
    ).toMatchObject({ executionProfile: 'workspace' });
    expect(() =>
      SubmitTaskRequestSchema.parse({
        executionProfile: 'workspace',
        text: 'Fix the tests.',
      }),
    ).toThrow();
  });

  it('defaults missing persisted autonomy preferences to balanced', () => {
    expect(
      AppPreferencesSchema.parse({
        appLanguage: 'en',
        muteSystemAudioWhileSpeaking: false,
        primaryLanguage: 'en',
      }),
    ).toMatchObject({
      autonomyMode: 'balanced',
      classroomPetEnabled: true,
      voiceMode: 'dictation',
    });
  });

  it('loads mixed persisted v1 through v4 history', () => {
    const history = TaskHistorySchema.parse({
      events: [],
      persistence: { mode: 'postgres', summary: 'Saved.' },
      snapshots: [
        snapshot(
          {
            ...legacyBase,
            interactionMode: 'mixed',
            capabilities: ['browser'],
            approvals: { alwaysConfirm: ['send'] },
          },
          { currentStep: 1, maxSteps: 12 },
        ),
        snapshot(
          {
            ...legacyBase,
            schemaVersion: 2,
            approvalPolicy: { alwaysConfirm: ['send'] },
          },
          { currentStep: 2, maxSteps: 12 },
        ),
        snapshot(
          {
            schemaVersion: 3,
            id: randomUUID(),
            originalRequest: 'What is 27 × 14?',
            approvalPolicy: { alwaysConfirm: ['send'] },
            limits: { maxToolCalls: 30, maxMinutes: 10 },
          },
          { kind: 'tool_calls', completed: 0, limit: 30 },
        ),
        snapshot(
          {
            schemaVersion: 4,
            id: randomUUID(),
            originalRequest: 'Summarize the current screen.',
            approvalPolicy: { alwaysConfirm: ['send'] },
            limits: {
              maxImages: 20,
              maxMicroUsd: 500_000,
              maxMinutes: 10,
              maxModelSamples: 40,
              maxToolCalls: 30,
            },
          },
          { kind: 'tool_calls', completed: 1, limit: 30 },
        ),
      ],
    });

    expect(history.snapshots.map((item) => item.goal?.schemaVersion)).toEqual([
      2, 2, 3, 4,
    ]);
    expect(history.snapshots.every((item) => item.runtimeResume === null)).toBe(
      true,
    );
  });
});

describe('voice segment contracts', () => {
  const request = {
    audioBase64: Buffer.from(new Uint8Array(60)).toString('base64'),
    durationMs: 300,
    requestId: randomUUID(),
    sequence: 31,
    utteranceId: randomUUID(),
  };

  it('accepts bounded PCM WAV transport metadata', () => {
    expect(VOICE_TRANSCRIPTION_MODEL).toBe('gpt-transcribe');
    expect(LEGACY_VOICE_TRANSCRIPTION_MODEL).toBe('whisper-1');
    expect(TranscribeVoiceSegmentRequestSchema.parse(request)).toEqual(request);
    expect(
      VoiceSegmentTranscriptionSchema.parse({
        audioDurationMs: 300,
        billedSeconds: 0.3,
        model: VOICE_TRANSCRIPTION_MODEL,
        sequence: request.sequence,
        text: '',
        utteranceId: request.utteranceId,
      }),
    ).toMatchObject({ model: VOICE_TRANSCRIPTION_MODEL, text: '' });
    expect(
      VoiceSegmentTranscriptionSchema.parse({
        audioDurationMs: 300,
        billedSeconds: 0.3,
        model: LEGACY_VOICE_TRANSCRIPTION_MODEL,
        sequence: request.sequence,
        text: 'legacy response alias',
        utteranceId: request.utteranceId,
      }),
    ).toMatchObject({ model: LEGACY_VOICE_TRANSCRIPTION_MODEL });
    expect(
      VoiceStatusSchema.parse({
        model: VOICE_TRANSCRIPTION_MODEL,
        provider: 'openai',
        state: 'ready',
        summary: 'Voice input is ready.',
      }),
    ).toMatchObject({ model: VOICE_TRANSCRIPTION_MODEL });
  });

  it('rejects malformed identifiers, sequence, duration, and base64', () => {
    for (const invalid of [
      { ...request, requestId: 'not-a-uuid' },
      { ...request, utteranceId: 'not-a-uuid' },
      { ...request, sequence: 32 },
      { ...request, durationMs: 299 },
      { ...request, durationMs: 15_001 },
      { ...request, audioBase64: 'not base64' },
      { ...request, audioBase64: 'A'.repeat(61) },
      { ...request, audioBase64: 'A'.repeat(750_004) },
    ]) {
      expect(TranscribeVoiceSegmentRequestSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });
});
