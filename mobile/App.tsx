import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useKeepAwake } from 'expo-keep-awake';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { allowGameNavigation, fightUrl, gameOrigin } from './gameUrl';
import { analytics, captureEvent } from './analytics';

type Fighter = { id: string; name: string; portrait?: string };
const origin = gameOrigin(process.env.EXPO_PUBLIC_GAME_URL, __DEV__, Constants.expoConfig?.hostUri);
const activeFighterIds = new Set((process.env.EXPO_PUBLIC_ACTIVE_FIGHTER_IDS ?? '').split(',').map((id: string) => id.trim()).filter(Boolean));
const suspendScript = `window.dispatchEvent(new Event('tf:suspend')); true;`;

function Button({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, disabled && { opacity: .4 }, pressed && { opacity: .7 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

function FightApp() {
  useKeepAwake();
  const [fighters, setFighters] = useState<Fighter[]>([]);
  const [player, setPlayer] = useState('brine');
  const [opponent, setOpponent] = useState('meridian');
  const [selecting, setSelecting] = useState<'player' | 'opponent'>('player');
  const [inFight, setInFight] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const web = useRef<WebView>(null);
  const processRecoveryAttempts = useRef(0);

  useEffect(() => {
    if (!origin) return;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 20000);
    setError(null);
    captureEvent('fighter roster loading', { game_origin: origin });
    (async () => {
      const index = await fetch(`${origin}/assets-index.json`, { signal: abort.signal });
      if (!index.ok) throw new Error('Published roster is unavailable.');
      const entries = Object.entries((await index.json()).fighters ?? {}).filter(([, item]) => (item as { config?: unknown })?.config);
      const configs = await Promise.all(entries.map(async ([id]) => {
        if (!/^[a-z0-9_-]+$/i.test(id)) return null;
        const response = await fetch(`${origin}/fighters/${id}/config.json`, { signal: abort.signal });
        if (!response.ok) throw new Error(`Could not load fighter ${id}.`);
        return response.json();
      }));
      const roster: Fighter[] = configs.filter(c => c && c.rosterGroup === 'oddities' && c.selectable !== false && !c.parentId && (!activeFighterIds.size || activeFighterIds.has(c.id))).map(c => {
        const file = c.sprite?.frames?.base?.[0]?.file;
        const portrait = file ? new URL(`${c.sprite.basePath}/${file}`, origin).href : undefined;
        return { id: c.id, name: c.displayName, portrait: portrait && new URL(portrait).origin === origin ? portrait : undefined };
      });
      if (!roster.length) throw new Error('No published fighters are available.');
      if (abort.signal.aborted) return;
      setFighters(roster);
      captureEvent('fighter roster loaded', { fighter_count: roster.length, fighter_ids: roster.map(f => f.id) });
      setPlayer(current => roster.some(f => f.id === current) ? current : roster[0].id);
      setOpponent(current => roster.some(f => f.id === current) ? current : roster[Math.min(1, roster.length - 1)].id);
    })().catch(e => { if (!abort.signal.aborted) { setError(e.message); captureEvent('fighter roster failed', { message: e.message }); } else if (abort.signal.reason?.name === 'AbortError') setError('Loading timed out. Check the game server and retry.'); })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); abort.abort('unmounted'); };
  }, [reload]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') web.current?.injectJavaScript(suspendScript);
      captureEvent('mobile app state changed', { state });
    });
    return () => subscription.remove();
  }, []);

  const leave = () => {
    web.current?.injectJavaScript(suspendScript);
    Alert.alert('Leave this fight?', 'The current match will end.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => { setInFight(false); setReady(false); setError(null); } },
    ]);
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { if (!inFight) return false; leave(); return true; });
    return () => subscription.remove();
  }, [inFight]);
  useEffect(() => {
    if (!inFight || ready) return;
    const timer = setTimeout(() => setError('The arena did not finish loading. Check your connection and retry.'), 45000);
    return () => clearTimeout(timer);
  }, [inFight, ready, reload]);

  if (!origin) return <View style={styles.center}><Text style={styles.title}>GAME SERVER REQUIRED</Text><Text style={styles.copy}>Set EXPO_PUBLIC_GAME_URL to the HTTPS origin hosting the fight client. Development can use the Metro host on port 5174.</Text></View>;

  if (inFight) return <View style={styles.root}>
    <View style={styles.fightBar}><Button label="LEAVE FIGHT" onPress={leave} /><Text style={styles.kicker}>THOUSAND FIGHTERS / VS CPU</Text></View>
    <WebView key={reload} ref={web} source={{ uri: fightUrl(origin, player, opponent) }} style={styles.web}
      originWhitelist={[origin]} onShouldStartLoadWithRequest={request => allowGameNavigation(request.url, origin)}
      javaScriptEnabled domStorageEnabled scrollEnabled={false} bounces={false} overScrollMode="never"
      allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} setSupportMultipleWindows={false}
      mixedContentMode="never" allowFileAccess={false} webviewDebuggingEnabled={__DEV__}
      onMessage={event => { try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message.type === 'fight-ready') { processRecoveryAttempts.current = 0; captureEvent('fight ready', { player, opponent }); setReady(true); setError(null); }
        if (message.type === 'select-fighter') { setInFight(false); setReady(false); setError(null); }
      } catch { /* unknown message */ } }}
      onError={event => { captureEvent('fight webview failed', { player, opponent, description: event.nativeEvent.description }); setError('Could not reach the arena. Check your connection.'); }}
      onHttpError={event => { if (event.nativeEvent.url.includes('/fight.html')) { captureEvent('fight http failed', { player, opponent, status_code: event.nativeEvent.statusCode }); setError(`Arena returned HTTP ${event.nativeEvent.statusCode}.`); } }}
      onContentProcessDidTerminate={() => {
        const attempt = ++processRecoveryAttempts.current;
        captureEvent('fight process terminated', { player, opponent, recovery_attempt: attempt });
        void analytics?.flush();
        setReady(false);
        if (attempt <= 2) {
          setError(`The arena ran out of memory. Recovering (${attempt}/2)…`);
          setTimeout(() => { setError(null); setReload(value => value + 1); }, 750);
        } else {
          setError('The arena stopped repeatedly. Return to fighter select and try again.');
        }
      }} />
    {(!ready || error) && <View style={styles.loading}><ActivityIndicator color="#d2e8a7" /><Text style={styles.copy}>{error ?? 'Loading fighters and arena…'}</Text>
      {error && <Button label="RETRY FIGHT" onPress={() => { processRecoveryAttempts.current = 0; captureEvent('fight retried', { player, opponent }); setError(null); setReady(false); setReload(v => v + 1); }} />}</View>}
  </View>;

  return <View style={styles.root}>
    <View style={styles.heading}><View><Text style={styles.kicker}>POCKET ARENA / LOCAL VS CPU</Text><Text style={styles.title}>CHOOSE YOUR ODDITY</Text></View>
      <Button label="FIGHT" disabled={!fighters.length || Boolean(error)} onPress={() => { processRecoveryAttempts.current = 0; captureEvent('fight started', { player, opponent }); setReady(false); setError(null); setInFight(true); }} /></View>
    <View style={styles.selectors}>
      <Button label={`YOU: ${fighters.find(f => f.id === player)?.name ?? '…'}`} onPress={() => setSelecting('player')} />
      <Text style={styles.vs}>VS</Text>
      <Button label={`CPU: ${fighters.find(f => f.id === opponent)?.name ?? '…'}`} onPress={() => setSelecting('opponent')} />
      <Text style={styles.copy}>Selecting {selecting === 'player' ? 'your fighter' : 'opponent'}</Text>
    </View>
    {error ? <View style={styles.center}><Text style={styles.copy}>{error}</Text><Button label="RETRY ROSTER" onPress={() => setReload(v => v + 1)} /></View> :
      !fighters.length ? <View style={styles.center}><ActivityIndicator color="#d2e8a7" /><Text style={styles.copy}>Loading published roster…</Text></View> :
      <ScrollView horizontal contentContainerStyle={styles.cards} showsHorizontalScrollIndicator>
        {fighters.map(f => <Pressable key={f.id} accessibilityRole="button" accessibilityLabel={`Select ${f.name}`} accessibilityState={{ selected: f.id === (selecting === 'player' ? player : opponent) }}
          onPress={() => selecting === 'player' ? setPlayer(f.id) : setOpponent(f.id)}
          style={[styles.card, f.id === (selecting === 'player' ? player : opponent) && styles.selected]}>
          {f.portrait && <Image source={{ uri: f.portrait }} style={styles.portrait} resizeMode="contain" />}
          <Text style={styles.cardName}>{f.name}</Text><Text style={styles.kicker}>{f.id === player ? 'YOU ' : ''}{f.id === opponent ? 'CPU' : ''}</Text>
        </Pressable>)}
      </ScrollView>}
    <Text style={styles.footer}>LEFT THUMB: MOVE + GUARD     RIGHT THUMB: ATTACK     Controls can be mirrored and resized in the arena.</Text>
  </View>;
}

