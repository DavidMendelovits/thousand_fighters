import { TouchInput, type TouchAttackButton } from '../core/TouchInput';

export type TouchLayout = 'landscape' | 'portrait' | 'hidden';

type ButtonBinding = { kind: 'button'; name: TouchAttackButton; element: HTMLElement };
type DpadBinding = { kind: 'dpad'; element: HTMLElement };
type Binding = ButtonBinding | DpadBinding;

const ATTACK_BUTTONS: ReadonlyArray<{ name: TouchAttackButton; label: string; kind: 'punch' | 'kick' }> = [
  { name: 'jump', label: 'JUMP', kind: 'kick' },
  { name: 'dash', label: 'DASH', kind: 'kick' },
  { name: 'grab', label: 'GRAB', kind: 'kick' },
  { name: 'lp', label: 'PUNCH', kind: 'punch' },
  { name: 'lk', label: 'KICK', kind: 'punch' },
  { name: 'hp', label: 'SPECIAL', kind: 'punch' },
];

const DPAD_NUB_TRAVEL = 0.7;
const DPAD_DEADZONE_FRACTION = 0.18;

export class TouchControls {
  private root: HTMLElement;
  private dpadRing!: HTMLElement;
  private dpadNub!: HTMLElement;
  private attacksRoot!: HTMLElement;
  private pauseButton!: HTMLButtonElement;
  private bindings = new Map<number, Binding>();
  private onPause: (paused?: boolean) => boolean = () => false;

  constructor(host: HTMLElement) {
    this.root = host;
    this.root.classList.add('tf-controls');
    this.root.dataset.layout = 'hidden';
    this.build();
    this.attachListeners();
    this.buildSettings();
  }

  setPauseHandler(handler: (paused?: boolean) => boolean): void {
    this.onPause = handler;
  }

  setLayout(layout: TouchLayout): void {
    this.root.dataset.layout = layout;
    if (layout === 'hidden') {
      this.releaseAll();
      TouchInput.clearAll();
    }
  }

  releaseAll(): void {
    for (const [pointerId, binding] of this.bindings) {
      try {
        binding.element.releasePointerCapture(pointerId);
      } catch {
        // pointer may already be released
      }
      binding.element.classList.remove('is-pressed');
    }
    this.bindings.clear();
    this.resetNub();
    TouchInput.clearAll();
  }

