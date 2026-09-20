import Phaser from 'phaser';
import { Fighter } from '../core/Fighter';
import { HitboxSystem } from '../core/HitboxSystem';
import { ProjectilePool } from '../core/ProjectilePool';
import { InputReader } from '../core/InputReader';
import { InputBuffer } from '../core/InputBuffer';
import { GameLoop } from '../core/GameLoop';
import { CombatVisuals, createCombatTextures } from '../core/CombatVisuals';
import type { CharacterConfig, RawInput, SpriteSheetId } from '../schema/types';
import type { AABB } from '../util/aabb';

// Mirror the engine's internal stage constants (Fighter.ts) so the testbed
// floor and bounds line up with where fighters actually stand.
const FLOOR_Y = 390;
const CANVAS_W = 800;
const CANVAS_H = 450;
const PLAYER_X = 250;
const DUMMY_X = 540;
const SLOW_DIVISOR = 6; // ~10 logic fps in slow-mo

const NEUTRAL: RawInput = {
  left: false, right: false, up: false, down: false,
  lp: false, mp: false, hp: false, lk: false, mk: false, hk: false,
  lpPrev: false, mpPrev: false, hpPrev: false, lkPrev: false, mkPrev: false, hkPrev: false,
};

export type PlaybackMode = 'play' | 'pause' | 'slow';
export type DummyMode = 'post' | 'reactive';

export type HitboxReadout = {
  id: string;
  local: { x: number; y: number; width: number; height: number };
  world: AABB;
  damage: number;
  reach: number;
};

export type TestbedSnapshot = {
  ready: boolean;
  frame: number;
  mode: PlaybackMode;
  state: string;
  move: string | null;
  movePhase: number;
  movePhaseFrame: number;
  facing: 1 | -1;
  playerHp: number;
  dummyHp: number;
  dummyMaxHp: number;
  dummySize: number;
  dummyState: string;
  distance: number;
  hitboxes: HitboxReadout[];
  error: string | null;
};

type Payload = {
  config: CharacterConfig;
  frameUrls: Partial<Record<SpriteSheetId, string[]>>;
  projectileUrls?: Record<string, string>;
};

export class TestbedScene extends Phaser.Scene {
  // FighterScene contract.
  projectiles!: ProjectilePool;
  hitPauseFrames = 0;
  _soundsPlayedThisFrame = new Set<string>();
  // Read by some move events that look up the opponent on the scene.
  fighters!: [Fighter, Fighter];

  private readonly payload: Payload;
  private readonly loop = new GameLoop();

  private player!: Fighter;
  private dummy!: Fighter;
  private debugGfx!: Phaser.GameObjects.Graphics;
  private combatVisuals!: CombatVisuals;
  private dummyAnchorX = DUMMY_X;
  private dummyDistance = DUMMY_X - PLAYER_X;
  private dummySize = 1;

  private mode: PlaybackMode = 'play';
  private dummyMode: DummyMode = 'post';
  private stepQueued = 0;
  private frame = 0;
  private ready = false;
  private lastError: string | null = null;

  private snapshot: TestbedSnapshot = emptySnapshot();

  constructor(payload: Payload) {
    super('Testbed');
    this.payload = payload;
  }

