import type { CuaStatus, SystemPermission } from '../../shared/contracts';

export interface ComputerPermissionCoordinatorOptions {
  connectIfPermitted(): Promise<CuaStatus>;
  getStatus(): Promise<CuaStatus>;
  openSystemPermissionSettings(permission: SystemPermission): Promise<void>;
}

/** Local OS-permission helper. It does not persist or authorize agent actions. */
export class ComputerPermissionCoordinator {
  constructor(private readonly options: ComputerPermissionCoordinatorOptions) {}

  async refresh(): Promise<void> {
    const status = await this.options.getStatus();
    if (status.state === 'disconnected') await this.options.connectIfPermitted();
  }

  async openSettings(taskId: string): Promise<void> {
    void taskId;
    const status = await this.options.getStatus();
    const missing: SystemPermission[] = [];
    if (!status.permissions?.accessibility) missing.push('accessibility');
    if (!status.permissions?.screenRecording) missing.push('screen_recording');
    for (const permission of missing) await this.options.openSystemPermissionSettings(permission);
  }

  async continueWithout(taskId: string): Promise<void> {
    void taskId;
    // The task remains live, but computer tools fail closed until OS access exists.
  }

  dispose(): void {}
}