export default function App() {
  return <SafeAreaProvider><StatusBar hidden /><SafeAreaView style={styles.root} edges={['left', 'right', 'top', 'bottom']}><FightApp /></SafeAreaView></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#10191d' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 12, gap: 16 },
  title: { fontSize: 24, fontWeight: '900', color: '#e7eee4', letterSpacing: 1 },
  kicker: { fontSize: 10, fontWeight: '700', color: '#9fbcba', letterSpacing: 1 },
  copy: { fontSize: 13, color: '#c1d3ce', flexShrink: 1, maxWidth: 560 },
  button: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: '#d2e8a7' },
  buttonText: { color: '#15252a', fontSize: 12, fontWeight: '900' },
  selectors: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingVertical: 12 },
  vs: { color: '#dd975e', fontSize: 16, fontWeight: '900' },
  cards: { gap: 12, paddingHorizontal: 24, paddingBottom: 8 },
  card: { width: 142, minHeight: 140, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1b2c31', borderColor: '#3d5457', borderWidth: 2, borderRadius: 12, padding: 8 },
  selected: { borderColor: '#d2e8a7', backgroundColor: '#294339' },
  portrait: { width: 112, height: 100 },
  cardName: { color: '#edf1e7', fontWeight: '700', fontSize: 12, textAlign: 'center' },
  footer: { color: '#9fbcba', fontSize: 10, paddingHorizontal: 24, paddingVertical: 10 },
  center: { flex: 1, padding: 24, gap: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: '#10191d' },
  fightBar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  web: { flex: 1, backgroundColor: '#10191d' },
  loading: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 44, backgroundColor: '#10191dee', alignItems: 'center', justifyContent: 'center', gap: 16 },
});
