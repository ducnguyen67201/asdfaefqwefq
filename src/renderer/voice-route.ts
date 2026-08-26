import type { VoiceTurnContext } from './use-push-to-talk';

export type VoiceTurnRoute =
  | 'global_dictation'
  | 'local_dictation'
  | 'task';

export function voiceTurnRoute(
  context: Pick<VoiceTurnContext, 'activation' | 'mode'>,
): VoiceTurnRoute {
  if (context.mode === 'task') return 'task';
  return context.activation === 'global_hold'
    ? 'global_dictation'
    : 'local_dictation';
}
