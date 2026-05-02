import { TouchInput } from '../core/TouchInput';
import { currentOrientation, prefersTouchControls, type Orientation } from '../util/device';
import { TouchControls, type TouchLayout } from './TouchControls';

export const CANVAS_PARENT_ID = 'game-canvas-wrap';
const CONTROLS_HOST_ID = 'game-controls';
const ROOT_ID = 'game';

export type LayoutChange = {
  orientation: Orientation;
  touchEnabled: boolean;
  layout: TouchLayout;
};

export class LayoutShell {
  private static singleton: LayoutShell | null = null;

  static current(): LayoutShell | null {
    return LayoutShell.singleton;
  }

  readonly canvasParent: HTMLElement;
  readonly controlsHost: HTMLElement;
  readonly controls: TouchControls;
  private currentLayout: TouchLayout = 'hidden';
  private currentOrient: Orientation = currentOrientation();
  private listeners = new Set<(change: LayoutChange) => void>();

  constructor() {
    LayoutShell.singleton = this;
    const root = document.getElementById(ROOT_ID);
    if (!root) {
      throw new Error(`LayoutShell: missing #${ROOT_ID} element in document`);
    }
    root.replaceChildren();

    this.canvasParent = document.createElement('div');
    this.canvasParent.id = CANVAS_PARENT_ID;
    this.canvasParent.className = 'tf-canvas-wrap';

    this.controlsHost = document.createElement('div');
    this.controlsHost.id = CONTROLS_HOST_ID;

    root.appendChild(this.canvasParent);
    root.appendChild(this.controlsHost);

    this.controls = new TouchControls(this.controlsHost);

    this.applyLayout();
    this.attachWindowListeners();
  }

  onChange(listener: (change: LayoutChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  refresh(): void {
    this.applyLayout();
  }

  private attachWindowListeners(): void {
    const handler = () => this.applyLayout();
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    if (typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(orientation: portrait)');
      // Safari < 14 only supports addListener.
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', handler);
      } else if (typeof (mq as MediaQueryList & { addListener?: (cb: () => void) => void }).addListener === 'function') {
        (mq as MediaQueryList & { addListener: (cb: () => void) => void }).addListener(handler);
      }
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.controls.releaseAll();
        TouchInput.clearAll();
      }
    });
    window.addEventListener('blur', () => {
      this.controls.releaseAll();
      TouchInput.clearAll();
    });
  }

  private applyLayout(): void {
    const touchEnabled = prefersTouchControls();
    const orientation = currentOrientation();
    const layout: TouchLayout = touchEnabled ? orientation : 'hidden';

    const orientChanged = orientation !== this.currentOrient;
    const layoutChanged = layout !== this.currentLayout;

    document.documentElement.dataset.orientation = orientation;
    document.documentElement.dataset.touch = touchEnabled ? '1' : '0';

    if (layoutChanged) {
      this.controls.setLayout(layout);
      this.currentLayout = layout;
    }

    if (orientChanged) {
      // Drop captured pointers / clear stuck inputs across an orientation flip.
      this.controls.releaseAll();
      TouchInput.clearAll();
      this.currentOrient = orientation;
    }

    if (orientChanged || layoutChanged) {
      const change: LayoutChange = { orientation, touchEnabled, layout };
      for (const listener of this.listeners) listener(change);
    }
  }
}
