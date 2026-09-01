import { z } from 'zod';

export const WalkthroughStateSchema = z
  .object({
    completedSteps: z.number().int().nonnegative().max(100),
    enabled: z.boolean(),
    phase: z.enum(['needs_observation', 'needs_guidance']),
  })
  .strict();

export type WalkthroughState = z.infer<typeof WalkthroughStateSchema>;
export type WalkthroughToolStatus = 'completed' | 'failed' | 'unknown' | 'cancelled';

export interface WalkthroughToolDecision {
  allowed: boolean;
  summary: string;
}

export type WalkthroughCompletionAssessment =
  | { accepted: true; finalOutput: string }
  | { accepted: false; correction: string };

const WALKTHROUGH_COMPLETION_PREFIX = 'WALKTHROUGH_COMPLETE: ';
const MAX_WALKTHROUGH_RECAP_LENGTH = 180;

function normalizeRequest(request: string): string {
  return request
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/đ/gu, 'd')
    .replace(/[\u2010-\u2015]/gu, '-');
}

/** Chooses teacher mode only for a request tied to a visible, concrete task. */
export function requestsGuidedWalkthrough(request: string): boolean {
  const normalized = normalizeRequest(request);
  const englishSpatialTour =
    /^(?:\s*please\s+)?(?:show\s+(?:me|us)\b|point\b|circle\b|highlight\b|(?:can|could|will|would)\s+you\b)/u.test(normalized) &&
    /\b(?:area|part|question|field|control|section|button|target|here|there)\b/u.test(normalized) &&
    /\b(?:explain|teach|tell|walk\s+(?:me|us)\s+through)\b/u.test(normalized) &&
    /\b(?:then|next|continue|one\s+(?:area|part|question|step)\s+at\s+a\s+time|move\s+to|go\s+to)\b/u.test(normalized);
  const englishVisibleHowTo =
    /\bhow\s+(?:do|can|should)\s+(?:i|we)\b/u.test(normalized) &&
    /(?:\b(?:this|that)\b|\bon[ -]screen\b)/u.test(normalized);
  const englishIntent =
    /\bguide\s+(?:me|us)\b/u.test(normalized) ||
    /\bwalk\s+(?:me|us)\s+through\b/u.test(normalized) ||
    /\bgive\s+(?:me|us)\s+guidance\s+(?:on\s+)?how\s+to\b/u.test(normalized) ||
    /\bshow\s+(?:me|us)\s+how\s+to\b/u.test(normalized) ||
    /^\s*(?:please\s+)?guide\s+(?:on\s+)?how\s+to\b/u.test(normalized) ||
    (/\bteach\s+(?:me|us)\b/u.test(normalized) &&
      /\b(?:step\s*-?\s*by\s*-?\s*step|one\s+step\s+at\s+a\s+time)\b/u.test(normalized)) ||
    englishSpatialTour ||
    englishVisibleHowTo;
  const englishSelfDirected =
    /\b(?:myself|ourselves)\b/u.test(normalized) &&
    /\b(?:do|complete|finish|solve|try|work\s+on)\b/u.test(normalized) &&
    (/\b(?:help|guide|show|teach)\s+(?:me|us)\b/u.test(normalized) ||
      /\blet\s+(?:me|us)\b/u.test(normalized) ||
      /\b(?:i|we)\s+(?:need|want|would\s+like)\s+to\b/u.test(normalized));
  if (englishIntent || englishSelfDirected) return true;

  const learner = '(?:toi|minh|em|chung toi|chung minh)';
  const vietnameseSelfDirected =
    new RegExp(`\\b(?:giup|chi|day|huong\\s+dan)\\s+(?:cho\\s+)?${learner}\\s+tu\\s+(?:lam|giai|hoan\\s+thanh|thuc\\s+hien)\\b`, 'u').test(normalized) ||
    new RegExp(`\\b(?:de|cho)\\s+${learner}\\s+tu\\s+(?:lam|giai|hoan\\s+thanh|thuc\\s+hien)\\b`, 'u').test(normalized) ||
    new RegExp(`\\b${learner}\\s+muon\\s+tu\\s+(?:lam|giai|hoan\\s+thanh|thuc\\s+hien)\\b`, 'u').test(normalized);
  const vietnameseSpatialTour =
    /^\s*(?:vui\s+long\s+)?(?:chi\s+vao|khoanh\s+vung|lam\s+noi\s+bat)\b/u.test(normalized) &&
    /\b(?:phan|cau|khu\s+vuc|o|nut|muc)\b/u.test(normalized) &&
    /\b(?:giai\s+thich|huong\s+dan|day)\b/u.test(normalized) &&
    /\b(?:sau\s+do|tiep\s+theo|tiep\s+tuc|chuyen\s+sang|tung\s+(?:phan|cau|buoc))\b/u.test(normalized);
  const vietnameseVisibleHowTo =
    /\blam\s+sao(?:\s+de)?\s+(?:lam|giai|thuc\s+hien)\b/u.test(normalized) &&
    /(?:^|\s)(?:nay|do|kia)(?:$|[\s.,!?;:])/u.test(normalized);
  return (
    new RegExp(`\\bhuong\\s+dan\\s+${learner}\\b`, 'u').test(normalized) ||
    /^\s*huong\s+dan\s+cach\s+lam\b/u.test(normalized) ||
    (new RegExp(`\\b(?:chi|day)\\s+(?:cho\\s+)?${learner}\\b`, 'u').test(normalized) &&
      /\b(?:tung\s+buoc|cach\s+lam)\b/u.test(normalized)) ||
    vietnameseSelfDirected ||
    vietnameseSpatialTour ||
    vietnameseVisibleHowTo
  );
}