  preload(): void {
    const { config, frameUrls, projectileUrls } = this.payload;
    for(const form of config.forms??[]) {
      const sprite=form.config.sprite;
      for(const [sheet,frames] of Object.entries(sprite?.frames??{}))frames?.forEach((frame,index)=>this.load.image(`${form.config.id}:${sheet}:${index}`,`${sprite!.basePath}/${frame.file}`));
    }
    for (const sheet of Object.keys(frameUrls) as SpriteSheetId[]) {
      const urls = frameUrls[sheet] ?? [];
      urls.forEach((url, index) => {
        if (url) this.load.image(`${config.id}:${sheet}:${index}`, url);
      });
    }
    // Multi-actor packs may share frame files, but each actor has its own keys.
    const urlsByFile=new Map<string,string>();
    for(const [sheet,frames] of Object.entries(config.sprite?.frames??{}))frames?.forEach((f,i)=>{const url=frameUrls[sheet]?.[i];if(url)urlsByFile.set(f.file,url);});
    for(const actor of config.actors??[])for(const [sheet,frames] of Object.entries(actor.sprite?.frames??{}))frames?.forEach((frame,index)=>{
      const url=urlsByFile.get(frame.file)??`${actor.sprite!.basePath}/${frame.file}`;
      this.load.image(`${config.id}:${actor.id}:${sheet}:${index}`,url);
    });
    // Load projectile textures keyed by `projectile.animation` so ProjectilePool
    // renders the generated sprite instead of a fallback rectangle.
    for (const [animation, url] of Object.entries(projectileUrls ?? {})) {
      if (url) this.load.image(animation, url);
    }
  }

