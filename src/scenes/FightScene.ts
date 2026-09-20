import Phaser from 'phaser';
import { roster } from '../characters/roster';
import { CombatVisuals, createCombatTextures } from '../core/CombatVisuals';
import { collectProjectileAnimations } from '../core/projectileAssets';
import { ComputerPlayer } from '../core/ComputerPlayer';
import { Fighter } from '../core/Fighter';
import { GameLoop } from '../core/GameLoop';
import {ControlTelemetry} from '../core/ControlTelemetry';
import {ControlTelemetryPanel} from '../ui/ControlTelemetryPanel';
import { HitboxSystem } from '../core/HitboxSystem';
import { InputReader } from '../core/InputReader';
import { ProjectilePool } from '../core/ProjectilePool';
import { TouchInput } from '../core/TouchInput';
import type { CharacterConfig, CharacterSpriteConfig, SpriteFrameMeta, SpriteSheetId } from '../schema/types';
import { LayoutShell } from '../ui/LayoutShell';
import { prefersTouchControls } from '../util/device';
import { spritePreloadPlan } from '../core/spritePreloadPlan';
import { isFightOnly } from '../util/fightOnly';
import { MobileMatchMenu } from '../ui/MobileMatchMenu';
import { DebugOverlay } from './DebugOverlay';
import { DebugPanel } from './DebugPanel';

const FLOOR_Y = 390;
const ROUND_FRAMES = 99 * 60;
const STAGE_LEFT = 96;
const STAGE_RIGHT = 704;
const MIN_FIGHTER_DISTANCE = 96;
const SPRITE_ASSET_VERSION = 'demi-imagegen-v4';
const DEBUG_MOVE_KEYS: Record<string, { player: 0 | 1; moveId: string }> = {
  Digit1: { player: 0, moveId: 'fireball' },
  Digit2: { player: 0, moveId: 'dash_punch' },
  Digit3: { player: 0, moveId: 'uppercut' },
  Digit4: { player: 0, moveId: 'fusion' },
  Digit7: { player: 1, moveId: 'fireball' },
  Digit8: { player: 1, moveId: 'dash_punch' },
  Digit9: { player: 1, moveId: 'uppercut' },
  Digit0: { player: 1, moveId: 'fusion' },
};

type FightSceneData = {
  p1Id?: string;
  p2Id?: string;
  cpu?: boolean;
  p1Rounds?: number;
  p2Rounds?: number;
  roundNumber?: number;
  showCharacterSelect?: boolean;
};

type RoundWinner = 0 | 1 | 2;

export class FightScene extends Phaser.Scene {
  private mobileMenu?: MobileMatchMenu;
  private controlTelemetry=new ControlTelemetry();
  private controlPanel?:ControlTelemetryPanel;
  fighters!: [Fighter, Fighter];
  projectiles!: ProjectilePool;
  hitPauseFrames = 0;
  _soundsPlayedThisFrame: Set<string> | undefined = undefined;
  roundTimer = ROUND_FRAMES;
  debugMode = true;
  combatVisuals?: CombatVisuals;
  combatStatus: Phaser.GameObjects.Text[]=[];
  _combatImpacts: NonNullable<import('../schema/types').FighterScene['_combatImpacts']>=[];
  frameCounter = 0;

  readonly gameLoop = new GameLoop();
  readonly computerPlayer = new ComputerPlayer();
  singlePlayer = true;
  isPaused = false;
  // Defaults; init() may override from scene data. Optional access tolerates a
  // 1–2 char CMS roster (P2 falls back to P1 for a mirror match).
  // ponytail: a 0-char roster (fully wiped CMS) has no fighters to select — out
  // of scope; add an empty-state screen if that becomes a real workflow.
  selectedP1Id = roster[0]?.id ?? '';
  selectedP2Id = roster[2]?.id ?? roster[1]?.id ?? roster[0]?.id ?? '';
  p1Rounds = 0;
  p2Rounds = 0;
  roundNumber = 1;
  roundResolved = false;
  showCharacterSelect = false;
  hasSceneData = false;
  debugGraphics!: Phaser.GameObjects.Graphics;
  hudGraphics!: Phaser.GameObjects.Graphics;
  debugReadout!: Phaser.GameObjects.Text;
  hudText!: Phaser.GameObjects.Text;
  cpuToggleText!: Phaser.GameObjects.Text;
  pauseModal!: Phaser.GameObjects.Container;
  pauseCpuText!: Phaser.GameObjects.Text;
  winnerModal!: Phaser.GameObjects.Container;
  winnerTitleText!: Phaser.GameObjects.Text;
  winnerBodyText!: Phaser.GameObjects.Text;
  winnerActionText!: Phaser.GameObjects.Text;
  winnerActionButton!: Phaser.GameObjects.Rectangle;

  constructor() {
    super('FightScene');
  }

  init(data: FightSceneData = {}): void {
    this.gameLoop.reset();
    this.hasSceneData = Object.keys(data).length > 0;
    this.selectedP1Id = data.p1Id ?? roster[0]?.id ?? '';
    this.selectedP2Id = data.p2Id ?? roster[2]?.id ?? roster[1]?.id ?? roster[0]?.id ?? '';
    this.singlePlayer = prefersTouchControls() ? true : (data.cpu ?? true);
    this.p1Rounds = data.p1Rounds ?? 0;
    this.p2Rounds = data.p2Rounds ?? 0;
    this.roundNumber = data.roundNumber ?? 1;
    this.roundResolved = false;
    this.showCharacterSelect = data.showCharacterSelect ?? false;
    this.fighters = undefined as unknown as [Fighter, Fighter];
    this.projectiles = undefined as unknown as ProjectilePool;
    this.isPaused = false;
    this.roundTimer = ROUND_FRAMES;
    this.hitPauseFrames = 0;
    this.frameCounter = 0;
  }

