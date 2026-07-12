import type Phaser from 'phaser';

export type DebugCategory = 'hurtboxes' | 'hitboxes' | 'projectileBoxes' | 'readout';

export const DEBUG_COLORS = {
  P1: { hurtbox: { fill: 0x3498ff, stroke: 0x74b9ff }, hitbox: { fill: 0xff3b30, stroke: 0xff6b5f } },
  P2: { hurtbox: { fill: 0x00d4aa, stroke: 0x4dffc3 }, hitbox: { fill: 0xff9500, stroke: 0xffb340 } },
  projectile: { fill: 0x3dff7a, stroke: 0x63ff94 },
} as const;

const ALL_CATEGORIES: DebugCategory[] = ['hurtboxes', 'hitboxes', 'projectileBoxes', 'readout'];
const ACTOR_KEYS = ['P1', 'P2'] as const;
type ActorKey = (typeof ACTOR_KEYS)[number];

function defaultCategoryToggles(): Record<DebugCategory, boolean> {
  return { hurtboxes: true, hitboxes: true, projectileBoxes: true, readout: true };
}

export class DebugPanel {
  private static _instance: DebugPanel | null = null;

  private enabled: boolean = true;
  private panelVisible: boolean = false;
  private globalToggles: Record<DebugCategory, boolean>;
  private actorToggles: Map<string, Record<DebugCategory, boolean>>;
  private container: HTMLDivElement | null = null;

  private constructor() {
    this.globalToggles = defaultCategoryToggles();
    this.actorToggles = new Map();
    for (const key of ACTOR_KEYS) {
      this.actorToggles.set(key, defaultCategoryToggles());
    }
  }

  static create(_scene: Phaser.Scene): DebugPanel {
    if (DebugPanel._instance) {
      DebugPanel._instance.destroy();
    }
    DebugPanel._instance = new DebugPanel();
    return DebugPanel._instance;
  }

  static current(): DebugPanel | null {
    return DebugPanel._instance;
  }

  /** F1: master enable/disable all debug rendering */
  toggle(): void {
    this.enabled = !this.enabled;
  }

  /** F3: show/hide the checkbox panel */
  togglePanel(): void {
    this.panelVisible = !this.panelVisible;
    if (this.panelVisible) {
      this.mountPanel();
    } else {
      this.unmountPanel();
    }
  }

  isEnabled(category: DebugCategory, actorKey?: string): boolean {
    if (!this.enabled) return false;
    if (!this.globalToggles[category]) return false;
    if (actorKey) {
      const actor = this.actorToggles.get(actorKey);
      return actor ? actor[category] : true;
    }
    return true;
  }

  isGlobalEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    this.unmountPanel();
    DebugPanel._instance = null;
  }

  // -------------------------------------------------------------------------
  // HTML Panel
  // -------------------------------------------------------------------------

  private mountPanel(): void {
    if (this.container) return;

    const div = document.createElement('div');
    div.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:8px',
      'z-index:9999',
      'background:rgba(10,14,22,0.88)',
      'border:1px solid rgba(160,180,220,0.25)',
      'border-radius:6px',
      'padding:10px 14px 12px',
      'font-family:monospace',
      'font-size:11px',
      'color:#dbe7ff',
      'min-width:180px',
      'user-select:none',
    ].join(';');

    // Title row
    const title = document.createElement('div');
    title.textContent = 'Debug Panel  [F3 to close]';
    title.style.cssText = 'font-size:12px;font-weight:bold;margin-bottom:8px;color:#a0b4dc;border-bottom:1px solid rgba(160,180,220,0.2);padding-bottom:5px';
    div.appendChild(title);

    // Global section
    const globalSection = this.buildSection('Global', ALL_CATEGORIES, null);
    div.appendChild(globalSection);

    // Per-actor sections
    for (const actorKey of ACTOR_KEYS) {
      // Projectile boxes and readout aren't per-actor concepts — show only
      // hurtboxes and hitboxes for per-actor rows.
      const actorCategories: DebugCategory[] = ['hurtboxes', 'hitboxes'];
      const section = this.buildSection(actorKey, actorCategories, actorKey);
      div.appendChild(section);
    }

    document.body.appendChild(div);
    this.container = div;
  }

  private buildSection(label: string, categories: DebugCategory[], actorKey: ActorKey | null): HTMLDivElement {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:8px';

    const heading = document.createElement('div');
    heading.textContent = label;
    heading.style.cssText = 'color:#7fa8e0;margin-bottom:3px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em';
    section.appendChild(heading);

    for (const category of categories) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:1px 0';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.style.cssText = 'cursor:pointer;accent-color:#3498ff';

      const currentValue = actorKey
        ? (this.actorToggles.get(actorKey)?.[category] ?? true)
        : this.globalToggles[category];
      cb.checked = currentValue;

      cb.addEventListener('change', () => {
        if (actorKey) {
          const toggles = this.actorToggles.get(actorKey);
          if (toggles) toggles[category] = cb.checked;
        } else {
          this.globalToggles[category] = cb.checked;
        }
      });

      const span = document.createElement('span');
      span.textContent = category;
      span.style.cssText = 'color:#c8d8f0';

      row.appendChild(cb);
      row.appendChild(span);
      section.appendChild(row);
    }

    return section;
  }

  private unmountPanel(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}
