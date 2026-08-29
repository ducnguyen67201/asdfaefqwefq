import type { Point, Rectangle } from './companion-position';

export const COMPANION_HOVER_INTERVAL_MS = 100;
export const COMPANION_HOVER_INSET = 8;

export function supportsCompanionHover(
  platform: NodeJS.Platform | string,
  sessionType: string | undefined,
): boolean {
  return !(
    platform === 'linux' && sessionType?.trim().toLowerCase() === 'wayland'
  );
}

export function pointInRectangle(
  point: Point,
  rectangle: Rectangle,
): boolean {
  return (
    point.x >= rectangle.x &&
    point.y >= rectangle.y &&
    point.x < rectangle.x + rectangle.width &&
    point.y < rectangle.y + rectangle.height
  );
}

export function insetRectangle(
  rectangle: Rectangle,
  inset = COMPANION_HOVER_INSET,
): Rectangle {
  const safeInset = Math.max(
    0,
    Math.min(inset, rectangle.width / 2, rectangle.height / 2),
  );
  return {
    x: rectangle.x + safeInset,
    y: rectangle.y + safeInset,
    width: Math.max(0, rectangle.width - safeInset * 2),
    height: Math.max(0, rectangle.height - safeInset * 2),
  };
}

interface CompanionHoverTrackerDependencies {
  clearInterval?: typeof clearInterval;
  getCompanionBounds(): Rectangle | null;
  getCursorPoint(): Point;
  intervalMs?: number;
  isEligible(): boolean;
  onEnter(): void;
  onLeave(): void;
  platform: NodeJS.Platform | string;
  publish(hovered: boolean): void;
  sessionType?: string;
  setInterval?: typeof setInterval;
}

export class CompanionHoverTracker {
  private readonly clearInterval: typeof clearInterval;

  private readonly setInterval: typeof setInterval;

  private readonly intervalMs: number;

  private timer: ReturnType<typeof setInterval> | null = null;

  private started = false;

  private hovered = false;

  private published: boolean | null = null;

  constructor(private readonly dependencies: CompanionHoverTrackerDependencies) {
    this.clearInterval = dependencies.clearInterval ?? clearInterval;
    this.setInterval = dependencies.setInterval ?? setInterval;
    this.intervalMs = dependencies.intervalMs ?? COMPANION_HOVER_INTERVAL_MS;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.publish(false);
    this.synchronizeEligibility();
  }

  synchronizeEligibility(): void {
    const supported = supportsCompanionHover(
      this.dependencies.platform,
      this.dependencies.sessionType,
    );
    if (!this.started || !supported || !this.safeEligible()) {
      this.stopTimer();
      this.setHovered(false);
      return;
    }
    if (this.timer) return;
    this.sample();
    this.timer = this.setInterval(() => this.sample(), this.intervalMs);
  }

  stop(): void {
    if (!this.started && !this.timer && this.published === false) return;
    this.started = false;
    this.stopTimer();
    this.setHovered(false);
    this.publish(false);
  }

  private safeEligible(): boolean {
    try {
      return this.dependencies.isEligible();
    } catch {
      return false;
    }
  }

  private sample(): void {
    if (!this.started || !this.safeEligible()) {
      this.synchronizeEligibility();
      return;
    }

    let hovered = false;
    try {
      const bounds = this.dependencies.getCompanionBounds();
      hovered = Boolean(
        bounds &&
          pointInRectangle(
            this.dependencies.getCursorPoint(),
            insetRectangle(bounds),
          ),
      );
    } catch {
      hovered = false;
    }
    this.setHovered(hovered);
  }

  private setHovered(hovered: boolean): void {
    if (hovered === this.hovered) {
      this.publish(hovered);
      return;
    }
    this.hovered = hovered;
    if (hovered) this.dependencies.onEnter();
    else this.dependencies.onLeave();
    this.publish(hovered);
  }

  private publish(hovered: boolean): void {
    if (this.published === hovered) return;
    this.published = hovered;
    this.dependencies.publish(hovered);
  }

  private stopTimer(): void {
    if (this.timer) this.clearInterval(this.timer);
    this.timer = null;
  }
}