  preload(): void {
    const arenaParams = new URLSearchParams(window.location.search);
    // A native match needs two fighters, not the entire publishing catalog.
    // The web character-select screen still loads the full set of portraits.
    const requested = this.hasSceneData ? [this.selectedP1Id, this.selectedP2Id] : [arenaParams.get('p1'), arenaParams.get('p2')];
    const matchRoster = isFightOnly() && !this.showCharacterSelect && requested.every(id => roster.some(c => c.id === id))
      ? roster.filter(c => requested.includes(c.id)) : roster;
    const arenaId = arenaParams.get('arena');
    if (arenaId) {
      this.load.image(`arena_${arenaId}`, this.assetUrl(`/arenas/${arenaId}/background.png`));
    }

    this.load.image('cardbross_cross', this.assetUrl('/fighters/mr_cardboard/projectiles/cardbross_cross.png'));
    this.load.image('hi_vis_vest', this.assetUrl('/fighters/viggo/projectiles/hi_vis_vest.png'));
    this.load.image('bucket_wave', this.assetUrl('/fighters/janitor/projectiles/bucket_wave.png'));
    this.load.image('apple_shards', this.assetUrl('/fighters/jack_tucker/projectiles/apple_shards.png'));
    this.load.image('martin_firebolt', this.assetUrl('/fighters/martin_urbano/projectiles/firebolt.png'));
    this.load.image('martin_ink_spark', this.assetUrl('/fighters/martin_urbano/projectiles/ink_spark.png'));
    this.load.image('martin_ground_rune', this.assetUrl('/fighters/martin_urbano/projectiles/ground_rune.png'));
    this.load.image('martin_lightning_from_sky', this.assetUrl('/fighters/martin_urbano/projectiles/lightning_from_sky.png'));
    this.load.image('purple_note_wave', this.assetUrl('/fighters/dylan_sax/projectiles/purple_note_wave.png'));
    this.load.image('foam_wave', this.assetUrl('/fighters/corey/projectiles/foam_wave.png'));
    this.load.image('juggling_balls', this.assetUrl('/fighters/juggling_joe/projectiles/juggling_balls.png'));
    this.load.image('squeak_storm', this.assetUrl('/fighters/rubber_chicken/projectiles/squeak_storm.png'));
    this.load.image('rubber_bat', this.assetUrl('/fighters/mr_spooky/projectiles/rubber_bat.png'));
    this.load.image('red_note_wave', this.assetUrl('/fighters/red_mic/projectiles/red_note_wave.png'));
    this.load.image('demi_laser', this.assetUrl('/fighters/demi/projectiles/remote_laser.png'));
    this.load.image('remote_spark', this.assetUrl('/fighters/demi/projectiles/remote_spark.png'));
    this.load.image('morph_flash', this.assetUrl('/fighters/demi/projectiles/morph_flash.png'));

    // The keys above are hand-authored fighters whose projectile filename can
    // differ from the texture key (e.g. martin_firebolt → firebolt.png), so they
    // stay explicit. CMS-generated fighters follow the convention
    // `/fighters/<id>/projectiles/<animation>.png` (written by the exporter), so
    // load those dynamically by walking each character's move spawn events. The
    // guard set skips anything already queued above so we never request a wrong
    // path for the hand-authored fighters.
    const queuedProjectileKeys = new Set<string>([
      'cardbross_cross', 'hi_vis_vest', 'bucket_wave', 'apple_shards',
      'martin_firebolt', 'martin_ink_spark', 'martin_ground_rune', 'martin_lightning_from_sky',
      'purple_note_wave', 'foam_wave', 'juggling_balls', 'squeak_storm',
      'rubber_bat', 'red_note_wave', 'demi_laser', 'remote_spark', 'morph_flash',
    ]);
    for (const character of matchRoster.flatMap(c=>[c,...(c.forms??[]).map(f=>f.config)])) {
      const procedural = new Set(character.moves.flatMap(m => m.phases.flatMap(p => p.events.flatMap(({event}) => 'projectile' in event && event.projectile.visual ? [event.projectile.animation] : []))));
      for (const animation of collectProjectileAnimations(character)) {
        if (procedural.has(animation)) continue;
        if (queuedProjectileKeys.has(animation)) continue;
        queuedProjectileKeys.add(animation);
        this.load.image(animation, this.assetUrl(`${character.assetBasePath??`/fighters/${character.id}`}/projectiles/${animation}.png`));
      }
    }

    const preloadSpriteConfig = (sprite: CharacterSpriteConfig, keyPrefix: string): void => {
      for (const [sheet, frameCount] of Object.entries(sprite.frameCounts)) {
        if (!frameCount) continue;
        const sheetId = sheet as SpriteSheetId;
        const frameMeta = sprite.frames?.[sheetId];
        for (let frame = 1; frame <= frameCount; frame += 1) {
          const frameNumber = String(frame).padStart(3, '0');
          this.load.image(
            `${keyPrefix}:${sheet}:${frame - 1}`,
            this.assetUrl(frameMeta?.[frame - 1]
              ? `${sprite.basePath}/${frameMeta[frame - 1].file}`
              : `${sprite.basePath}/sprites/${sheet}/${sheet}_${frameNumber}.png`),
          );
        }
      }
    };

    for (const character of matchRoster.flatMap(c=>[c,...(c.forms??[]).map(f=>f.config)])) {
      for (const entry of spritePreloadPlan(character)) preloadSpriteConfig(entry.sprite, entry.keyPrefix);
    }

    this.load.json('assets-index', '/assets-index.json');
    this.load.once('filecomplete-json-assets-index', (_key: string, _type: string, data: unknown) => {
      if (!data || typeof data !== 'object') return;
      const index = data as Record<string, unknown>;
      const sounds = index['sounds'];
      if (!Array.isArray(sounds)) return;

      let count = 0;
      for (const sound of sounds) {
        if (!sound || typeof sound !== 'object') continue;
        const s = sound as Record<string, unknown>;
        const name = typeof s['name'] === 'string' ? s['name'] : null;
        const file = typeof s['file'] === 'string' ? s['file'] : null;
        const fighterId = typeof s['fighterId'] === 'string' ? s['fighterId'] : null;
        if (!name || !file) continue;

        const key = fighterId ? `${fighterId}:${name}` : name;
        const url = fighterId
          ? `/audio/sfx/fighters/${fighterId}/${file}`
          : `/audio/sfx/${file}`;
        this.load.audio(key, url);
        count += 1;
      }

      if (count > 50) {
        console.warn(`[FightScene] preloading ${count} sounds — consider pruning the assets index`);
      }

      if (count > 0) this.load.start();
    });
    this.load.on('loaderror', (file: { key: string; type: string }) => {
      if (file.key === 'assets-index') return; // missing index is expected until sounds are generated
    });
  }

