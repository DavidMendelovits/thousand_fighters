const TOUCH_PREF_KEY = 'thousand_fighters.touchControls';

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  );
}

function urlOverride(): boolean | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get('touch');
  if (value === '1' || value === 'on') return true;
  if (value === '0' || value === 'off') return false;
  return null;
}

function storedPreference(): boolean | null {
  try {
    const value = window.localStorage.getItem(TOUCH_PREF_KEY);
    if (value === '1') return true;
    if (value === '0') return false;
  } catch {
    // localStorage may be blocked in private mode; ignore.
  }
  return null;
}

export function setTouchControlsPreference(enabled: boolean | null): void {
  try {
    if (enabled === null) window.localStorage.removeItem(TOUCH_PREF_KEY);
    else window.localStorage.setItem(TOUCH_PREF_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
}

export function prefersTouchControls(): boolean {
  const override = urlOverride();
  if (override !== null) return override;
  const stored = storedPreference();
  if (stored !== null) return stored;
  if (!isTouchDevice()) return false;
  const coarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const narrowViewport = typeof window !== 'undefined' && window.innerWidth < 1100;
  return coarsePointer || narrowViewport;
}

export type Orientation = 'portrait' | 'landscape';

export function currentOrientation(): Orientation {
  if (typeof window === 'undefined') return 'landscape';
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
  }
  return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
}
