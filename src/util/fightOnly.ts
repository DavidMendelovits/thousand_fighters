export function isFightOnly(): boolean {
  return ['/fight', '/fight.html'].includes(window.location.pathname.replace(/\/$/, ''));
}