  create(): void {
    if (this.input.keyboard) InputReader.reset(this.input.keyboard);
    const clearTimingAndInput = (): void => {
      this.gameLoop.reset();
      if (this.input.keyboard) InputReader.reset(this.input.keyboard);
    };
    this.game.events.on(Phaser.Core.Events.BLUR, clearTimingAndInput);
    this.game.events.on(Phaser.Core.Events.FOCUS, clearTimingAndInput);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, clearTimingAndInput);
      this.game.events.off(Phaser.Core.Events.FOCUS, clearTimingAndInput);
      // The scene-owned keyboard plugin survives restart. Without this, each
      // restart adds another pause/CPU/reset handler and toggles cancel out.
      this.input.keyboard?.removeAllListeners();
    });
    const params = new URLSearchParams(window.location.search);
    if (!this.hasSceneData && params.get('cpu') === 'off') this.singlePlayer = false;
    const p1FromQuery = params.get('p1');
    const p2FromQuery = params.get('p2');
    if (!this.hasSceneData) {
      if (p1FromQuery) this.selectedP1Id = this.characterFromParam(p1FromQuery, roster[0]).id;
      if (p2FromQuery) this.selectedP2Id = this.characterFromParam(p2FromQuery, roster[2]).id;
    }

    this.cameras.main.setBackgroundColor('#141820');

    const arenaQueryParams = new URLSearchParams(window.location.search);
    const arenaIdForBg = arenaQueryParams.get('arena');
    if (arenaIdForBg && this.textures.exists(`arena_${arenaIdForBg}`)) {
      const bg = this.add.image(this.scale.width / 2, this.scale.height / 2, `arena_${arenaIdForBg}`);
      bg.setDisplaySize(this.scale.width, this.scale.height);
      bg.setDepth(-10);
    }

    this.createProjectileTextures();
    createCombatTextures(this, roster.flatMap(c=>[c,...(c.forms??[]).map(f=>f.config)]));
    if (params.get('debug') === 'sprites') {
      this.createSpriteDebugView(params);
      return;
    }
    if (
      this.showCharacterSelect ||
      (!this.hasSceneData && params.get('select') === '1') ||
      (!this.hasSceneData && !p1FromQuery && !p2FromQuery && this.p1Rounds === 0 && this.p2Rounds === 0)
    ) {
      this.createCharacterSelectScreen();
      return;
    }

    this.add.rectangle(400, FLOOR_Y + 30, 800, 120, 0x20262f).setOrigin(0.5, 0);
    this.add.rectangle(400, FLOOR_Y + 1, 800, 2, 0x9aa8bb);

    this.projectiles = new ProjectilePool(this);
    this.fighters = [
      new Fighter(this, this.characterFromParam(this.selectedP1Id, roster[0]), 1, { x: 200, y: FLOOR_Y }),
      new Fighter(this, this.characterFromParam(this.selectedP2Id, roster[2]), 2, { x: 600, y: FLOOR_Y }),
    ];
    this.combatVisuals = new CombatVisuals(this);
    this._combatImpacts=[];
    this.combatStatus=[this.add.text(24,84,'',{fontFamily:'monospace',fontSize:'10px',color:'#e3e8d7'}).setDepth(55),this.add.text(776,84,'',{fontFamily:'monospace',fontSize:'10px',color:'#e3e8d7',align:'right'}).setOrigin(1,0).setDepth(55)];
    if (this.fighters.some(f => f.config.rosterGroup === 'oddities')) this.debugMode = false;
    if (this.fighters.some(f => f.config.rosterGroup === 'oddities') && !arenaIdForBg) this.createOdditiesStage();

    this.hudGraphics = this.add.graphics().setDepth(50);
    this.debugGraphics = this.add.graphics().setDepth(60);
    this.hudText = this.add
      .text(400, 18, '', {
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '16px',
      })
      .setOrigin(0.5, 0)
      .setDepth(70);
    this.cpuToggleText = this.add
      .text(400, 42, '', {
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '12px',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setDepth(70)
      .setInteractive({ useHandCursor: true });
    this.cpuToggleText.on('pointerdown', () => this.toggleCpu());
    this.debugReadout = this.add
      .text(12, 78, '', {
        color: '#dbe7ff',
        fontFamily: 'monospace',
        fontSize: '12px',
        backgroundColor: 'rgba(0,0,0,0.45)',
        padding: { x: 6, y: 6 },
      })
      .setDepth(70);
    this.createPauseModal();
    this.createWinnerModal();

    DebugPanel.create(this);
    if (!this.debugMode) DebugPanel.current()?.toggle();

    this.input.keyboard?.on('keydown-F1', () => {
      DebugPanel.current()?.toggle();
      this.debugMode = !this.debugMode;
      if (!this.debugMode) DebugOverlay.clear(this);
    });
    this.input.keyboard?.on('keydown-F3', () => {
      DebugPanel.current()?.togglePanel();
    });
    this.input.keyboard?.on('keydown-F2', () => {
      this.toggleCpu();
    });
    this.input.keyboard?.on('keydown-R', () => {
      this.restartCurrentRound();
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.roundResolved) return;
      this.setPaused(!this.isPaused);
    });
    this.input.keyboard?.on('keydown-P', () => {
      if (this.roundResolved) return;
      this.setPaused(!this.isPaused);
    });
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (this.isPaused) return;
      const debugMove = DEBUG_MOVE_KEYS[event.code];
      if (!debugMove) return;
      this.fighters[debugMove.player].debugStartMove(debugMove.moveId);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      DebugPanel.current()?.destroy();
    });

    this.installDebugHooks();
    this.installTouchHooks();
    if (isFightOnly()) {
      this.mobileMenu = new MobileMatchMenu();
      const suspend = () => { if (!this.roundResolved) this.setPaused(true); };
      const hidden = () => { if (document.hidden) suspend(); };
      window.addEventListener('tf:suspend', suspend);
      document.addEventListener('visibilitychange', hidden);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.mobileMenu?.destroy(); this.mobileMenu = undefined;
        window.removeEventListener('tf:suspend', suspend);
        document.removeEventListener('visibilitychange', hidden);
      });
      // One lifecycle message, never a per-frame native input bridge.
      (window as typeof window & { ReactNativeWebView?: { postMessage: (message: string) => void } })
        .ReactNativeWebView?.postMessage(JSON.stringify({ type: 'fight-ready' }));
    }

    const debugMove = params.get('move');
    const debugPlayer = params.get('player') === '2' ? 2 : 1;
    if (debugMove) {
      this.time.delayedCall(300, () => {
        this.fighters[debugPlayer - 1].debugStartMove(debugMove);
      });
    }
  }

  private installTouchHooks(): void {
    const shell = LayoutShell.current();
    if (!shell) return;
    shell.controls.setPauseHandler((paused) => {
      const previous = this.isPaused;
      if (!this.roundResolved) this.setPaused(paused ?? !this.isPaused);
      return previous;
    });
    const unsubscribe = shell.onChange(({ orientation }) => {
      TouchInput.clearAll();
      if (this.roundResolved) return;
      // Auto-pause on orientation flip so a stuck input doesn't ruin the round.
      if (orientation === 'portrait' || orientation === 'landscape') {
        this.setPaused(true);
      }
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribe();
      shell.controls.setPauseHandler(() => false);
      shell.controls.releaseAll();
      TouchInput.clearAll();
    });
  }

  update(time: number): void {
    if (!this.fighters) return;
    this.gameLoop.update(time, () => this.fixedUpdate());
    this.renderFrame();
  }

  fixedUpdate(): void {
    if (!this.fighters || !this.projectiles) return;

    this._soundsPlayedThisFrame?.clear();

    if (this.roundResolved) {
      return;
    }

    if (this.isPaused) {
      return;
    }

    if(this.roundTimer>0&&!this.isRoundOver())this.controlTelemetry.record(this.fighters.map(f=>f.state),this.hitPauseFrames>0);

    if (this.hitPauseFrames > 0) {
      this.hitPauseFrames -= 1;
      return;
    }

    if (this.roundTimer > 0 && !this.isRoundOver()) {
      const keyboard = this.input.keyboard;
      if (!keyboard) return;

      const input1 = InputReader.read(1, keyboard);
      const input2 = this.singlePlayer
        ? this.computerPlayer.read(this.fighters[1], this.fighters[0], this.frameCounter)
        : InputReader.read(2, keyboard);

      this.fighters[0].update(input1, this.fighters[1], this.projectiles);
      this.fighters[1].update(input2, this.fighters[0], this.projectiles);
      this.resolveFighterSpacing();
      this.projectiles.update();
      this.combatVisuals?.tick();
      HitboxSystem.checkAll(this.fighters, this.projectiles);
      this.roundTimer -= 1;
      this.frameCounter += 1;
      if (this.isRoundOver()) this.resolveRound();
    }

  }

  renderFrame(): void {
    if (this.mobileMenu) {
      this.pauseModal.setVisible(false);
      this.winnerModal.setVisible(false);
      const select = () => {
        const bridge = (window as typeof window & { ReactNativeWebView?: { postMessage: (message: string) => void } }).ReactNativeWebView;
        if (bridge) bridge.postMessage(JSON.stringify({ type: 'select-fighter' }));
        else this.openCharacterSelect();
      };
      if (this.roundResolved) this.mobileMenu.render(`round-${this.roundNumber}`, this.winnerTitleText.text, this.winnerBodyText.text, [
        { label: this.winnerActionText.text, run: () => this.advanceAfterRound() },
        { label: 'CHOOSE FIGHTERS', run: select },
      ]);
      else if (this.isPaused) this.mobileMenu.render('paused', 'PAUSED', 'Take a breath. Your opponent can wait.', [
        { label: 'RESUME', run: () => this.setPaused(false) },
        { label: 'RESTART ROUND', run: () => this.restartCurrentRound() },
        { label: 'CHOOSE FIGHTERS', run: select },
      ]);
      else this.mobileMenu.render('', '', '', []);
    }
    if(!isFightOnly()&&!this.controlPanel){this.controlPanel=new ControlTelemetryPanel(this.controlTelemetry);this.events.once('shutdown',()=>{this.controlPanel?.destroy();this.controlPanel=undefined;this.controlTelemetry.reset();});}
    this.controlPanel?.render();
    if (this.fighters) this.combatVisuals?.draw(this.fighters);
    this.renderHUD();
    if (this.debugMode) DebugOverlay.render(this);
  }

  private renderHUD(): void {
    if (!this.fighters) return;
    const [p1, p2] = this.fighters;
    [p1,p2].forEach((f,i)=>{
      const victim=this.fighters[1-i];
      const form=f.activeForm?`${f.activeForm.name} · ${f.formTicks===null?'UNTIL KO':Math.ceil(f.formTicks/60)+'s'}`:'BASE FORM';
      const combo=victim.combo.displayTicks>0&&victim.combo.hits>1?`${victim.combo.hits} HITS · ${victim.combo.damage} DMG`:'';
      this.combatStatus[i]?.setText([`${form}   METER ${Math.floor(f.meter)}`,f.powers.map(p=>`${p.spec.name} ${p.remaining===null?'KO':Math.ceil(p.remaining/60)+'s'}`).join(' / '),combo].filter(Boolean).join('\n'));
    });
    const p1Ratio = Phaser.Math.Clamp(p1.health / p1.config.maxHealth, 0, 1);
    const p2Ratio = Phaser.Math.Clamp(p2.health / p2.config.maxHealth, 0, 1);

    this.hudGraphics.clear();
    this.hudGraphics.fillStyle(0x0b0e13, 0.9);
    this.hudGraphics.fillRect(24, 24, 310, 18);
    this.hudGraphics.fillRect(466, 24, 310, 18);
    this.hudGraphics.fillStyle(0xdf4545, 1);
    this.hudGraphics.fillRect(24, 24, 310 * p1Ratio, 18);
    this.hudGraphics.fillStyle(0x426edb, 1);
    this.hudGraphics.fillRect(776 - 310 * p2Ratio, 24, 310 * p2Ratio, 18);
    this.hudGraphics.lineStyle(1, 0xffffff, 0.65);
    this.hudGraphics.strokeRect(24, 24, 310, 18);
    this.hudGraphics.strokeRect(466, 24, 310, 18);
    this.hudGraphics.fillStyle(this.p1Rounds >= 1 ? 0xfff0a3 : 0x2c3440, 1);
    this.hudGraphics.fillCircle(42, 58, 5);
    this.hudGraphics.fillStyle(this.p1Rounds >= 2 ? 0xfff0a3 : 0x2c3440, 1);
    this.hudGraphics.fillCircle(58, 58, 5);
    this.hudGraphics.fillStyle(this.p2Rounds >= 1 ? 0xfff0a3 : 0x2c3440, 1);
    this.hudGraphics.fillCircle(742, 58, 5);
    this.hudGraphics.fillStyle(this.p2Rounds >= 2 ? 0xfff0a3 : 0x2c3440, 1);
    this.hudGraphics.fillCircle(758, 58, 5);

    const winner =
      p1.health <= 0 && p2.health <= 0
        ? 'DOUBLE KO'
        : p1.health <= 0
          ? 'P2 WINS'
          : p2.health <= 0
            ? 'P1 WINS'
            : this.roundTimer <= 0
              ? 'TIME'
              : '';
    const timer = Math.max(0, Math.ceil(this.roundTimer / 60));
    this.hudText.setText(winner ? `${winner}  ${timer}` : `R${this.roundNumber}  ${timer}`);
    const hudHint = prefersTouchControls()
      ? `${this.singlePlayer ? 'CPU: ON' : 'CPU: OFF'}  tap to toggle`
      : `${this.singlePlayer ? 'CPU: ON' : 'CPU: OFF'}  click/F2  P/Esc pause  R reset  P1:1-4 P2:7-0`;
    this.cpuToggleText.setText(hudHint);
    this.cpuToggleText.setColor(this.singlePlayer ? '#ffffff' : '#8de6ff');
    this.updatePauseModalText();
  }

  private isRoundOver(): boolean {
    return this.fighters[0].health <= 0 || this.fighters[1].health <= 0 || this.roundTimer <= 0;
  }

  private toggleCpu(): void {
    this.singlePlayer = !this.singlePlayer;
    this.updatePauseModalText();
  }

  private setPaused(paused: boolean): void {
    this.gameLoop.reset();
    LayoutShell.current()?.controls.releaseAll();
    if (this.input.keyboard) InputReader.reset(this.input.keyboard);
    this.isPaused = paused;
    this.pauseModal.setVisible(paused);
    this.updatePauseModalText();
  }

  private createPauseModal(): void {
    const overlay = this.add.rectangle(400, 225, 800, 450, 0x05070b, 0.72).setInteractive();
    const panel = this.add.rectangle(400, 226, 520, 330, 0x141820, 0.96).setStrokeStyle(2, 0x8de6ff, 0.85);
    const title = this.add
      .text(400, 82, 'PAUSED', {
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '28px',
      })
      .setOrigin(0.5, 0);
    const controls = this.add
      .text(
        174,
        132,
        [
          'P / Esc        Resume',
          'F1             Toggle debug boxes',
          'F3             Debug panel (per-actor)',
          'F2             Toggle CPU',
          'R              Restart round',
          '',
          'P1             WASD move, F/G/H attacks',
          'P2             Arrows move, J/K/L attacks',
          '',
          'Shift / N      Dash (air + Down: wavedash)',
          'E / O          Power-up (25 meter)',
          'Q / U          Transform (authored forms)',
          'Down + G/K     Launcher; F+G / J+K grab',
          '',
          'Debug moves    P1: 1/2/3/4   P2: 7/8/9/0',
        ].join('\n'),
        {
          color: '#dbe7ff',
          fontFamily: 'monospace',
          fontSize: '13px',
          lineSpacing: 3,
        },
      )
      .setOrigin(0, 0);

    if (prefersTouchControls()) controls.setText([
      'MOVE       Left pad; hold away to guard',
      'ATTACK     Punch / Kick / Special',
      'GRAB       One button, close range',
      'LAUNCH     Down + Kick',
      'VARIANTS   Direction + Special',
      'DODGE      Jump, then Down + Dash',
      'METER      Boost / Form',
      '',
      'CONTROLS   Resize, mirror, or change contrast',
    ].join('\n'));

    const resumeButton = this.createPauseButton(228, 366, 'RESUME', () => this.setPaused(false));
    const restartButton = this.createPauseButton(342, 366, 'RESTART', () => this.restartCurrentRound());
    const cpuButton = this.createPauseButton(456, 366, 'CPU', () => this.toggleCpu());
    const selectButton = this.createPauseButton(570, 366, 'SELECT', () => this.openCharacterSelect());
    this.pauseCpuText = this.add
      .text(400, 408, '', {
        color: '#8de6ff',
        fontFamily: 'monospace',
        fontSize: '12px',
      })
      .setOrigin(0.5, 0);

    this.pauseModal = this.add
      .container(0, 0, [
        overlay,
        panel,
        title,
        controls,
        ...resumeButton,
        ...restartButton,
        ...cpuButton,
        ...selectButton,
        this.pauseCpuText,
      ])
      .setDepth(200)
      .setVisible(false);
  }

  private createPauseButton(x: number, y: number, label: string, onClick: () => void): [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Text] {
    const button = this.add
      .rectangle(x, y, 96, 34, 0x233142, 1)
      .setStrokeStyle(1, 0xdbe7ff, 0.75)
      .setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x, y, label, {
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '12px',
      })
      .setOrigin(0.5);

    button.on('pointerover', () => button.setFillStyle(0x2f465f, 1));
    button.on('pointerout', () => button.setFillStyle(0x233142, 1));
    button.on('pointerdown', onClick);

    return [button, text];
  }

  private updatePauseModalText(): void {
    if (!this.pauseCpuText) return;
    this.pauseCpuText.setText(`CPU opponent: ${this.singlePlayer ? 'ON' : 'OFF'}`);
  }

  private createWinnerModal(): void {
    const overlay = this.add.rectangle(400, 225, 800, 450, 0x05070b, 0.72).setInteractive();
    const panel = this.add.rectangle(400, 226, 520, 260, 0x141820, 0.97).setStrokeStyle(2, 0xfff0a3, 0.9);
    this.winnerTitleText = this.add
      .text(400, 112, '', {
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '24px',
      })
      .setOrigin(0.5, 0);
    this.winnerBodyText = this.add
      .text(400, 164, '', {
        color: '#dbe7ff',
        fontFamily: 'monospace',
        fontSize: '14px',
        align: 'center',
        lineSpacing: 5,
      })
      .setOrigin(0.5, 0);
    this.winnerActionButton = this.add
      .rectangle(330, 326, 150, 38, 0x2f465f, 1)
      .setStrokeStyle(1, 0xffffff, 0.78)
      .setInteractive({ useHandCursor: true });
    this.winnerActionText = this.add
      .text(330, 326, '', {
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '12px',
      })
      .setOrigin(0.5);
    const selectButton = this.createPauseButton(500, 326, 'SELECT', () => this.openCharacterSelect());

    this.winnerActionButton.on('pointerover', () => this.winnerActionButton.setFillStyle(0x3b5875, 1));
    this.winnerActionButton.on('pointerout', () => this.winnerActionButton.setFillStyle(0x2f465f, 1));
    this.winnerActionButton.on('pointerdown', () => this.advanceAfterRound());

    this.winnerModal = this.add
      .container(0, 0, [overlay, panel, this.winnerTitleText, this.winnerBodyText, this.winnerActionButton, this.winnerActionText, ...selectButton])
      .setDepth(210)
      .setVisible(false);
  }

  private resolveRound(): void {
    if (!this.fighters) return;
    if (this.roundResolved) return;
    const winner = this.roundWinner();
    const nextP1Rounds = this.p1Rounds + (winner === 1 ? 1 : 0);
    const nextP2Rounds = this.p2Rounds + (winner === 2 ? 1 : 0);
    const matchWinner = nextP1Rounds >= 2 ? 1 : nextP2Rounds >= 2 ? 2 : 0;
    const winnerName =
      winner === 1
        ? this.fighters[0].config.displayName
        : winner === 2
          ? this.fighters[1].config.displayName
          : 'Double KO';
    const matchWinnerName =
      matchWinner === 1 ? this.fighters[0].config.displayName : matchWinner === 2 ? this.fighters[1].config.displayName : '';

    this.roundResolved = true;
    this.isPaused = true;
    this.p1Rounds = nextP1Rounds;
    this.p2Rounds = nextP2Rounds;
    this.winnerTitleText.setText(matchWinner ? `${matchWinnerName} WINS MATCH` : `${winnerName} WINS ROUND ${this.roundNumber}`);
    this.winnerBodyText.setText(
      [
        `Round score: P1 ${this.p1Rounds} - ${this.p2Rounds} P2`,
        matchWinner ? 'Best of 3 complete.' : `Next: round ${this.roundNumber + 1} of best 2 of 3`,
      ].join('\n'),
    );
    this.winnerActionText.setText(matchWinner ? 'REMATCH' : 'NEXT ROUND');
    this.winnerModal.setVisible(true);
  }

  private roundWinner(): RoundWinner {
    if (!this.fighters) return 0;
    const [p1, p2] = this.fighters;
    if (p1.health <= 0 && p2.health <= 0) return 0;
    if (p1.health <= 0) return 2;
    if (p2.health <= 0) return 1;
    if (p1.health === p2.health) return 0;
    return p1.health > p2.health ? 1 : 2;
  }

  private advanceAfterRound(): void {
    const matchComplete = this.p1Rounds >= 2 || this.p2Rounds >= 2;
    this.scene.restart({
      p1Id: this.selectedP1Id,
      p2Id: this.selectedP2Id,
      cpu: this.singlePlayer,
      p1Rounds: matchComplete ? 0 : this.p1Rounds,
      p2Rounds: matchComplete ? 0 : this.p2Rounds,
      roundNumber: matchComplete ? 1 : this.roundNumber + 1,
    } satisfies FightSceneData);
  }

  private restartCurrentRound(): void {
    this.scene.restart({
      p1Id: this.selectedP1Id,
      p2Id: this.selectedP2Id,
      cpu: this.singlePlayer,
      p1Rounds: this.p1Rounds,
      p2Rounds: this.p2Rounds,
      roundNumber: this.roundNumber,
    } satisfies FightSceneData);
  }

  private openCharacterSelect(): void {
    this.scene.restart({
      p1Id: this.selectedP1Id,
      p2Id: this.selectedP2Id,
      cpu: this.singlePlayer,
      showCharacterSelect: true,
    } satisfies FightSceneData);
  }

  private createCharacterSelectScreen(): void {
    let p1Id = this.selectedP1Id, p2Id = this.selectedP2Id;
    let player: 1 | 2 = 1, page = 0;
    const pageSize = 10, pages = Math.ceil(roster.length / pageSize);
    const cards = this.add.container(0, 0);
    this.add.rectangle(400,225,800,450,0x10191d).setDepth(-1);
    this.add.text(30,24,'CHOOSE YOUR ODDITY',{fontFamily:'monospace',fontSize:'24px',color:'#e8ecdc'});
    const help = this.add.text(30,65,'',{fontFamily:'monospace',fontSize:'11px',color:'#b7d6c7'});
    const pageText = this.add.text(400,352,'',{fontFamily:'monospace',fontSize:'11px',color:'#b7d6c7'}).setOrigin(.5);
    const draw = (): void => {
      cards.removeAll(true);
      help.setText(`Selecting P${player}   /   P1: ${this.characterFromParam(p1Id,roster[0]).displayName}   vs   P2: ${this.characterFromParam(p2Id,roster[0]).displayName}`);
      pageText.setText(`PAGE ${page+1} / ${pages}   ·   ${roster.length} FIGHTERS   ·   CPU ${this.singlePlayer?'ON':'OFF'}`);
      roster.slice(page*pageSize,(page+1)*pageSize).forEach((c,i)=>{
        const x=88+(i%5)*156,y=154+Math.floor(i/5)*117;
        const chosen=c.id===(player===1?p1Id:p2Id);
        const rect=this.add.rectangle(x,y,142,106,chosen?0x28453d:0x18282d).setStrokeStyle(2,chosen?0xc2ed9e:0x36514c).setInteractive({useHandCursor:true});
        rect.on('pointerdown',()=>{if(player===1)p1Id=c.id;else p2Id=c.id;draw();});
        cards.add(rect);
        const meta=c.sprite?this.debugFrameMeta(c.sprite,'base',1)[0]:null;
        const key=c.actors?.length?`${c.id}:${c.actors[0].id}:base:0`:`${c.id}:base:0`;
        if(this.textures.exists(key)) {
          const sprite=this.add.sprite(x,y+34,key);
          if(meta) sprite.setOrigin(meta.anchor.x/meta.width,meta.anchor.y/meta.height).setScale(c.rosterGroup==='oddities'?.58:Math.min(.5,70/meta.height));
          cards.add(sprite);
        }
        cards.add(this.add.text(x,y-46,c.displayName,{fontFamily:'monospace',fontSize:'10px',color:'#e4e9d8'}).setOrigin(.5,0));
        if(c.id===p1Id||c.id===p2Id) cards.add(this.add.text(x-62,y+31,`${c.id===p1Id?'P1 ':''}${c.id===p2Id?'P2':''}`,{fontFamily:'monospace',fontSize:'10px',color:'#c2ed9e'}));
      });
    };
    this.add.container(0,0,[
      ...this.createPauseButton(86,398,'P1',()=>{player=1;draw();}),
      ...this.createPauseButton(208,398,'P2',()=>{player=2;draw();}),
      ...this.createPauseButton(330,398,'NEXT',()=>{page=(page+1)%pages;draw();}),
      ...this.createPauseButton(452,398,'CPU',()=>{this.singlePlayer=!this.singlePlayer;draw();}),
      ...this.createPauseButton(574,398,isFightOnly()?'BACK':'ROSTER',()=>{if(isFightOnly())this.scene.restart({p1Id:this.selectedP1Id,p2Id:this.selectedP2Id,cpu:this.singlePlayer});else window.location.href='/roster';}),
      ...this.createPauseButton(706,398,'FIGHT',()=>{this.scene.restart({p1Id,p2Id,cpu:this.singlePlayer,p1Rounds:0,p2Rounds:0,roundNumber:1} satisfies FightSceneData);}),
    ]);
    draw();
  }

  private createProjectileTextures(): void {
    if (!this.textures.exists('sound_wave')) {
      const wave = this.add.graphics();
      wave.lineStyle(3, 0x9ee9ff, 1);
      wave.strokeEllipse(38, 18, 26, 32);
      wave.strokeEllipse(52, 18, 42, 44);
      wave.strokeEllipse(68, 18, 58, 54);
      wave.lineStyle(2, 0xffffff, 0.9);
      wave.beginPath();
      wave.moveTo(2, 18);
      wave.lineTo(18, 8);
      wave.lineTo(28, 28);
      wave.lineTo(42, 10);
      wave.lineTo(56, 28);
      wave.strokePath();
      wave.generateTexture('sound_wave', 96, 56);
      wave.destroy();
    }

    if (!this.textures.exists('feedback_wave')) {
      const feedback = this.add.graphics();
      feedback.lineStyle(3, 0xffb3f3, 1);
      feedback.strokeCircle(36, 28, 12);
      feedback.strokeCircle(48, 28, 24);
      feedback.strokeCircle(62, 28, 36);
      feedback.lineStyle(2, 0xffffff, 0.9);
      feedback.beginPath();
      feedback.moveTo(0, 28);
      feedback.lineTo(12, 20);
      feedback.lineTo(22, 36);
      feedback.lineTo(36, 18);
      feedback.lineTo(52, 38);
      feedback.strokePath();
      feedback.generateTexture('feedback_wave', 96, 56);
      feedback.destroy();
    }

    if (!this.textures.exists('cardbross_cross')) {
      const cross = this.add.graphics();
      cross.fillStyle(0xffe18a, 0.22);
      cross.fillCircle(48, 48, 46);
      cross.lineStyle(4, 0x3a2415, 1);
      cross.fillStyle(0xc68642, 1);
      cross.fillRect(38, 4, 20, 88);
      cross.fillRect(4, 38, 88, 20);
      cross.strokeRect(38, 4, 20, 88);
      cross.strokeRect(4, 38, 88, 20);
      cross.lineStyle(1, 0xf0bb72, 0.95);
      for (let pos = 14; pos <= 82; pos += 14) {
        cross.lineBetween(40, pos, 56, pos);
        cross.lineBetween(pos, 40, pos, 56);
      }
      cross.generateTexture('cardbross_cross', 96, 96);
      cross.destroy();
    }

    if (!this.textures.exists('fusion_poof')) {
      const poof = this.add.graphics();
      poof.fillStyle(0xf7f1df, 0.86);
      poof.fillCircle(34, 48, 20);
      poof.fillCircle(54, 34, 24);
      poof.fillCircle(78, 46, 22);
      poof.fillCircle(62, 62, 26);
      poof.fillCircle(96, 56, 18);
      poof.lineStyle(2, 0xffffff, 0.95);
      poof.strokeCircle(34, 48, 20);
      poof.strokeCircle(54, 34, 24);
      poof.strokeCircle(78, 46, 22);
      poof.strokeCircle(62, 62, 26);
      poof.strokeCircle(96, 56, 18);
      poof.lineStyle(2, 0x8de6ff, 0.8);
      poof.lineBetween(12, 24, 0, 12);
      poof.lineBetween(108, 26, 122, 12);
      poof.lineBetween(24, 78, 8, 92);
      poof.lineBetween(96, 82, 112, 98);
      poof.generateTexture('fusion_poof', 128, 104);
      poof.destroy();
    }

    if (!this.textures.exists('demi_laser')) {
      const laser = this.add.graphics();
      laser.lineStyle(22, 0x3feaff, 0.18);
      laser.lineBetween(4, 22, 220, 22);
      laser.lineStyle(12, 0x3feaff, 0.48);
      laser.lineBetween(8, 22, 216, 22);
      laser.lineStyle(4, 0xe6ffff, 1);
      laser.lineBetween(10, 22, 214, 22);
      laser.lineStyle(2, 0xffffff, 0.8);
      for (let x = 34; x <= 194; x += 40) {
        laser.lineBetween(x - 8, 14, x + 8, 30);
      }
      laser.generateTexture('demi_laser', 224, 44);
      laser.destroy();
    }

    if (!this.textures.exists('remote_spark')) {
      const spark = this.add.graphics();
      spark.fillStyle(0xe6ffff, 0.8);
      spark.fillCircle(32, 32, 8);
      spark.lineStyle(3, 0x3feaff, 0.9);
      spark.strokeCircle(32, 32, 15);
      spark.lineStyle(2, 0xffffff, 0.9);
      spark.lineBetween(32, 4, 32, 18);
      spark.lineBetween(32, 46, 32, 60);
      spark.lineBetween(4, 32, 18, 32);
      spark.lineBetween(46, 32, 60, 32);
      spark.lineBetween(12, 12, 22, 22);
      spark.lineBetween(42, 42, 52, 52);
      spark.generateTexture('remote_spark', 64, 64);
      spark.destroy();
    }

    if (!this.textures.exists('morph_flash')) {
      const flash = this.add.graphics();
      flash.lineStyle(5, 0x48f182, 0.68);
      flash.strokeCircle(46, 46, 32);
      flash.lineStyle(4, 0x0dc24f, 0.85);
      flash.beginPath();
      flash.arc(46, 46, 24, Phaser.Math.DegToRad(205), Phaser.Math.DegToRad(30), false);
      flash.strokePath();
      flash.fillStyle(0xe6ffff, 0.55);
      flash.fillCircle(46, 46, 12);
      flash.generateTexture('morph_flash', 92, 92);
      flash.destroy();
    }
  }

  private createSpriteDebugView(params: URLSearchParams): void {
    const characterFilter = params.get('character');
    const sheetFilter = params.get('sheet');
    const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#ffffff',
      fontFamily: 'monospace',
      fontSize: '10px',
      backgroundColor: 'rgba(0,0,0,0.55)',
      padding: { x: 3, y: 2 },
    };

    this.add
      .text(12, 8, 'Sprite Debug: individual frame textures, not packed sheets', {
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '14px',
      })
      .setOrigin(0, 0);

    let y = 42;
    for (const character of roster) {
      if (characterFilter && character.id !== characterFilter) continue;
      if (!character.sprite) continue;
      this.add
        .text(12, y, character.displayName, {
          color: '#8de6ff',
          fontFamily: 'monospace',
          fontSize: '13px',
        })
        .setOrigin(0, 0);
      y += 24;

      for (const [sheet, frameCount] of Object.entries(character.sprite.frameCounts)) {
        if (sheetFilter && sheet !== sheetFilter) continue;
        if (!frameCount) continue;
        const sheetId = sheet as SpriteSheetId;
        const debugFrames = this.debugFrameMeta(character.sprite, sheetId, frameCount);
        this.add.text(14, y + 54, sheet, labelStyle).setOrigin(0, 0.5);
        for (let frame = 0; frame < frameCount; frame += 1) {
          const x = 102 + frame * 124;
          const key = `${character.id}:${sheet}:${frame}`;
          const meta = debugFrames[frame];
          const scale = Math.min(0.5, 92 / meta.width, 92 / meta.height);
          this.add.rectangle(x, y + 72, 112, 104, 0x0b0e13).setStrokeStyle(1, 0x485568, 0.85);
          this.add
            .image(x, y + 116, key)
            .setOrigin(meta.anchor.x / meta.width, meta.anchor.y / meta.height)
            .setScale(scale);
          this.add.line(0, x - 8, y + 116, x + 8, y + 116, 0xffe18a, 0.75).setOrigin(0, 0);
          this.add.line(0, x, y + 108, x, y + 124, 0xffe18a, 0.75).setOrigin(0, 0);
          this.add.text(x - 45, y + 12, `${sheet}_${String(frame + 1).padStart(3, '0')}`, labelStyle).setOrigin(0, 0);
          this.add.text(x - 45, y + 28, `${meta.width}x${meta.height} @ ${meta.anchor.x},${meta.anchor.y}`, labelStyle).setOrigin(0, 0);
        }
        y += 128;
      }

      y += 10;
    }

    this.add.text(12, y, 'Projectile textures', { ...labelStyle, color: '#8de6ff' }).setOrigin(0, 0);
    [
      { key: 'sound_wave', x: 92, row: 0 },
      { key: 'feedback_wave', x: 204, row: 0 },
      { key: 'cardbross_cross', x: 316, row: 0 },
      { key: 'hi_vis_vest', x: 428, row: 0 },
      { key: 'bucket_wave', x: 540, row: 0 },
      { key: 'apple_shards', x: 652, row: 0 },
      { key: 'martin_firebolt', x: 92, row: 1 },
      { key: 'martin_ink_spark', x: 250, row: 1 },
      { key: 'martin_ground_rune', x: 408, row: 1 },
      { key: 'martin_lightning_from_sky', x: 594, row: 1 },
      { key: 'purple_note_wave', x: 92, row: 2 },
      { key: 'foam_wave', x: 286, row: 2 },
      { key: 'juggling_balls', x: 480, row: 2 },
      { key: 'squeak_storm', x: 674, row: 2 },
      { key: 'rubber_bat', x: 92, row: 3 },
      { key: 'red_note_wave', x: 250, row: 3 },
      { key: 'demi_laser', x: 408, row: 3 },
      { key: 'morph_flash', x: 594, row: 3 },
      { key: 'remote_spark', x: 92, row: 4 },
    ].forEach(({ key, x, row }) => {
      const texture = this.textures.get(key).getSourceImage() as { width: number; height: number };
      const scale = Math.min(0.75, 86 / Math.max(texture.width, texture.height));
      const rowY = y + 34 + row * 82;
      this.add.image(x, rowY, key).setOrigin(0.5).setScale(scale);
      this.add.text(x - 42, rowY + 28, key, labelStyle).setOrigin(0, 0);
    });

    this.cameras.main.setBounds(0, 0, 800, Math.max(450, y + 350));
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
      this.cameras.main.scrollY = Phaser.Math.Clamp(this.cameras.main.scrollY + dy * 0.7, 0, Math.max(0, y - 100));
    });
  }

  private installDebugHooks(): void {
    const win = window as typeof window & {
      __stamptownDebug?: {
        startMove: (player: 1 | 2, moveId: string) => boolean;
        setCpu: (enabled: boolean) => void;
        frame: () => number;
        control: () => ReturnType<ControlTelemetry['snapshot']>;
        snapshot: () => unknown;
        summons: () => unknown;
        training?: { reset: (x1: number, x2: number) => void; step: (ticks: number) => void; form:(player:1|2,id:string)=>boolean; power:(player:1|2,power:import('../schema/types').PowerUpSpec)=>boolean; damage:(player:1|2,amount:number)=>void };
      };
    };
    win.__stamptownDebug = {
      startMove: (player, moveId) => this.fighters[player - 1].debugStartMove(moveId),
      setCpu: (enabled) => {
        this.singlePlayer = enabled;
      },
      frame: () => this.frameCounter,
      control: () => this.controlTelemetry.snapshot(),
      summons: () => this.fighters.map(f=>f.controlledSummon?{...f.controlledSummon}:null),
      snapshot: () => ({ frame: this.frameCounter, paused: this.isPaused, cpu: this.singlePlayer, impacts:this._combatImpacts.map(i=>({id:i.spec.id,kind:i.spec.kind,blocked:i.blocked,age:i.age})), fighters: this.fighters.map(f => ({ id: f.config.id, baseId:f.baseConfig.id, form:f.activeForm?.id,formTicks:f.formTicks,stats:f.stats,meter:f.meter,powers:f.powers.map(p=>({id:p.spec.id,remaining:p.remaining})),combo:{hits:f.combo.hits,damage:f.combo.damage,active:f.combo.active,juggle:f.combo.juggle},texture:f.body instanceof Phaser.GameObjects.Sprite?f.body.texture.key:null,moveIds:f.config.moves.map(m=>m.id),hurtbox:f.getHurtboxWorld(),x: f.x, y: f.y, vx: f.vx, vy: f.vy, health: f.health, state: f.state, frame: f.stateFrame, move: f.currentMove?.id, animation: f.currentMove?.animation, phase: f.movePhaseIndex, hold: f.grabHold?.remaining, heldBy: f.grabbedBy?.config.id, immunity: f.grabImmunity, stun: f.hitstun })), projectiles: this.projectiles.active.map(p=>({id:p.config.id,x:p.x,y:p.y,facing:p.facing,delay:p.delayRemaining})) }),
    };
    if (new URLSearchParams(window.location.search).get('training') === '1') {
      win.__stamptownDebug.training = {
        form:(player,id)=>this.fighters[player-1].enterForm(id),
        power:(player,power)=>this.fighters[player-1].applyPowerUp(power),
        damage:(player,amount)=>{const f=this.fighters[player-1];f.health=Math.max(0,f.health-amount);if(!f.health)f.changeState('dead');f.refreshVisuals();},
        reset: (x1, x2) => {
          this.controlTelemetry.reset();
          this.singlePlayer = false; this.isPaused = true; this.roundResolved = false; this.roundTimer = ROUND_FRAMES; this.hitPauseFrames = 0;
          this.projectiles.clear();
          InputReader.reset(this.input.keyboard!);
          this._combatImpacts=[];
          this.fighters.forEach((f,i) => { f.resetAdvanced(); f.changeState('idle'); f.x=i ? x2:x1; f.y=FLOOR_Y; f.vx=0; f.vy=0; f.grounded=true; f.facing=i ? -1:1; f.health=f.config.maxHealth; f.grabImmunity=0; f.invulnerable=null; f.armor=null; f.inputBuffer.clear(); f.refreshVisuals(); });
        },
        step: ticks => { this.isPaused=false; for(let i=0;i<Math.min(600,Math.max(0,ticks));i++) this.fixedUpdate(); this.isPaused=true; this.renderFrame(); },
      };
    }
  }

  private createOdditiesStage(): void {
    const g = this.add.graphics().setDepth(-5);
    g.fillStyle(0x0e2029).fillRect(0,80,800,308);
    // Code-native stage geometry: a submerged industrial observatory.
    g.fillStyle(0x17323b).fillRect(42,118,716,252);
    for (let x=56;x<800;x+=116) {
      g.fillStyle(0x213e43).fillRect(x,114,78,220);
      g.fillStyle(0x31504d).fillRect(x+5,120,68,150);
      g.fillStyle(0x294541).fillRect(x+5,193,68,7);
      g.fillStyle(0x142c34).fillRect(x+35,120,6,216);
      g.fillStyle(0x102830).fillRect(x+80,90,22,300);
      g.fillStyle(0x49655a).fillRect(x+77,92,28,7);
    }
    g.fillStyle(0x18313b).fillRect(0,330,800,58);
    for(let x=0;x<800;x+=48) { g.fillStyle(0x294047).fillRect(x,343,40,5); g.fillStyle(0x294047).fillRect(x+12,361,40,5); }
    g.fillStyle(0x426258).fillRect(0,386,800,4);
    this.add.text(400,110,'THE TIDELINE  /  EXHIBITION 01',{fontFamily:'monospace',fontSize:'10px',color:'#95b9a7',letterSpacing:2}).setOrigin(.5).setDepth(-4);
    this.add.text(400,425,prefersTouchControls()?'HOLD AWAY TO GUARD    ·    DIRECTION + SPECIAL FOR VARIANTS':'F / G  STRIKE     H  SIGNATURE     ↓ + H  ALT     F + G  GRAB',{fontFamily:'monospace',fontSize:'10px',color:'#a3b7aa'}).setOrigin(.5).setDepth(20);
    this.add.text(20,68,this.fighters[0].config.displayName.toUpperCase(),{fontFamily:'monospace',fontSize:'12px',color:'#f49d79'}).setDepth(50);
    this.add.text(780,68,this.fighters[1].config.displayName.toUpperCase(),{fontFamily:'monospace',fontSize:'12px',color:'#89d8c6'}).setOrigin(1,0).setDepth(50);
  }

  private assetUrl(path: string): string {
    const requestedVersion = new URLSearchParams(window.location.search).get('v');
    const version = encodeURIComponent(requestedVersion || SPRITE_ASSET_VERSION);
    return `${path}?v=${version}`;
  }

  private characterFromParam(id: string | null, fallback: CharacterConfig): CharacterConfig {
    if (!id) return fallback;
    return roster.find((character) => character.id === id) ?? fallback;
  }

  private debugFrameMeta(sprite: CharacterSpriteConfig, sheet: SpriteSheetId, frameCount: number): SpriteFrameMeta[] {
    const configured = sprite.frames?.[sheet];
    if (configured) return configured;

    const width = sprite.frameWidth ?? 256;
    const height = sprite.frameHeight ?? 256;
    return Array.from({ length: frameCount }, (_, index) => ({
      file: `sprites/${sheet}/${sheet}_${String(index + 1).padStart(3, '0')}.png`,
      width,
      height,
      anchor: {
        x: width / 2,
        y: (sprite.anchorY ?? 1) * height,
      },
    }));
  }

  private resolveFighterSpacing(): void {
    // A held fighter is position-locked to the grabber; pushing them apart
    // would fight the grab every frame.
    if (this.fighters.some((fighter) => fighter.state === 'grabbed')) return;
    const [leftFighter, rightFighter] =
      this.fighters[0].x <= this.fighters[1].x ? this.fighters : [this.fighters[1], this.fighters[0]];
    const minimumDistance = ((leftFighter.config.pushboxWidth ?? MIN_FIGHTER_DISTANCE)*leftFighter.stats.size + (rightFighter.config.pushboxWidth ?? MIN_FIGHTER_DISTANCE)*rightFighter.stats.size) / 2;
    if (Math.abs(leftFighter.y - rightFighter.y) > 104) return;
    const overlap = minimumDistance - (rightFighter.x - leftFighter.x);
    if (overlap <= 0) return;

    const midpoint = (leftFighter.x + rightFighter.x) / 2;
    let leftX = midpoint - minimumDistance / 2;
    let rightX = midpoint + minimumDistance / 2;

    if (leftX < STAGE_LEFT) {
      leftX = STAGE_LEFT;
      rightX = STAGE_LEFT + minimumDistance;
    } else if (rightX > STAGE_RIGHT) {
      rightX = STAGE_RIGHT;
      leftX = STAGE_RIGHT - minimumDistance;
    }

    leftFighter.x = leftX;
    rightFighter.x = rightX;
    leftFighter.refreshVisuals();
    rightFighter.refreshVisuals();
  }
}