  create(): void {
    this.loop.reset();
    if (this.input.keyboard) InputReader.reset(this.input.keyboard);
    const clearTimingAndInput = (): void => {
      this.loop.reset();
      if (this.input.keyboard) InputReader.reset(this.input.keyboard);
    };
    this.game.events.on(Phaser.Core.Events.BLUR, clearTimingAndInput);
    this.game.events.on(Phaser.Core.Events.FOCUS, clearTimingAndInput);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, clearTimingAndInput);
      this.game.events.off(Phaser.Core.Events.FOCUS, clearTimingAndInput);
    });
    this.cameras.main.setBackgroundColor('#141820');
    this.drawStage();

    this.projectiles = new ProjectilePool(this);
    createCombatTextures(this,[this.payload.config,...(this.payload.config.forms??[]).map(f=>f.config)]);
    this.combatVisuals=new CombatVisuals(this);
    this.player = new Fighter(this, this.payload.config, 1, { x: PLAYER_X, y: FLOOR_Y });
    this.dummy = new Fighter(this, structuredClone(this.payload.config), 2, { x: this.dummyAnchorX, y: FLOOR_Y });
    this.applyDummySize();
    this.fighters = [this.player, this.dummy];

    this.debugGfx = this.add.graphics().setDepth(60);

    this.input.keyboard?.addCapture(['SPACE', 'PERIOD']);
    this.input.keyboard?.on('keydown-SPACE', () => this.togglePause());
    this.input.keyboard?.on('keydown-PERIOD', () => this.step());
    this.input.keyboard?.on('keydown-R', () => this.reset());

    this.ready = true;
  }

  update(time: number): void {
    if (!this.ready) return;

    if (this.mode === 'play' || this.mode === 'slow') {
      this.loop.update(time, () => this.fixedStep(), this.mode === 'slow' ? 1 / SLOW_DIVISOR : 1);
    } else if (this.stepQueued > 0) {
      this.stepQueued -= 1;
      this.fixedStep();
    }

    this.renderOverlay();
    this.combatVisuals.draw(this.fighters);
    this.updateSnapshot();
  }

  private fixedStep(): void {
    // A WIP draft can carry data the engine chokes on. Catch it, pause, and
    // surface the message instead of silently freezing the whole testbed.
    try {
      this.fixedStepInner();
    } catch (error) {
      this.lastError = (error as Error).message ?? String(error);
      this.setMode('pause');
    }
  }

  private fixedStepInner(): void {
    this._soundsPlayedThisFrame.clear();

    if (this.hitPauseFrames > 0) {
      this.hitPauseFrames -= 1;
      return;
    }

    // In "post" mode the dummy is a fixed measuring target — pin it before it
    // updates so reach readings stay stable.
    if (this.dummyMode === 'post') this.pinDummy();

    const playerInput = this.input.keyboard ? InputReader.read(1, this.input.keyboard) : NEUTRAL;
    this.player.update(playerInput, this.dummy, this.projectiles);
    this.dummy.update(NEUTRAL, this.player, this.projectiles);

    this.projectiles.update();
    this.combatVisuals.tick();
    HitboxSystem.checkAll(this.fighters, this.projectiles);

    // Invincible dummy: keep it alive so you can keep landing moves.
    this.dummy.health = this.payload.config.maxHealth;
    if (this.dummy.state === 'dead') this.dummy.changeState('idle');

    this.frame += 1;
  }

  private pinDummy(): void {
    this.dummy.x = this.dummyAnchorX;
    this.dummy.vx = 0;
    this.dummy.vy = 0;
    this.dummy.grounded = true;
    this.dummy.y = FLOOR_Y;
    if (this.dummy.state !== 'idle') this.dummy.changeState('idle');
  }

  private drawStage(): void {
    const g = this.add.graphics().setDepth(-5);
    g.fillStyle(0x20262f, 1).fillRect(0, FLOOR_Y, CANVAS_W, CANVAS_H - FLOOR_Y);
    g.lineStyle(2, 0x9aa8bb, 1).lineBetween(0, FLOOR_Y, CANVAS_W, FLOOR_Y);
    // Ruler ticks every 50px to eyeball reach/spacing.
    g.lineStyle(1, 0x3a4452, 1);
    for (let x = 0; x <= CANVAS_W; x += 50) {
      const tall = x % 100 === 0;
      g.lineBetween(x, FLOOR_Y, x, FLOOR_Y + (tall ? 14 : 7));
    }
  }

  private renderOverlay(): void {
    const g = this.debugGfx;
    g.clear();

    this.drawFighterBoxes(g, this.dummy, 0x6b7686, 0x9aa8bb);
    this.drawFighterBoxes(g, this.player, 0x4a90d9, 0x6fb3ff);

    // Player hitboxes on top, vivid.
    for (const active of this.player.getActiveHitboxesWorld()) {
      this.drawBox(g, active.world, 0xff5252, 0.34, 2);
    }
    for (const grab of this.player.getActiveGrabsWorld()) {
      this.drawBox(g, grab.world, 0x37d67a, 0.3, 2);
    }
    for (const projectile of this.projectiles.active) {
      this.drawBox(g, this.projectiles.getHitboxWorld(projectile), 0xffa64d, 0.3, 1);
    }

    // Anchor crosshairs (feet pivot).
    this.drawAnchor(g, this.player.x, this.player.y, 0x6fb3ff);
    this.drawAnchor(g, this.dummy.x, this.dummy.y, 0x9aa8bb);
  }

  private drawFighterBoxes(
    g: Phaser.GameObjects.Graphics,
    fighter: Fighter,
    fill: number,
    stroke: number,
  ): void {
    for (const hurtbox of fighter.getHurtboxesWorld()) {
      this.drawBox(g, hurtbox.world, fill, 0.18, 1, stroke);
    }
  }

  private drawBox(
    g: Phaser.GameObjects.Graphics,
    box: AABB,
    color: number,
    fillAlpha: number,
    lineWidth: number,
    strokeColor = color,
  ): void {
    g.fillStyle(color, fillAlpha).fillRect(box.x, box.y, box.width, box.height);
    g.lineStyle(lineWidth, strokeColor, 0.95).strokeRect(box.x, box.y, box.width, box.height);
  }

  private drawAnchor(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    g.lineStyle(1, color, 0.85);
    g.lineBetween(x - 7, y, x + 7, y);
    g.lineBetween(x, y - 7, x, y + 7);
  }

  private updateSnapshot(): void {
    const move = this.player.currentMove;
    const hitboxes: HitboxReadout[] = this.player.getActiveHitboxesWorld().map((active) => ({
      id: active.id,
      local: {
        x: active.hitbox.x,
        y: active.hitbox.y,
        width: active.hitbox.width,
        height: active.hitbox.height,
      },
      world: active.world,
      damage: active.hitbox.damage,
      reach: this.player.facing === 1
        ? active.world.x + active.world.width - this.player.x
        : this.player.x - active.world.x,
    }));

    this.snapshot = {
      ready: true,
      frame: this.frame,
      mode: this.mode,
      state: this.player.state,
      move: move?.id ?? null,
      movePhase: this.player.movePhaseIndex,
      movePhaseFrame: this.player.movePhaseFrame,
      facing: this.player.facing,
      playerHp: Math.ceil(this.player.health),
      dummyHp: Math.ceil(this.dummy.health),
      dummyMaxHp: this.payload.config.maxHealth,
      dummySize: this.dummy.stats.size,
      dummyState: this.dummy.state,
      distance: Math.round(Math.abs(this.dummy.x - this.player.x)),
      hitboxes,
      error: this.lastError,
    };
  }

  // ---- Public API (driven by the page UI) ----

  getSnapshot(): TestbedSnapshot {
    return this.snapshot;
  }

  triggerMove(moveId: string): void {
    if (!this.ready) return;
    this.player.debugStartMove(moveId);
  }

  setMode(mode: PlaybackMode): void {
    this.mode = mode;
    this.loop.reset();
    this.stepQueued = 0;
    if (this.input.keyboard) InputReader.reset(this.input.keyboard);
  }

  togglePause(): void {
    this.setMode(this.mode === 'pause' ? 'play' : 'pause');
  }

  step(): void {
    if (this.mode !== 'pause') this.setMode('pause');
    this.stepQueued += 1;
  }

  setDummyMode(mode: DummyMode): void {
    this.dummyMode = mode;
    if (mode === 'post' && this.ready) this.pinDummy();
  }

  setDummyDistance(distance: number): void {
    this.dummyDistance = Phaser.Math.Clamp(distance, 40, 420);
    this.dummyAnchorX = Phaser.Math.Clamp((this.player?.x ?? PLAYER_X) + this.dummyDistance, 96, 704);
    if(this.dummy)this.dummy.x = this.dummyAnchorX;
  }

  setDummySize(size: number): void {
    if (![0.7, 1, 1.4].includes(size)) return;
    this.dummySize = size;
    if (this.ready) { this.reset(); this.applyDummySize(); }
  }

  private applyDummySize(): void {
    this.dummy.baseConfig.stats = { ...this.payload.config.stats, size: (this.payload.config.stats?.size ?? 1) * this.dummySize };
    this.dummy.refreshVisuals();
  }

  reset(): void {
    if (!this.ready) return;
    this.loop.reset();
    this.stepQueued = 0;
    if (this.input.keyboard) InputReader.reset(this.input.keyboard);
    this.hitPauseFrames = 0;
    this.frame = 0;
    this.lastError = null;
    this.projectiles.clear();

    this.resetFighter(this.player, PLAYER_X);
    this.dummyAnchorX = Phaser.Math.Clamp(PLAYER_X + this.dummyDistance, 96, 704);
    this.resetFighter(this.dummy, this.dummyAnchorX);
  }

  private resetFighter(fighter: Fighter, x: number): void {
    fighter.resetAdvanced();
    fighter.inputBuffer = new InputBuffer();
    fighter.stateFrame = 0;
    fighter.x = x;
    fighter.y = FLOOR_Y;
    fighter.vx = 0;
    fighter.vy = 0;
    fighter.grounded = true;
    fighter.health = this.payload.config.maxHealth;
    fighter.hitstun = 0;
    fighter.blockstun = 0;
    fighter.currentMove = null;
    fighter.activeHitboxes.clear();
    fighter.activeGrabs.clear();
    fighter.changeState('idle');
    fighter.refreshVisuals();
  }
}

function emptySnapshot(): TestbedSnapshot {
  return {
    ready: false,
    frame: 0,
    mode: 'play',
    state: 'idle',
    move: null,
    movePhase: 0,
    movePhaseFrame: 0,
    facing: 1,
    playerHp: 0,
    dummyHp: 0,
    dummyMaxHp: 0,
    dummySize: 1,
    dummyState: 'idle',
    distance: 0,
    hitboxes: [],
    error: null,
  };
}