export function createWalkthroughState(requestOrEnabled: string | boolean): WalkthroughState {
  return WalkthroughStateSchema.parse({
    completedSteps: 0,
    enabled: typeof requestOrEnabled === 'boolean'
      ? requestOrEnabled
      : requestsGuidedWalkthrough(requestOrEnabled),
    phase: 'needs_observation',
  });
}

export function evaluateWalkthroughTool(
  state: WalkthroughState,
  toolName: string,
): WalkthroughToolDecision {
  if (!state.enabled) return { allowed: true, summary: 'Walkthrough sequencing is not active.' };
  if (state.phase === 'needs_observation') {
    return toolName === 'observe_context'
      ? { allowed: true, summary: 'Capturing the next walkthrough step.' }
      : { allowed: false, summary: 'Capture a fresh desktop observation before the next teacher pointer step.' };
  }
  return toolName === 'show_guidance'
    ? { allowed: true, summary: 'Presenting one narrated teacher pointer step.' }
    : { allowed: false, summary: 'Show exactly one grounded target from the latest observation before continuing.' };
}

export function advanceWalkthrough(
  state: WalkthroughState,
  completedToolName: string,
  status: WalkthroughToolStatus = 'completed',
): WalkthroughState {
  if (!state.enabled || status !== 'completed') return state;
  if (state.phase === 'needs_observation' && completedToolName === 'observe_context') {
    return { ...state, phase: 'needs_guidance' };
  }
  if (state.phase === 'needs_guidance' && completedToolName === 'show_guidance') {
    return { ...state, completedSteps: state.completedSteps + 1, phase: 'needs_observation' };
  }
  return state;
}

export function nextWalkthroughCorrectionCount(
  current: number,
  toolStatus: WalkthroughToolStatus,
): number {
  return toolStatus === 'completed' ? 0 : current;
}

export function walkthroughModelInstruction(state: WalkthroughState): string {
  if (!state.enabled) return '';
  if (state.phase === 'needs_guidance') {
    const stepNumber = state.completedSteps + 1;
    return `Trusted teacher walkthrough checkpoint: this is step ${stepNumber}. Call show_guidance exactly once using the latest desktop observation. Point to one visible target and speak one concise, friendly instruction that naturally introduces step ${stepNumber} in the user's language. Do not click, modify the app, or reveal the remaining steps upfront.`;
  }
  if (state.completedSteps === 0) {
    return 'Trusted teacher walkthrough checkpoint: call observe_context with operation observe and scope desktop now. Do not return an upfront text answer. The first visible step must be one show_guidance call.';
  }
  return `Trusted teacher walkthrough checkpoint: if another visible step remains, call observe_context with operation observe and scope desktop. If the learner has completed the walkthrough, return exactly ${WALKTHROUGH_COMPLETION_PREFIX}<one concise recap>.`;
}

export function parseWalkthroughCompletion(output: string): string | null {
  if (!output.startsWith(WALKTHROUGH_COMPLETION_PREFIX)) return null;
  const recap = output.slice(WALKTHROUGH_COMPLETION_PREFIX.length);
  if (!recap || recap.length > MAX_WALKTHROUGH_RECAP_LENGTH || /[\r\n]/u.test(recap) || /(?:^|\s)(?:[-*\u2022]|\d{1,2}[.)])\s/u.test(recap)) {
    return null;
  }
  return recap;
}

export function assessWalkthroughCompletion(
  state: WalkthroughState,
  output: string,
): WalkthroughCompletionAssessment {
  if (!state.enabled) return { accepted: true, finalOutput: output };
  if (state.phase === 'needs_guidance') {
    return { accepted: false, correction: 'The text candidate was rejected. Call show_guidance now for the single target in the latest observation.' };
  }
  const recap = state.completedSteps > 0 ? parseWalkthroughCompletion(output) : null;
  if (recap) return { accepted: true, finalOutput: recap };
  return {
    accepted: false,
    correction: state.completedSteps === 0
      ? 'The text candidate was rejected. Start the teacher walkthrough with a desktop observation.'
      : `The text candidate was rejected. Continue with a fresh desktop observation, or finish exactly with ${WALKTHROUGH_COMPLETION_PREFIX}<one concise recap>.`,
  };
}

export const WALKTHROUGH_RECOVERY_INSTRUCTION = [
  'Trusted host correction: the upfront text response was rejected because the user requested an interactive walkthrough.',
  'Call observe_context with operation observe and scope desktop, then call show_guidance exactly once for the first visible target.',
  'Do not provide the full answer or all remaining steps upfront.',
].join('\n');

export const WALKTHROUGH_COMPLETION_INSTRUCTION = [
  'Trusted host walkthrough completion checkpoint: re-read the original request and tool-result history.',
  'If another visible step remains, continue with a fresh desktop observation followed by exactly one show_guidance call.',
  `Only when the interactive walkthrough is complete, return ${WALKTHROUGH_COMPLETION_PREFIX}<concise recap>.`,
].join('\n');
