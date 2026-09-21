import Phaser from 'phaser';
import { Fighter } from '../core/Fighter';
import { HitboxSystem } from '../core/HitboxSystem';
import { HitResolver } from '../core/HitResolver';
import { scenarioPositions, type ScenarioLayout } from './scenarioLayout';
import { ProjectilePool } from '../core/ProjectilePool';
import { InputReader } from '../core/InputReader';
import { InputBuffer } from '../core/InputBuffer';
import { GameLoop } from '../core/GameLoop';
import {MoveExecutor} from '../core/MoveExecutor';
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
  summonTicks: number | null;
  holdTicks: number | null;
  intervention: string;
  distance: number;
  hitboxes: HitboxReadout[];
  error: string | null;
  comboPreview: string;
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
  private layout: ScenarioLayout = 'center-right';
  private intervention = 'None';
  private interventionSerial = 0;

  private mode: PlaybackMode = 'play';
  private dummyMode: DummyMode = 'post';
  private stepQueued = 0;
  private frame = 0;
  private ready = false;
  private lastError: string | null = null;
  private previewRoute: {moves:string[];index:number;ticks:number;contacts:Set<number>;strict:boolean} | null=null;
  private previewStatus='Select a combo to preview the full sequence.';

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
    // Phaser captures both players' arrows globally. Editor inputs must keep
    // native keyboard behavior (especially the distance slider and selects).
    const editing=(target:EventTarget|null)=>target instanceof HTMLElement&&Boolean(target.closest('input,textarea,select,[contenteditable="true"]'));
    const guardEditorKey=(event:KeyboardEvent)=>{if(editing(event.target))event.stopPropagation();};
    const editorFocus=(event:FocusEvent)=>{if(editing(event.target))clearTimingAndInput();};
    document.addEventListener('keydown',guardEditorKey,true);
    document.addEventListener('keyup',guardEditorKey,true);
    document.addEventListener('focusin',editorFocus);
    document.addEventListener('focusout',editorFocus);
    this.game.canvas.tabIndex=0;
    this.game.events.on(Phaser.Core.Events.BLUR, clearTimingAndInput);
    this.game.events.on(Phaser.Core.Events.FOCUS, clearTimingAndInput);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('keydown',guardEditorKey,true);
      document.removeEventListener('keyup',guardEditorKey,true);
      document.removeEventListener('focusin',editorFocus);
      document.removeEventListener('focusout',editorFocus);
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
    this.reset();
    window.parent.postMessage({type:'studio-preview-ready'},location.origin);
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

    this.tickComboPreview();

    const editing=document.activeElement instanceof HTMLElement&&document.activeElement.matches('input,textarea,select,[contenteditable="true"]');
    const playerInput = !this.previewRoute && !editing && this.input.keyboard ? InputReader.read(1, this.input.keyboard) : NEUTRAL;
    this.player.update(playerInput, this.dummy, this.projectiles);
    this.dummy.update(NEUTRAL, this.player, this.projectiles);

    this.projectiles.update();
    this.combatVisuals.tick();
    HitboxSystem.checkAll(this.fighters, this.projectiles);
    if(this.previewRoute && this.player.contactThisMove)this.previewRoute.contacts.add(this.previewRoute.index);

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
      summonTicks: this.player.controlledSummon?.remaining ?? null,
      holdTicks: this.dummy.grabHold?.remaining ?? null,
      intervention: this.intervention,
      distance: Math.round(Math.abs(this.dummy.x - this.player.x)),
      hitboxes,
      error: this.lastError,
      comboPreview:this.previewStatus,
    };
  }

  // ---- Public API (driven by the page UI) ----

  getSnapshot(): TestbedSnapshot {
    return this.snapshot;
  }

  triggerMove(moveId: string): void {
    if (!this.ready) return;
    this.previewRoute=null;
    this.player.debugStartMove(moveId);
  }

  previewCombo(ids:string[], strict=false):void {
    if(!this.ready)return;
    if(ids.length<2 || ids.length>32 || ids.some(id=>!this.payload.config.moves.some(m=>m.id===id))){this.previewStatus='Cannot preview: the combo contains a missing move or invalid length.';return;}
    this.reset();this.dummyMode='reactive';this.setMode('play');
    this.previewRoute={moves:[...ids],index:-1,ticks:0,contacts:new Set(),strict};
    this.previewStatus=`Starting ${strict?'hit-confirm route':'motion sequence'}…`;
  }

  private tickComboPreview():void {
    const route=this.previewRoute;if(!route)return;
    if(++route.ticks>1800 || this.player.state==='dead' || ['hitstun','stunned','grabbed','juggle'].includes(this.player.state)){
      this.previewStatus='Preview stopped: interrupted or timed out.';this.previewRoute=null;return;
    }
    const nextId=route.moves[route.index+1];
    if(!nextId){
      if(!this.player.currentMove){this.previewStatus=`Sequence complete · ${route.moves.length} moves · ${route.contacts.size} made contact. ${route.strict?'Engine cancel rules respected.':'Full-move playback; this is not proof of an unbroken combo.'}`;this.previewRoute=null;}return;
    }
    const next=this.payload.config.moves.find(m=>m.id===nextId)!;
    if((next.controlledActor??null)!==(this.player.controlledSummon?.actor??null)){
      // A summon may appear later in the current move; wait until it resolves.
      if(this.player.currentMove)return;
      this.previewStatus=`Stopped before ${next.displayName}: required controlled entity is not active.`;this.previewRoute=null;return;
    }
    if(this.player.currentMove){
      if(route.strict&&MoveExecutor.tryCancel(this.player,next)){
        route.index++;this.previewStatus=`${route.index+1}/${route.moves.length} · ${next.displayName} · legal engine cancel`;
      }
      return;
    }
    if(route.index>=0&&(route.strict||next.trigger.cancelOnly)){
      this.previewStatus=`Route stopped before ${next.displayName}: no legal cancel in these conditions. Adjust distance or use Sequence to inspect every move.`;this.previewRoute=null;return;
    }
    if(this.player.meter<(next.cost?.meter??0)){this.previewStatus=`Stopped before ${next.displayName}: insufficient meter.`;this.previewRoute=null;return;}
    if(!['idle','crouch','airborne'].includes(this.player.state))return;
    this.player.debugStartMove(nextId);route.index++;
    this.previewStatus=`${route.index+1}/${route.moves.length} · ${next.displayName} · ${route.strict?'engine route':'full move sequence'}`;
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
    if (this.ready) this.reset();
  }

  setScenarioLayout(layout: ScenarioLayout): void {
    if (!['center-right', 'center-left', 'right-wall', 'left-wall'].includes(layout)) return;
    this.layout = layout;
    if (this.ready) this.reset();
  }

  injectInterruption(): void {
    if (!this.ready) return;
    const hit = HitResolver.resolve(this.dummy, this.player, {
      x: 0, y: -100, width: 40, height: 100, damage: 1,
      hitstun: 6, stun: 6, blockstun: 0, knockback: { x: 0, y: 0 }, unblockable: true,
    }, `testbed-interruption-${++this.interventionSerial}`);
    this.intervention = hit ? 'Injected hit · 6 ticks' : 'Injected hit rejected by engine';
  }

  forceKO(): void {
    if (!this.ready) return;
    this.player.health = 0;
    this.player.changeState('dead');
    this.player.refreshVisuals();
    this.intervention = 'Forced summoner KO';
  }

  expireSummon(): void {
    if (!this.ready || !this.player.controlledSummon) return;
    this.player.controlledSummon.remaining = 1;
    this.intervention = 'Timer set to 1 · expires on next tick';
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
    this.previewRoute=null;this.previewStatus='Ready for combo preview.';
    this.intervention = 'None';
    this.projectiles.clear();

    const positions = scenarioPositions(this.layout, this.dummyDistance);
    this.resetFighter(this.player, positions.playerX);
    this.dummyAnchorX = positions.dummyX;
    this.resetFighter(this.dummy, this.dummyAnchorX);
    this.player.facing = positions.facing;
    this.dummy.facing = positions.facing === 1 ? -1 : 1;
    this.player.refreshVisuals();
    this.dummy.refreshVisuals();
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
    comboPreview:'Loading engine…',
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
    summonTicks: null,
    holdTicks: null,
    intervention: 'None',
    distance: 0,
    hitboxes: [],
    error: null,
  };
}
