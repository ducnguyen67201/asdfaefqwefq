import type {
  ActivateMembershipRequest,
  AgentActivityUpdate,
  AppPreferences,
  AppUpdateStatus,
  AuthStatus,
  ActivateCompanionCandidateRequest,
  CompanionAppearance,
  CompanionCustomizationStatus,
  CompanionGuidance,
  CompanionGuidanceVisual,
  CompanionInteraction,
  CompanionPosition,
  CompanionResponseActionRequest,
  CompanionResponseCard,
  CompanionSpeech,
  CompanionSpeechPlaybackReport,
  CompanionState,
  CompanionVoiceActivity,
  GenerateCompanionImageRequest,
  ConfigureVoiceRequest,
  TranscribeVoiceSegmentRequest,
  CuaStatus,
  DecideApprovalRequest,
  MembershipStatus,
  AddOrganizationMemberRequest,
  AddOrganizationMemberResponse,
  CancelOrganizationMemberRequest,
  CancelOrganizationMemberResponse,
  ListOrganizationMembersRequest,
  OrganizationCurrentResponse,
  OrganizationMemberList,
  UpdateOrganizationRequest,
  UpdateOrganizationResponse,
  RecordVoiceTranscriptRequest,
  RespondToInteractionRequest,
  SetVoiceAudioDuckingRequest,
  SteerTaskRequest,
  SubmitTaskRequest,
  SystemPermission,
  TaskHistory,
  TaskSnapshot,
  TaskUpdate,
  UsageBudgetSnapshot,
  UpdateAppPreferencesRequest,
  VoiceSegmentTranscription,
  VoiceDiagnostic,
  VoiceShortcutEvent,
  VoiceStatus,
  WorkspaceRuntimeAvailability,
  WorkspaceSelection,
  KnowledgeCapabilities,
  KnowledgeSpaceList,
  KnowledgeSpaceSummary,
  CreateKnowledgeSpaceRequest,
  CreateKnowledgeSpaceResponse,
  KnowledgeSourceList,
  SelectKnowledgeFilesRequest,
  KnowledgeFileSelection,
  UploadKnowledgeSelectionRequest,
  KnowledgeUploadResult,
  SaveKnowledgeActivityRequest,
  KnowledgeActivityDraft,
  PublishKnowledgeActivityRequest,
  KnowledgeActivityVersion,
  CreateKnowledgeRunRequest,
  KnowledgeRun,
  AssignedActivityList,
  HostedAttemptContext,
  KnowledgeDashboard,
  AcknowledgeKnowledgeAttemptRequest,
  SetKnowledgeRunStateRequest,
  GetKnowledgeDashboardRequest,
  PrepareActivityStarterRequest,
  SubmitKnowledgeSelectionRequest,
  KnowledgeGroup,
  KnowledgeGroupList,
  CreateKnowledgeGroupRequest,
  AddKnowledgeSpaceMembersRequest,
  AddKnowledgeSpaceMembersResult,
  KnowledgeSpaceMemberList,
  CreateKnowledgeInviteRequest,
  KnowledgeInvite,
  RedeemKnowledgeInviteRequest,
  RedeemKnowledgeInviteResponse,
  RequestKnowledgeAttemptHelp,
  ClassroomDirective,
  ClassroomDirectiveNotice,
  ClassroomSessionProjection,
  CreateClassroomDirectiveRequest,
  CreateKnowledgeRoomCodeRequest,
  JoinClassroomSessionRequest,
  KnowledgeAttemptMutationRequest,
  KnowledgeAttemptTransition,
  KnowledgeRoomCode,
  KnowledgeRoomRevocation,
  OpenClassroomDirectiveRequest,
  ResolveKnowledgeAttemptHelpRequest,
  ReviewKnowledgeAttemptRequest,
  RevokeKnowledgeRoomCodeRequest,
  SetClassroomLinkConsentRequest,
} from './contracts';

