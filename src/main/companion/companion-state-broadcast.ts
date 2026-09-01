import {
  CompanionStateSchema,
  type CompanionState,
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';

interface CompanionStateRecipient {
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, value: CompanionState): unknown;
  };
}

export function broadcastCompanionState(
  state: CompanionState,
  recipients: ReadonlyArray<CompanionStateRecipient | null>,
): void {
  const parsedState = CompanionStateSchema.parse(state);
  for (const recipient of recipients) {
    if (!recipient || recipient.isDestroyed()) continue;
    recipient.webContents.send(
      IPC_CHANNELS.companionStateChanged,
      parsedState,
    );
  }
}
