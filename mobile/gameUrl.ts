export function gameOrigin(configured: string | undefined, development: boolean, hostUri?: string | null): string | null {
  try {
    const fallback = development && hostUri ? `http://${new URL(`http://${hostUri}`).hostname}:5174` : null;
    const value = configured || fallback;
    if (!value) return null;
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(development && url.protocol === 'http:')) return null;
    if (!development && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export function fightUrl(origin: string, player: string, opponent: string): string {
  const url = new URL('/fight.html', origin);
  url.search = new URLSearchParams({ p1: player, p2: opponent, cpu: 'on', touch: '1' }).toString();
  return url.href;
}

export function allowGameNavigation(target: string, origin: string): boolean {
  try { const url = new URL(target); return url.origin === origin && url.pathname === '/fight.html'; }
  catch { return false; }
}