export const IPC_CHANNELS = {
  activateMembership: 'membership:activate',
  continueWithFree: 'membership:continue-free',
  agentActivity: 'agent:activity',
  appUpdateStatusChanged: 'update:status-changed',
  cancelTask: 'task:cancel',
  checkForAppUpdates: 'update:check',
  companionPositionChanged: 'companion:position-changed',
  companionAppearanceChanged: 'companion:appearance-changed',
  companionActivateCandidate: 'companion-customization:activate-candidate',
  companionCustomizationStatus: 'companion-customization:status',
  companionGenerateImage: 'companion-customization:generate',
  companionUseDefault: 'companion-customization:use-default',
  companionGuidanceChanged: 'companion:guidance-changed',
  companionGuidanceVisualChanged: 'companion:guidance-visual-changed',
  companionInteractionChanged: 'companion:interaction-changed',
  companionResponseAction: 'companion:response-action',
  companionResponseChanged: 'companion:response-changed',
  companionSpeechChanged: 'companion:speech-changed',
  companionReportSpeechPlayback: 'companion:report-speech-playback',
  companionStateChanged: 'companion:state-changed',
  companionVoiceActivityChanged: 'companion:voice-activity-changed',
  companionRevealMainWindow: 'companion:reveal-main-window',
  configureVoice: 'voice:configure',
  connectComputer: 'cua:connect',
  transcribeVoiceSegment: 'voice:transcribe-segment',
  decideApproval: 'task:decide-approval',
  getAppPreferences: 'preferences:get',
  getAppUpdateStatus: 'update:status',
  getComputerStatus: 'cua:status',
  getAuthStatus: 'auth:status',
  getMembershipStatus: 'membership:status',
  getOrganization: 'organization:get',
  updateOrganization: 'organization:update',
  listOrganizationMembers: 'organization:members:list',
  addOrganizationMember: 'organization:members:add',
  cancelOrganizationMember: 'organization:members:cancel',
  getUsageBudget: 'usage:budget',
  getTaskHistory: 'task:history',
  getVoiceStatus: 'voice:status',
  getWorkspaceRuntimeAvailability: 'workspace:runtime-availability',
  openSystemPermissionSettings: 'system:open-permission-settings',
  recordVoiceTranscript: 'voice:record-transcript',
  reportVoiceDiagnostic: 'voice:diagnostic',
  restartAndInstallAppUpdate: 'update:restart-and-install',
  respondToInteraction: 'task:respond',
  setCompanionState: 'companion:set-state',
  setCompanionVoiceActivity: 'companion:set-voice-activity',
  setVoiceAudioDucking: 'voice:set-audio-ducking',
  startTask: 'task:start',
  signInWithGoogle: 'auth:sign-in-google',
  signOutGoogle: 'auth:sign-out-google',
  steerTask: 'task:steer',
  submitTask: 'task:submit',
  selectWorkspace: 'workspace:select',
  taskUpdate: 'task:update',
  taskComposerFocusRequested: 'task:composer-focus-requested',
  updateAppPreferences: 'preferences:update',
  voiceShortcut: 'voice:shortcut',
  getKnowledgeCapabilities: 'knowledge:capabilities',
  listKnowledgeSpaces: 'knowledge:spaces:list',
  createKnowledgeSpace: 'knowledge:spaces:create',
  getKnowledgeSpace: 'knowledge:spaces:get',
  listKnowledgeSources: 'knowledge:sources:list',
  selectKnowledgeFiles: 'knowledge:files:select',
  uploadKnowledgeSelection: 'knowledge:files:upload',
  saveKnowledgeActivity: 'knowledge:activity:save',
  publishKnowledgeActivity: 'knowledge:activity:publish',
  createKnowledgeRun: 'knowledge:run:create',
  setKnowledgeRunState: 'knowledge:run:set-state',
  listAssignedActivities: 'knowledge:assignments:list',
  getHostedAttempt: 'knowledge:attempt:get',
  acknowledgeHostedAttempt: 'knowledge:attempt:acknowledge',
  getKnowledgeDashboard: 'knowledge:dashboard:get',
  prepareActivityStarter: 'knowledge:starter:prepare',
  submitKnowledgeSelection: 'knowledge:submission:upload',
  listKnowledgeGroups: 'knowledge:groups:list',
  createKnowledgeGroup: 'knowledge:groups:create',
  listKnowledgeMembers: 'knowledge:members:list',
  addKnowledgeSpaceMembers: 'knowledge:members:add',
  createKnowledgeInvite: 'knowledge:invites:create',
  redeemKnowledgeInvite: 'knowledge:invites:redeem',
  requestKnowledgeAttemptHelp: 'knowledge:attempt:help',
  createKnowledgeRoomCode: 'classroom:room-code:create',
  revokeKnowledgeRoomCode: 'classroom:room-code:revoke',
  joinKnowledgeRoom: 'classroom:join',
  restoreClassroomSession: 'classroom:restore',
  getClassroomSession: 'classroom:session:get',
  classroomSessionChanged: 'classroom:session:changed',
  leaveClassroomSession: 'classroom:leave',
  setClassroomLinkConsent: 'classroom:link-consent:set',
  createClassroomDirective: 'classroom:directive:create',
  classroomDirectiveChanged: 'classroom:directive:changed',
  openClassroomDirective: 'classroom:directive:open',
  dismissClassroomDirective: 'classroom:directive:dismiss',
  readyKnowledgeAttempt: 'classroom:attempt:ready',
  reviewKnowledgeAttempt: 'classroom:attempt:review',
  resolveKnowledgeAttemptHelp: 'classroom:attempt:help-resolve',
} as const;

