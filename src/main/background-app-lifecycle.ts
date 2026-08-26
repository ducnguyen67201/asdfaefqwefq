interface WindowCloseEvent {
  preventDefault(): void;
}

interface BackgroundVoiceWindow {
  hide(): void;
  minimize(): void;
  on(
    event: 'close',
    listener: (event: WindowCloseEvent) => void,
  ): unknown;
  removeListener(
    event: 'close',
    listener: (event: WindowCloseEvent) => void,
  ): unknown;
}

interface BackgroundVoiceLifecycleOptions {
  isShuttingDown(): boolean;
  platform: NodeJS.Platform;
}

interface MacOSDock {
  setIcon(iconPath: string): void;
  show(): Promise<void>;
}

interface BackgroundApp {
  dock?: MacOSDock;
  setActivationPolicy(policy: 'regular'): void;
}

interface BackgroundTray<TMenu> {
  on(event: 'click' | 'right-click', listener: () => void): unknown;
  popUpContextMenu(menu: TMenu): void;
  setContextMenu(menu: TMenu): void;
}

interface BackgroundTrayActivationOptions {
  platform: NodeJS.Platform;
  reveal(): void;
}

/**
 * Keep the renderer that owns microphone capture alive when the user closes
 * the main window. A real application shutdown is still allowed through.
 */
export function keepWindowAliveForBackgroundVoice(
  window: BackgroundVoiceWindow,
  { isShuttingDown, platform }: BackgroundVoiceLifecycleOptions,
): () => void {
  const handleClose = (event: WindowCloseEvent): void => {
    if (isShuttingDown()) return;

    event.preventDefault();
    if (platform === 'win32') {
      window.minimize();
      return;
    }
    window.hide();
  };

  window.on('close', handleClose);
  return () => window.removeListener('close', handleClose);
}

/** Keep a menu-bar app available from the Dock and Command-Tab on macOS. */
export async function configureMacOSDock(
  app: BackgroundApp,
  platform: NodeJS.Platform,
  iconPath: string,
): Promise<void> {
  if (platform !== 'darwin' || !app.dock) return;

  app.setActivationPolicy('regular');
  app.dock.setIcon(iconPath);
  await app.dock.show();
}

/**
 * A primary tray click restores the app. Secondary click retains access to
 * background actions. Linux trays keep their native context-menu behavior
 * because click events vary between desktop environments.
 */
export function registerBackgroundTrayActivation<TMenu>(
  tray: BackgroundTray<TMenu>,
  menu: TMenu,
  { platform, reveal }: BackgroundTrayActivationOptions,
): void {
  if (platform === 'linux') {
    tray.setContextMenu(menu);
    return;
  }

  tray.on('click', reveal);
  tray.on('right-click', () => tray.popUpContextMenu(menu));
}
