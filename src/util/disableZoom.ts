/**
 * Disables every form of browser zoom on the game page.
 *
 * The viewport `<meta>` tag already requests `user-scalable=no`, but modern
 * iOS Safari ignores it, and it has no effect on desktop ctrl+wheel / keyboard
 * zoom. This installs the event handlers needed to cover the remaining cases:
 *
 *   - iOS Safari pinch zoom        (gesturestart / gesturechange / gestureend)
 *   - Pinch zoom via touch / wheel (touchmove with 2+ touches, ctrl+wheel)
 *   - Double-tap to zoom           (rapid successive touchend events)
 *   - Desktop keyboard zoom        (ctrl/cmd + '+' / '-' / '0' / '=')
 *
 * Listeners are registered as non-passive so `preventDefault()` is honored.
 */
export function disableZoom(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const prevent = (event: Event): void => {
    event.preventDefault();
  };

  // iOS Safari pinch-to-zoom gestures.
  document.addEventListener('gesturestart', prevent, { passive: false });
  document.addEventListener('gesturechange', prevent, { passive: false });
  document.addEventListener('gestureend', prevent, { passive: false });

  // Multi-touch pinch zoom (non-Safari touch browsers).
  document.addEventListener(
    'touchmove',
    (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false }
  );

  // Double-tap to zoom: swallow the second tap if it lands quickly.
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) event.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
  );

  // Desktop ctrl/cmd + wheel zoom.
  document.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    },
    { passive: false }
  );

  // Desktop ctrl/cmd + (+ / - / = / 0) keyboard zoom.
  document.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) {
        event.preventDefault();
      }
    },
    { passive: false }
  );
}