export interface DesktopApi {
  activateMembership(
    request: ActivateMembershipRequest,
  ): Promise<MembershipStatus>;
  continueWithFree(): Promise<MembershipStatus>;
  cancelTask(taskId: string): Promise<TaskSnapshot>;
  checkForAppUpdates(): Promise<AppUpdateStatus>;
  configureVoice(request: ConfigureVoiceRequest): Promise<VoiceStatus>;
  connectComputer(): Promise<CuaStatus>;
  transcribeVoiceSegment(
    request: TranscribeVoiceSegmentRequest,
  ): Promise<VoiceSegmentTranscription>;
  decideApproval(request: DecideApprovalRequest): Promise<TaskSnapshot>;
  activateCompanionCandidate(
    request: ActivateCompanionCandidateRequest,
  ): Promise<CompanionCustomizationStatus>;
  generateCompanionImage(
    request: GenerateCompanionImageRequest,
  ): Promise<CompanionCustomizationStatus>;
  getAppPreferences(): Promise<AppPreferences>;
  getAppUpdateStatus(): Promise<AppUpdateStatus>;
  getComputerStatus(): Promise<CuaStatus>;
  getCompanionCustomizationStatus(): Promise<CompanionCustomizationStatus>;
  getMembershipStatus(): Promise<MembershipStatus>;
  getOrganization(): Promise<OrganizationCurrentResponse>;
  updateOrganization(
    request: UpdateOrganizationRequest,
  ): Promise<UpdateOrganizationResponse>;
  listOrganizationMembers(
    request: ListOrganizationMembersRequest,
  ): Promise<OrganizationMemberList>;
  addOrganizationMember(
    request: AddOrganizationMemberRequest,
  ): Promise<AddOrganizationMemberResponse>;
  cancelOrganizationMember(
    request: CancelOrganizationMemberRequest,
  ): Promise<CancelOrganizationMemberResponse>;
  getUsageBudget(taskId?: string): Promise<UsageBudgetSnapshot>;
  getTaskHistory(): Promise<TaskHistory>;
  getAuthStatus(): Promise<AuthStatus>;
  getVoiceStatus(): Promise<VoiceStatus>;
  getWorkspaceRuntimeAvailability(): Promise<WorkspaceRuntimeAvailability>;
  getKnowledgeCapabilities(): Promise<KnowledgeCapabilities>;
  listKnowledgeSpaces(): Promise<KnowledgeSpaceList>;
  createKnowledgeSpace(request: CreateKnowledgeSpaceRequest): Promise<CreateKnowledgeSpaceResponse>;
  getKnowledgeSpace(spaceId: string): Promise<KnowledgeSpaceSummary>;
  listKnowledgeSources(spaceId: string): Promise<KnowledgeSourceList>;
  selectKnowledgeFiles(request: SelectKnowledgeFilesRequest): Promise<KnowledgeFileSelection | null>;
  uploadKnowledgeSelection(request: UploadKnowledgeSelectionRequest): Promise<KnowledgeUploadResult>;
  saveKnowledgeActivity(request: SaveKnowledgeActivityRequest): Promise<KnowledgeActivityDraft>;
  publishKnowledgeActivity(request: PublishKnowledgeActivityRequest): Promise<KnowledgeActivityVersion>;
  createKnowledgeRun(request: CreateKnowledgeRunRequest): Promise<KnowledgeRun>;
  setKnowledgeRunState(request: SetKnowledgeRunStateRequest): Promise<KnowledgeRun>;
  listAssignedActivities(): Promise<AssignedActivityList>;
  getHostedAttempt(attemptId: string): Promise<HostedAttemptContext>;
  acknowledgeHostedAttempt(request: AcknowledgeKnowledgeAttemptRequest): Promise<void>;
  getKnowledgeDashboard(request: GetKnowledgeDashboardRequest): Promise<KnowledgeDashboard>;
  prepareActivityStarter(request: PrepareActivityStarterRequest): Promise<WorkspaceSelection | null>;
  submitKnowledgeSelection(request: SubmitKnowledgeSelectionRequest): Promise<KnowledgeUploadResult>;
  listKnowledgeGroups(spaceId: string): Promise<KnowledgeGroupList>;
  createKnowledgeGroup(request: CreateKnowledgeGroupRequest): Promise<KnowledgeGroup>;
  listKnowledgeMembers(spaceId: string): Promise<KnowledgeSpaceMemberList>;
  addKnowledgeSpaceMembers(request: AddKnowledgeSpaceMembersRequest): Promise<AddKnowledgeSpaceMembersResult>;
  createKnowledgeInvite(request: CreateKnowledgeInviteRequest): Promise<KnowledgeInvite>;
  redeemKnowledgeInvite(request: RedeemKnowledgeInviteRequest): Promise<RedeemKnowledgeInviteResponse>;
  requestKnowledgeAttemptHelp(request: RequestKnowledgeAttemptHelp): Promise<void>;
  createKnowledgeRoomCode(request: CreateKnowledgeRoomCodeRequest): Promise<KnowledgeRoomCode>;
  revokeKnowledgeRoomCode(request: RevokeKnowledgeRoomCodeRequest): Promise<KnowledgeRoomRevocation>;
  joinKnowledgeRoom(request: JoinClassroomSessionRequest): Promise<ClassroomSessionProjection>;
  restoreClassroomSession(): Promise<ClassroomSessionProjection | null>;
  getClassroomSession(): Promise<ClassroomSessionProjection | null>;
  leaveClassroomSession(request: KnowledgeAttemptMutationRequest): Promise<void>;
  setClassroomLinkConsent(request: SetClassroomLinkConsentRequest): Promise<ClassroomSessionProjection | null>;
  createClassroomDirective(request: CreateClassroomDirectiveRequest): Promise<ClassroomDirective>;
  openClassroomDirective(request: OpenClassroomDirectiveRequest): Promise<void>;
  dismissClassroomDirective(directiveId: string): Promise<void>;
  readyKnowledgeAttempt(request: KnowledgeAttemptMutationRequest): Promise<KnowledgeAttemptTransition>;
  reviewKnowledgeAttempt(request: ReviewKnowledgeAttemptRequest): Promise<KnowledgeAttemptTransition>;
  resolveKnowledgeAttemptHelp(request: ResolveKnowledgeAttemptHelpRequest): Promise<KnowledgeAttemptTransition>;
  onClassroomSessionChanged(listener: (session: ClassroomSessionProjection | null) => void): () => void;
  onClassroomDirectiveChanged(listener: (notice: ClassroomDirectiveNotice | null) => void): () => void;
  onTaskUpdate(listener: (update: TaskUpdate) => void): () => void;
  onTaskComposerFocusRequested(
    listener: (taskId: string) => void,
  ): () => void;
  onAgentActivity(
    listener: (activity: AgentActivityUpdate) => void,
  ): () => void;
  onAppUpdateStatusChanged(
    listener: (status: AppUpdateStatus) => void,
  ): () => void;
  onVoiceShortcut(listener: (event: VoiceShortcutEvent) => void): () => void;
  openSystemPermissionSettings(permission: SystemPermission): Promise<void>;
  recordVoiceTranscript(request: RecordVoiceTranscriptRequest): Promise<void>;
  reportVoiceDiagnostic(diagnostic: VoiceDiagnostic): Promise<void>;
  restartAndInstallAppUpdate(): Promise<void>;
  respondToInteraction(
    request: RespondToInteractionRequest,
  ): Promise<TaskSnapshot>;
  setCompanionState(state: CompanionState): Promise<void>;
  setCompanionVoiceActivity(
    activity: CompanionVoiceActivity | null,
  ): Promise<void>;
  setVoiceAudioDucking(request: SetVoiceAudioDuckingRequest): Promise<void>;
  startTask(taskId: string): Promise<TaskSnapshot>;
  signInWithGoogle(): Promise<AuthStatus>;
  signOutGoogle(): Promise<AuthStatus>;
  selectWorkspace(): Promise<WorkspaceSelection | null>;
  steerTask(request: SteerTaskRequest): Promise<TaskSnapshot>;
  submitTask(request: SubmitTaskRequest): Promise<TaskSnapshot>;
  updateAppPreferences(
    request: UpdateAppPreferencesRequest,
  ): Promise<AppPreferences>;
  useDefaultCompanion(): Promise<CompanionCustomizationStatus>;
}