  private build(): void {
    const pauseWrap = document.createElement('div');
    pauseWrap.className = 'tf-controls-pause';
    this.pauseButton = document.createElement('button');
    this.pauseButton.type = 'button';
    this.pauseButton.className = 'tf-pause-btn';
    this.pauseButton.setAttribute('aria-label', 'Pause');
    this.pauseButton.textContent = 'II';
    pauseWrap.appendChild(this.pauseButton);

    const dpadWrap = document.createElement('div');
    dpadWrap.className = 'tf-controls-dpad';
    this.dpadRing = document.createElement('div');
    this.dpadRing.className = 'tf-dpad-ring';
    this.dpadRing.setAttribute('role', 'application');
    this.dpadRing.setAttribute('aria-label', 'Movement pad');
    this.dpadNub = document.createElement('div');
    this.dpadNub.className = 'tf-dpad-nub';
    this.dpadRing.appendChild(this.dpadNub);
    const guide = document.createElement('span');
    guide.className = 'tf-pad-guide';
    guide.textContent = 'MOVE · AWAY TO GUARD';
    dpadWrap.appendChild(guide);
    dpadWrap.appendChild(this.dpadRing);

    const attacksWrap = document.createElement('div');
    attacksWrap.className = 'tf-controls-attacks';
    this.attacksRoot = attacksWrap;
    for (const def of ATTACK_BUTTONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tf-attack-btn tf-attack-${def.kind}`;
      btn.dataset.button = def.name;
      btn.setAttribute('aria-label', def.label);
      btn.textContent = def.label;
      attacksWrap.appendChild(btn);
    }

    this.root.replaceChildren(pauseWrap, dpadWrap, attacksWrap);
    const utility = document.createElement('div');
    utility.className = 'tf-touch-utility';
    for (const [name, label] of [['power', 'BOOST'], ['transform', 'FORM']] as const) {
      const button = document.createElement('button');
      button.textContent = label;
      button.setAttribute('aria-label', label);
      button.className = 'tf-utility-btn';
      button.dataset.button = name;
      button.addEventListener('pointerdown', e => this.onButtonDown(e, button, name));
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, e => this.onPointerEnd(e as PointerEvent, button));
      }
      utility.append(button);
    }
    this.root.append(utility);
  }

  private attachListeners(): void {
    this.pauseButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.onPause();
    });

    for (const btn of Array.from(this.attacksRoot.querySelectorAll<HTMLElement>('button[data-button]'))) {
      const name = btn.dataset.button as TouchAttackButton;
      btn.addEventListener('pointerdown', (event) => this.onButtonDown(event, btn, name));
      btn.addEventListener('pointerup', (event) => this.onPointerEnd(event, btn));
      btn.addEventListener('pointercancel', (event) => this.onPointerEnd(event, btn));
      btn.addEventListener('lostpointercapture', (event) => this.onPointerEnd(event, btn));
    }

    this.dpadRing.addEventListener('pointerdown', (event) => this.onDpadDown(event));
    this.dpadRing.addEventListener('pointermove', (event) => this.onDpadMove(event));
    this.dpadRing.addEventListener('pointerup', (event) => this.onDpadEnd(event));
    this.dpadRing.addEventListener('pointercancel', (event) => this.onDpadEnd(event));
    this.dpadRing.addEventListener('lostpointercapture', (event) => this.onDpadEnd(event));
  }

  private onButtonDown(event: PointerEvent, element: HTMLElement, name: TouchAttackButton): void {
    event.preventDefault();
    if (this.bindings.has(event.pointerId)) return;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    this.bindings.set(event.pointerId, { kind: 'button', name, element });
    element.classList.add('is-pressed');
    TouchInput.setButton(name, true);
  }

  private onPointerEnd(event: PointerEvent, element: HTMLElement): void {
    const binding = this.bindings.get(event.pointerId);
    if (!binding) return;
    if (binding.kind !== 'button' || binding.element !== element) return;
    this.bindings.delete(event.pointerId);
    // A second finger on one action must not release the first finger's hold.
    if (![...this.bindings.values()].some(b => b.kind === 'button' && b.name === binding.name)) {
      element.classList.remove('is-pressed');
      TouchInput.setButton(binding.name, false);
    }
    try {
      element.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  private onDpadDown(event: PointerEvent): void {
    event.preventDefault();
    if (this.bindings.has(event.pointerId)) return;
    if ([...this.bindings.values()].some(binding => binding.kind === 'dpad')) return;
    try {
      this.dpadRing.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    this.bindings.set(event.pointerId, { kind: 'dpad', element: this.dpadRing });
    this.dpadRing.classList.add('is-pressed');
    this.updateDpadFromEvent(event);
  }

  private onDpadMove(event: PointerEvent): void {
    const binding = this.bindings.get(event.pointerId);
    if (!binding || binding.kind !== 'dpad') return;
    this.updateDpadFromEvent(event);
  }

  private onDpadEnd(event: PointerEvent): void {
    const binding = this.bindings.get(event.pointerId);
    if (!binding || binding.kind !== 'dpad') return;
    this.bindings.delete(event.pointerId);
    this.dpadRing.classList.remove('is-pressed');
    this.resetNub();
    TouchInput.setDirection(null);
    try {
      this.dpadRing.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  private updateDpadFromEvent(event: PointerEvent): void {
    const rect = this.dpadRing.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const radius = Math.min(rect.width, rect.height) / 2;
    const distance = Math.hypot(dx, dy);

    if (distance < radius * DPAD_DEADZONE_FRACTION) {
      this.dpadNub.style.transform = 'translate(-50%, -50%)';
      TouchInput.setDirection(null);
      return;
    }

    const clampedDistance = Math.min(distance, radius * DPAD_NUB_TRAVEL);
    const offsetX = (dx / distance) * clampedDistance;
    const offsetY = (dy / distance) * clampedDistance;
    this.dpadNub.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;

    const angle = Math.atan2(dy, dx);
    TouchInput.setDirection(angle);
  }

  private resetNub(): void {
    this.dpadNub.style.transform = 'translate(-50%, -50%)';
  }

  private buildSettings(): void {
    const settings = document.createElement('button');
    settings.className = 'tf-settings-btn';
    settings.textContent = 'CONTROLS';
    settings.setAttribute('aria-label', 'Control settings');
    this.root.querySelector('.tf-controls-pause')!.prepend(settings);
    const dialog = document.createElement('dialog');
    dialog.className = 'tf-control-settings';
    dialog.innerHTML = `<h2>YOUR THUMBS. YOUR RULES.</h2>
      <p>Move with the pad. Hold away to guard. Tap attacks to chain moves after a hit.</p>
      <p>Down + Kick: launcher. Direction + Special: alternate attacks.<br>Jump, then Down + Dash: air dodge into wavedash.<br>Boost and Form spend meter; they are not free attacks.</p>
      <label>Layout <select name="hand" aria-label="Layout"><option value="right">Movement left / attacks right</option><option value="left">Movement right / attacks left</option></select></label>
      <label>Button size <select name="size" aria-label="Button size"><option value="regular">Regular</option><option value="large">Large</option></select></label>
      <label>Contrast <select name="contrast" aria-label="Contrast"><option value="normal">Normal</option><option value="high">High contrast</option></select></label>
      <button class="tf-settings-done">SAVE & RETURN</button>`;
    this.root.append(dialog);
    const apply = () => {
      for (const key of ['hand', 'size', 'contrast']) {
        const select = dialog.querySelector<HTMLSelectElement>(`[name="${key}"]`)!;
        this.root.dataset[key] = select.value;
        try { localStorage.setItem(`tf.controls.${key}`, select.value); } catch { /* private mode */ }
      }
    };
    for (const select of dialog.querySelectorAll('select')) {
      try { const saved = localStorage.getItem(`tf.controls.${select.name}`); if (saved && [...select.options].some(o => o.value === saved)) select.value = saved; } catch { /* private mode */ }
      select.addEventListener('change', apply);
    }
    apply();
    let wasPaused = false;
    settings.addEventListener('click', () => {
      this.releaseAll();
      wasPaused = this.onPause(true);
      dialog.showModal();
    });
    dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { this.releaseAll(); this.onPause(wasPaused); });
  }
}
