import Phaser from 'phaser';
import { loadTestbedConfig } from './runtimeConfig';
import { TestbedScene, type PlaybackMode, type DummyMode } from './TestbedScene';
import type {CharacterConfig} from '../schema/types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

function showStatus(message: string, isError = false): void {
  const status = $('status');
  status.textContent = message;
  status.style.display = 'flex';
  status.classList.toggle('error', isError);
}

function hideStatus(): void {
  $('status').style.display = 'none';
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const characterId = params.get('id');
  if (!characterId) {
    showStatus('No character id. Open as testbed.html?id=<characterId>', true);
    return;
  }

  showStatus(`Loading ${characterId}…`);

  let loaded;
  try {
    loaded = await loadTestbedConfig(characterId);
  } catch (error) {
    showStatus(
      `Failed to load "${characterId}": ${(error as Error).message}. Is the CMS admin server running (npm run cms:admin)?`,
      true,
    );
    return;
  }

  const { config, frameUrls, projectileUrls, warnings } = loaded;
  hideStatus();

  $('char-name').textContent = config.displayName;
  $('char-id').textContent = config.id;
  document.title = `Testbed · ${config.displayName}`;

  const scene = new TestbedScene({ config, frameUrls, projectileUrls });
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#141820',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 800,
      height: 450,
    },
    fps: { target: 60, forceSetTimeOut: false },
    scene,
  });

  buildMoveButtons(scene, config);
  wirePlayback(scene);
  wireDummy(scene);
  renderWarnings(warnings);
  startHudLoop(scene);
}

function buildMoveButtons(scene: TestbedScene, config: CharacterConfig): void {
  const container = $('moves');
  if (config.moves.length === 0) {
    container.innerHTML = '<span class="help">No moves in this draft.</span>';
    return;
  }
  const legend=document.createElement('p');legend.className='help move-legend';legend.textContent='J = jab (F) · K = kick (G) · S = special (H). Arrows are relative to facing. Buttons preview individual moves; enter strings using the keyboard. Timings: startup / active / recovery, in 60 Hz ticks.';container.appendChild(legend);
  const categories=[...new Set(config.moves.map(m=>m.category??'special'))];
  for(const category of categories){
  const heading=document.createElement('h3');heading.className='move-category';heading.textContent=category;container.appendChild(heading);
  for (const move of config.moves.filter(m=>(m.category??'special')===category)) {
    const button = document.createElement('button');
    button.className = 'move';
    const labels:Record<string,string>={lp:'J',lk:'K',hp:'S'};
    const command=move.inputLabel??move.trigger.sequence.map(t=>labels[t]??t).join(' + ');
    button.innerHTML = `${escapeHtml(move.displayName || move.id)}<br /><span class="anim">${escapeHtml(command)} · ${move.phases.map(p=>p.frames).join(' / ')}</span>${move.artStatus==='proxy'?'<br /><span class="proxy">Temporary art</span>':''}`;
    button.title = `Trigger ${move.id}`;
    button.addEventListener('click', () => {
      scene.triggerMove(move.id);
      ($('game').querySelector('canvas') as HTMLCanvasElement | null)?.focus();
    });
    container.appendChild(button);
  }
  }
  if(config.comboRoutes?.length){
    const heading=document.createElement('h3');heading.className='move-category';heading.textContent='Strings & hit-confirm routes';container.appendChild(heading);
    for(const route of config.comboRoutes){const row=document.createElement('div');row.className='combo-route';row.innerHTML=`<strong>${escapeHtml(route.name)}</strong><br /><span class="help">${escapeHtml(route.purpose)}</span>`;container.appendChild(row);}
  }
}

function wirePlayback(scene: TestbedScene): void {
  const group = $('playback');
  const modeButtons = group.querySelectorAll<HTMLButtonElement>('[data-mode]');
  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      scene.setMode(button.dataset.mode as PlaybackMode);
      modeButtons.forEach((b) => b.classList.toggle('active', b === button));
    });
  });
  $('step-btn').addEventListener('click', () => {
    scene.step();
    setActiveMode(modeButtons, 'pause');
  });
  $('reset-btn').addEventListener('click', () => scene.reset());
}

function wireDummy(scene: TestbedScene): void {
  const group = $('dummy-mode');
  const buttons = group.querySelectorAll<HTMLButtonElement>('[data-dummy]');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      scene.setDummyMode(button.dataset.dummy as DummyMode);
      buttons.forEach((b) => b.classList.toggle('active', b === button));
    });
  });

  const slider = $<HTMLInputElement>('distance');
  const label = $('distance-val');
  const apply = () => {
    const distance = Number(slider.value);
    label.textContent = `${distance}px`;
    scene.setDummyDistance(distance);
  };
  slider.addEventListener('input', apply);
  const size = $<HTMLSelectElement>('dummy-size');
  size.addEventListener('change', () => scene.setDummySize(Number(size.value)));
  // Apply the initial value once the scene has built its fighters.
  window.requestAnimationFrame(() => apply());
}

function renderWarnings(warnings: string[]): void {
  $('warnings').innerHTML = warnings.map((w) => `• ${escapeHtml(w)}`).join('<br />');
}

function setActiveMode(buttons: NodeListOf<HTMLButtonElement>, mode: PlaybackMode): void {
  buttons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}

function startHudLoop(scene: TestbedScene): void {
  const hud = $('hud');
  const hitboxList = $('hud-hitboxes');

  const tick = () => {
    const s = scene.getSnapshot();
    if (s.ready) {
      hud.innerHTML = rows([
        ['frame', String(s.frame)],
        ['state', s.state],
        ['move', s.move ?? '—'],
        ['phase', `${s.movePhase} : f${s.movePhaseFrame}`],
        ['facing', s.facing === 1 ? '▶ right' : '◀ left'],
        ['player hp', String(s.playerHp)],
        ['dummy hp', `${s.dummyHp} / ${s.dummyMaxHp}`],
        ['dummy size', `${Math.round(s.dummySize * 100)}%`],
        ['dummy state', s.dummyState],
        ['distance', `${s.distance}px`],
      ]);

      const errorHtml = s.error
        ? `<div class="hitbox" style="color:var(--hit)">⚠ engine error: ${escapeHtml(s.error)} — paused. Fix the draft and Reset.</div>`
        : '';
      hitboxList.innerHTML = errorHtml + (s.hitboxes.length === 0
        ? ''
        : s.hitboxes.map((h) => `
          <div class="hitbox">
            <span class="tag">hitbox ${escapeHtml(h.id)}</span> · dmg ${h.damage}
            <div class="hud-grid">
              <span class="k">local</span><span class="v">x${round(h.local.x)} y${round(h.local.y)} · ${round(h.local.width)}×${round(h.local.height)}</span>
              <span class="k">world</span><span class="v">x${round(h.world.x)} y${round(h.world.y)} · ${round(h.world.width)}×${round(h.world.height)}</span>
              <span class="k">reach</span><span class="v">${round(h.reach)}px</span>
            </div>
          </div>`).join(''));
    }
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

function rows(entries: Array<[string, string]>): string {
  return entries.map(([k, v]) => `<span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span>`).join('');
}

function round(value: number): number {
  return Math.round(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] as string));
}

void main();