export interface CompanionApi {
  decideApproval(request: DecideApprovalRequest): Promise<TaskSnapshot>;
  onAppearanceChange(
    listener: (appearance: CompanionAppearance) => void,
  ): () => void;
  onGuidanceChange(
    listener: (guidance: CompanionGuidance | null) => void,
  ): () => void;
  onGuidanceVisualChange(
    listener: (visual: CompanionGuidanceVisual | null) => void,
  ): () => void;
  onInteractionChange(
    listener: (interaction: CompanionInteraction | null) => void,
  ): () => void;
  onPositionChange(listener: (position: CompanionPosition) => void): () => void;
  onResponseChange(
    listener: (response: CompanionResponseCard | null) => void,
  ): () => void;
  onSpeechChange(listener: (speech: CompanionSpeech | null) => void): () => void;
  onStateChange(listener: (state: CompanionState) => void): () => void;
  onVoiceActivityChange(
    listener: (activity: CompanionVoiceActivity | null) => void,
  ): () => void;
  reportSpeechPlayback(report: CompanionSpeechPlaybackReport): Promise<void>;
  performResponseAction(
    request: CompanionResponseActionRequest,
  ): Promise<void>;
  respondToInteraction(
    request: RespondToInteractionRequest,
  ): Promise<TaskSnapshot>;
  revealMainWindow(): Promise<void>;
}
