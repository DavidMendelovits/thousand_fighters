import Phaser from 'phaser';
import { InputBuffer } from './InputBuffer';
import { MoveExecutor } from './MoveExecutor';
import type { ProjectilePool } from './ProjectilePool';
import type {
  CharacterConfig,
  FighterActorConfig,
  FighterActorId,
  FighterScene,
  FighterState,
  Hitbox,
  Hurtbox,
  Move,
  RawInput,
  SpriteFrameMeta,
  SpriteSheetId,
} from '../schema/types';
import { boxToWorld, type AABB } from '../util/aabb';

const STAGE_LEFT = 96;
const STAGE_RIGHT = 704;
const FLOOR_Y = 390;
const FIGHTER_WIDTH = 60;
const FIGHTER_HEIGHT = 120;
const MOVE_SHEETS = new Set<SpriteSheetId>(['punch', 'kick', 'special_1', 'special_2']);

type ActiveHitbox = {
  actorId?: FighterActorId;
  hitbox: Hitbox;
};

type ActorPose = {
  x: number;
  y: number;
  facing: 1 | -1;
};

type ActorOverride = {
  offsetX: number;
  offsetY: number;
  duration: number | null;
};

type FollowDelayOverride = {
  frames: number;
  duration: number | null;
};

type FighterActorRuntime = {
  id: FighterActorId;
  config: FighterActorConfig;
  body: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite;
};

export class Fighter {
  id: string;
  config: CharacterConfig;
  playerNum: 1 | 2;
  scene: FighterScene;

  x: number;
  y: number;
  vx = 0;
  vy = 0;
  facing: 1 | -1;
  grounded = true;

  state: FighterState = 'idle';
  stateFrame = 0;

  health: number;
  hitstun = 0;
  blockstun = 0;

  invulnerable: { duration: number; against: string[] } | null = null;
  armor: { hits: number; duration: number } | null = null;
  hurtboxOverride: Hurtbox | null = null;
  hurtboxDisabled = false;
  actorHurtboxOverrides = new Map<FighterActorId, Hurtbox | null>();

  currentMove: Move | null = null;
  movePhaseIndex = 0;
  movePhaseFrame = 0;
  activeHitboxes = new Map<string, ActiveHitbox>();
  hasHitThisMove = new Set<string>();

  inputBuffer = new InputBuffer();
  animationKey = 'idle';

  readonly body: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite;
  readonly label: Phaser.GameObjects.Text;

  private readonly actors = new Map<FighterActorId, FighterActorRuntime>();
  private readonly actorOrder: FighterActorId[] = [];
  private readonly actorOffsetOverrides = new Map<FighterActorId, ActorOverride>();
  private readonly followDelayOverrides = new Map<FighterActorId, FollowDelayOverride>();
  private poseHistory: ActorPose[] = [];
  private fusionFrames = 0;
  private leadSwapped = false;
  private readonly maxPoseHistory = 90;

  constructor(scene: FighterScene, config: CharacterConfig, playerNum: 1 | 2, position: { x: number; y: number }) {
    this.scene = scene;
    this.id = `${config.id}-p${playerNum}`;
    this.config = config;
    this.playerNum = playerNum;
    this.x = position.x;
    this.y = position.y;
    this.facing = playerNum === 1 ? 1 : -1;
    this.health = config.maxHealth;

    const fill = playerNum === 1 ? 0xd44949 : 0x426edb;
    this.body = this.createActors(fill);
    this.poseHistory = Array.from({ length: this.maxPoseHistory }, () => ({ x: this.x, y: this.y, facing: this.facing }));
    this.label = scene.add
      .text(this.x, this.y - FIGHTER_HEIGHT - 24, '', {
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '12px',
      })
      .setOrigin(0.5, 1);
  }

  update(input: RawInput, opponent: Fighter, projectiles: ProjectilePool): void {
    void projectiles;
    if (this.state === 'dead') {
      this.syncVisuals();
      return;
    }

    this.tickModifiers();
    this.inputBuffer.record(input, this.facing);
    this.autoFace(opponent);
    this.runState(input);
    this.applyPhysics();
    this.keepInStage();
    this.recordPose();
    this.stateFrame += 1;
    this.syncVisuals();
  }

  changeState(next: FighterState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateFrame = 0;
    this.animationKey = this.config.animations[next] ?? next;

    if (next !== 'attack') {
      this.currentMove = null;
      this.movePhaseIndex = 0;
      this.movePhaseFrame = 0;
      this.activeHitboxes.clear();
      this.hurtboxOverride = null;
      this.hurtboxDisabled = false;
      this.clearActorMoveOverrides();
    }
  }

  getHurtboxWorld(): AABB | null {
    return this.getHurtboxesWorld()[0]?.world ?? null;
  }

  getHurtboxesWorld(): Array<{ actorId: FighterActorId; world: AABB }> {
    if (this.hurtboxDisabled) return [];
    return this.activeCollisionActors().flatMap((actor) => {
      const override = this.actorHurtboxOverrides.has(actor.id) ? this.actorHurtboxOverrides.get(actor.id) : undefined;
      if (override === null) return [];
      const hurtbox = override ?? actor.config.hurtboxes?.[this.state] ?? actor.config.hurtboxes?.idle ?? this.hurtboxOverride ?? this.config.hurtboxes[this.state] ?? this.config.hurtboxes.idle;
      if (!hurtbox) return [];
      const pose = this.actorPose(actor);
      return [{ actorId: actor.id, world: boxToWorld(hurtbox, pose.x, pose.y, pose.facing) }];
    });
  }

  getActiveHitboxesWorld(): Array<{ actorId: FighterActorId; id: string; hitbox: Hitbox; world: AABB }> {
    return [...this.activeHitboxes.entries()].map(([id, active]) => {
      const actor = this.actorFor(this.fusionFrames > 0 ? this.primaryActorId() : (active.actorId ?? this.primaryActorId()));
      const pose = this.actorPose(actor);
      return {
        actorId: actor.id,
        id,
        hitbox: active.hitbox,
        world: boxToWorld(active.hitbox, pose.x, pose.y, pose.facing),
      };
    });
  }

  refreshVisuals(): void {
    this.syncVisuals();
  }

  debugStartMove(moveId: string): boolean {
    if (this.state === 'dead') return false;
    const move = this.config.moves.find((candidate) => candidate.id === moveId);
    if (!move) return false;
    MoveExecutor.start(this, move);
    this.syncVisuals();
    return true;
  }

  private runState(input: RawInput): void {
    if (this.state === 'attack') {
      const cancel = this.findTriggeredMove(true);
      if (cancel && MoveExecutor.tryCancel(this, cancel)) return;
      MoveExecutor.tick(this);
      return;
    }

    if (this.state === 'hitstun' || this.state === 'juggle') {
      this.hitstun = Math.max(0, this.hitstun - 1);
      if (this.hitstun === 0) this.changeState(this.grounded ? 'idle' : 'airborne');
      return;
    }

    if (this.state === 'blockstun') {
      this.blockstun = Math.max(0, this.blockstun - 1);
      if (this.blockstun === 0) this.changeState('idle');
      return;
    }

    if (this.state === 'knockdown') {
      this.vx *= 0.9;
      if (this.grounded && this.stateFrame > 30) this.changeState('getup');
      return;
    }

    if (this.state === 'getup') {
      if (this.stateFrame > 24) this.changeState('idle');
      return;
    }

    const move = this.findTriggeredMove(false);
    if (move) {
      MoveExecutor.start(this, move);
      return;
    }

    if (!this.grounded) {
      this.changeState('airborne');
      this.vx = this.horizontalAirVelocity(input);
      return;
    }

    if (input.down) {
      this.vx = 0;
      this.changeState('crouch');
      return;
    }

    if (input.up) {
      this.startJump(input);
      return;
    }

    const forwardHeld = this.facing === 1 ? input.right : input.left;
    const backHeld = this.facing === 1 ? input.left : input.right;
    if (forwardHeld) {
      this.vx = this.config.walkForwardSpeed * this.facing;
      this.changeState('walk_forward');
    } else if (backHeld) {
      this.vx = -this.config.walkBackSpeed * this.facing;
      this.changeState('walk_back');
    } else {
      this.vx = 0;
      this.changeState('idle');
    }
  }

  private findTriggeredMove(forCancel: boolean): Move | null {
    return (
      this.config.moves.find((move) => {
        const trigger = move.trigger;
        if (!trigger.allowedStates.includes(this.state)) return false;
        if (forCancel && trigger.cancelFrom && this.currentMove && !trigger.cancelFrom.includes(this.currentMove.id)) return false;
        if (!this.grounded && move.airOk !== true) return false;
        if (this.grounded && move.groundOk === false) return false;
        return this.inputBuffer.matchSequence(trigger.sequence, trigger.window ?? 15);
      }) ?? null
    );
  }

  private startJump(input: RawInput): void {
    const forwardHeld = this.facing === 1 ? input.right : input.left;
    const backHeld = this.facing === 1 ? input.left : input.right;
    this.vy = -this.config.jumpVelocity;
    this.vx = forwardHeld
      ? this.config.jumpForwardVelocity * this.facing
      : backHeld
        ? -this.config.jumpBackVelocity * this.facing
        : 0;
    this.grounded = false;
    this.changeState('airborne');
  }

  private horizontalAirVelocity(input: RawInput): number {
    const forwardHeld = this.facing === 1 ? input.right : input.left;
    const backHeld = this.facing === 1 ? input.left : input.right;
    if (forwardHeld) return this.config.jumpForwardVelocity * 0.65 * this.facing;
    if (backHeld) return -this.config.jumpBackVelocity * 0.65 * this.facing;
    return this.vx * 0.98;
  }

  private applyPhysics(): void {
    if (!this.grounded || this.vy < 0) {
      this.vy = Math.min(this.config.maxFallSpeed, this.vy + this.config.gravity);
    }

    this.x += this.vx;
    this.y += this.vy;

    if (this.y >= FLOOR_Y) {
      this.y = FLOOR_Y;
      this.vy = 0;
      if (!this.grounded && (this.state === 'airborne' || this.state === 'juggle')) {
        this.changeState(this.state === 'juggle' ? 'knockdown' : 'landing');
      }
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    if (this.grounded && this.state === 'landing' && this.stateFrame > 3) {
      this.changeState('idle');
    }
  }

  private keepInStage(): void {
    this.x = Phaser.Math.Clamp(this.x, STAGE_LEFT, STAGE_RIGHT);
  }

  private autoFace(opponent: Fighter): void {
    if (!this.grounded || this.state === 'attack' || this.state === 'hitstun' || this.state === 'blockstun') return;
    this.facing = this.x <= opponent.x ? 1 : -1;
  }

  private tickModifiers(): void {
    if (this.fusionFrames > 0) {
      this.fusionFrames -= 1;
    }
    if (this.invulnerable) {
      this.invulnerable.duration -= 1;
      if (this.invulnerable.duration <= 0) this.invulnerable = null;
    }
    if (this.armor) {
      this.armor.duration -= 1;
      if (this.armor.duration <= 0 || this.armor.hits <= 0) this.armor = null;
    }
    for (const [actorId, override] of this.actorOffsetOverrides.entries()) {
      if (override.duration === null) continue;
      override.duration -= 1;
      if (override.duration <= 0) this.actorOffsetOverrides.delete(actorId);
    }
    for (const [actorId, override] of this.followDelayOverrides.entries()) {
      if (override.duration === null) continue;
      override.duration -= 1;
      if (override.duration <= 0) this.followDelayOverrides.delete(actorId);
    }
  }

  private syncVisuals(): void {
    for (const actor of this.actorOrder.map((id) => this.actorFor(id))) {
      this.syncActorVisual(actor);
    }

    this.label.setPosition(this.x, this.y - FIGHTER_HEIGHT - 18);
    this.label.setText(this.fusionFrames > 0 ? `${this.currentMove?.id ?? this.state}:fusion` : (this.currentMove?.id ?? this.state));
  }

  private syncActorVisual(actor: FighterActorRuntime): void {
    const visible = this.actorVisible(actor);
    actor.body.setVisible(visible);
    if (!visible) return;

    const pose = this.actorPose(actor);
    actor.body.setPosition(pose.x, pose.y);

    const sprite = this.spriteForActor(actor);
    if (actor.body instanceof Phaser.GameObjects.Sprite && sprite) {
      const visual = this.currentVisualFrame(actor);
      const frameMeta = this.frameMeta(sprite, visual.sheet, visual.frame);
      const originX = frameMeta.anchor.x / frameMeta.width;
      const originY = frameMeta.anchor.y / frameMeta.height;
      actor.body.setTexture(this.frameKey(visual.sheet, visual.frame, actor.id));
      actor.body.setOrigin(pose.facing === -1 ? 1 - originX : originX, originY);
      actor.body.setFlipX(pose.facing === -1);
      actor.body.setScale(sprite.scale);
      actor.body.clearTint();
      if (this.state === 'hitstun' || this.state === 'juggle') actor.body.setTint(0xffffff);
      if (this.state === 'blockstun') actor.body.setTint(0x9dffbd);
    } else if (actor.body instanceof Phaser.GameObjects.Rectangle) {
      actor.body.setScale(pose.facing, this.state === 'crouch' ? 0.58 : 1);
      actor.body.setFillStyle(this.playerNum === 1 ? 0xd44949 : 0x426edb);
      if (this.state === 'attack') actor.body.setFillStyle(0xf2b84b);
      if (this.state === 'hitstun' || this.state === 'juggle') actor.body.setFillStyle(0xffffff);
      if (this.state === 'blockstun') actor.body.setFillStyle(0x62d980);
    }

    actor.body.setAlpha(this.invulnerable ? 0.55 : 1);
  }

  private currentVisualFrame(actor?: FighterActorRuntime): { sheet: SpriteSheetId; frame: number } {
    const visualDelay = this.fusionFrames > 0 ? 0 : (actor?.config.visualDelay ?? 0);
    const sprite = actor ? this.spriteForActor(actor) : this.config.sprite;
    if (this.currentMove && MOVE_SHEETS.has(this.currentMove.animation as SpriteSheetId)) {
      return {
        sheet: this.currentMove.animation as SpriteSheetId,
        frame: this.moveVisualFrame(this.currentMove, visualDelay, sprite),
      };
    }

    const configuredFrame = sprite?.stateFrames?.[this.state];
    if (configuredFrame !== undefined) {
      const delayedStateFrame = Math.max(0, this.stateFrame - visualDelay);
      return {
        sheet: 'base',
        frame: Array.isArray(configuredFrame)
          ? configuredFrame[Math.floor(delayedStateFrame / 14) % configuredFrame.length]
          : configuredFrame,
      };
    }

    const delayedStateFrame = Math.max(0, this.stateFrame - visualDelay);
    const baseFrameByState: Partial<Record<FighterState, number | number[]>> = {
      idle: Math.floor(delayedStateFrame / 14) % 3,
      walk_forward: 1 + (Math.floor(delayedStateFrame / 8) % 2),
      walk_back: 2 - (Math.floor(delayedStateFrame / 8) % 2),
      crouch: 4,
      airborne: 5,
      landing: 4,
      blockstun: 3,
      hitstun: 3,
      juggle: 5,
      knockdown: 4,
      getup: 4,
      dead: 4,
    };

    return {
      sheet: 'base',
      frame: this.resolveBaseFrame(baseFrameByState[this.state] ?? 0, delayedStateFrame),
    };
  }

  private resolveBaseFrame(frame: number | number[], frameCursor = this.stateFrame): number {
    if (!Array.isArray(frame)) return frame;
    return frame[Math.floor(frameCursor / 14) % frame.length] ?? 0;
  }

  private moveVisualFrame(move: Move, frameDelay = 0, sprite = this.config.sprite): number {
    const elapsed = Math.max(
      0,
      move.phases.slice(0, this.movePhaseIndex).reduce((sum, phase) => sum + phase.frames, 0) + this.movePhaseFrame - frameDelay,
    );
    const frameCount = sprite?.frameCounts[move.animation as SpriteSheetId] ?? 4;
    const maxFrame = Math.max(0, frameCount - 1);

    if (move.visualTimeline?.length) {
      let cursor = 0;
      for (const visualFrame of move.visualTimeline) {
        cursor += visualFrame.duration;
        if (elapsed < cursor) return Phaser.Math.Clamp(visualFrame.frame, 0, maxFrame);
      }
      return Phaser.Math.Clamp(move.visualTimeline[move.visualTimeline.length - 1].frame, 0, maxFrame);
    }

    const totalFrames = move.phases.reduce((sum, phase) => sum + phase.frames, 0);
    return Phaser.Math.Clamp(Math.floor((elapsed / Math.max(totalFrames, 1)) * frameCount), 0, maxFrame);
  }

  setActiveHitbox(id: string, hitbox: Hitbox, actorId?: FighterActorId): void {
    this.activeHitboxes.set(id, { actorId, hitbox });
  }

  clearActiveHitbox(id: string): void {
    this.activeHitboxes.delete(id);
  }

  setActorOffset(actorId: FighterActorId, offsetX: number, offsetY = 0, duration: number | null = null): void {
    this.actorOffsetOverrides.set(actorId, { offsetX, offsetY, duration });
  }

  resetActorOffset(actorId: FighterActorId): void {
    this.actorOffsetOverrides.delete(actorId);
  }

  setFollowDelay(actorId: FighterActorId, frames: number, duration: number | null = null): void {
    this.followDelayOverrides.set(actorId, { frames, duration });
  }

  swapLead(): void {
    this.leadSwapped = !this.leadSwapped;
  }

  enterFusion(duration: number): void {
    this.fusionFrames = Math.max(this.fusionFrames, duration);
  }

  exitFusion(): void {
    this.fusionFrames = 0;
  }

  setActorHurtbox(actorId: FighterActorId | undefined, hurtbox: Hurtbox | null): void {
    if (!actorId) {
      this.hurtboxOverride = hurtbox;
      this.hurtboxDisabled = hurtbox === null;
      return;
    }
    this.actorHurtboxOverrides.set(actorId, hurtbox);
  }

  clearActorMoveOverrides(): void {
    this.actorHurtboxOverrides.clear();
    this.actorOffsetOverrides.clear();
    this.followDelayOverrides.clear();
  }

  private createActors(fill: number): Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite {
    const actorConfigs = this.config.actors?.length
      ? this.config.actors
      : [
          {
            id: 'lead' as FighterActorId,
            sprite: this.config.sprite,
            hurtboxes: this.config.hurtboxes,
            defaultVisible: true,
          },
        ];

    let primaryBody: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite | null = null;
    actorConfigs.forEach((actorConfig, index) => {
      const sprite = actorConfig.sprite ?? (this.config.actors?.length ? undefined : this.config.sprite);
      const body = sprite
        ? this.scene.add.sprite(this.x, this.y, this.frameKey('base', 0, actorConfig.id))
        : this.scene.add.rectangle(this.x, this.y, FIGHTER_WIDTH, FIGHTER_HEIGHT, fill).setOrigin(0.5, 1);
      body.setVisible(actorConfig.defaultVisible ?? actorConfig.id !== 'fusion');
      body.setDepth(index);
      this.actors.set(actorConfig.id, { id: actorConfig.id, config: actorConfig, body });
      this.actorOrder.push(actorConfig.id);
      primaryBody ??= body;
    });

    return primaryBody ?? this.scene.add.rectangle(this.x, this.y, FIGHTER_WIDTH, FIGHTER_HEIGHT, fill).setOrigin(0.5, 1);
  }

  private recordPose(): void {
    this.poseHistory.unshift({ x: this.x, y: this.y, facing: this.facing });
    if (this.poseHistory.length > this.maxPoseHistory) this.poseHistory.pop();
  }

  private activeCollisionActors(): FighterActorRuntime[] {
    return this.actorOrder.map((id) => this.actorFor(id)).filter((actor) => this.actorVisible(actor));
  }

  private actorVisible(actor: FighterActorRuntime): boolean {
    if (this.fusionFrames > 0) return actor.config.visibleInFusion ?? actor.id === 'fusion';
    return actor.config.defaultVisible ?? actor.id !== 'fusion';
  }

  private actorFor(actorId: FighterActorId): FighterActorRuntime {
    const actor = this.actors.get(actorId) ?? this.actors.get('lead') ?? this.actors.values().next().value;
    if (!actor) throw new Error(`Fighter ${this.id} has no render actors`);
    return actor;
  }

  private primaryActorId(): FighterActorId {
    return this.fusionFrames > 0 && this.actors.has('fusion') ? 'fusion' : 'lead';
  }

  private actorPose(actor: FighterActorRuntime): ActorPose {
    const offset = this.actorOffset(actor);
    const delay = this.actorFollowDelay(actor);
    const sample = this.poseHistory[Math.min(delay, this.poseHistory.length - 1)] ?? { x: this.x, y: this.y, facing: this.facing };
    return {
      x: sample.x + offset.offsetX * sample.facing,
      y: sample.y + offset.offsetY,
      facing: sample.facing,
    };
  }

  private actorOffset(actor: FighterActorRuntime): { offsetX: number; offsetY: number } {
    const override = this.actorOffsetOverrides.get(actor.id);
    if (override) return { offsetX: override.offsetX, offsetY: override.offsetY };
    const source = this.swappedPairConfig(actor) ?? actor.config;
    return { offsetX: source.offsetX ?? 0, offsetY: source.offsetY ?? 0 };
  }

  private actorFollowDelay(actor: FighterActorRuntime): number {
    const override = this.followDelayOverrides.get(actor.id);
    if (override) return override.frames;
    const source = this.swappedPairConfig(actor) ?? actor.config;
    return source.followDelay ?? 0;
  }

  private swappedPairConfig(actor: FighterActorRuntime): FighterActorConfig | null {
    if (!this.leadSwapped) return null;
    if (actor.id === 'lead') return this.actors.get('echo')?.config ?? null;
    if (actor.id === 'echo') return this.actors.get('lead')?.config ?? null;
    return null;
  }

  private spriteForActor(actor: FighterActorRuntime): NonNullable<CharacterConfig['sprite']> | undefined {
    return actor.config.sprite ?? (this.config.actors?.length ? undefined : this.config.sprite);
  }

  private frameMeta(sprite: NonNullable<CharacterConfig['sprite']>, sheet: SpriteSheetId, frame: number): SpriteFrameMeta {
    const configured = sprite.frames?.[sheet]?.[frame];
    if (configured) return configured;

    const width = sprite.frameWidth ?? 256;
    const height = sprite.frameHeight ?? 256;
    return {
      file: `sprites/${sheet}/${sheet}_${String(frame + 1).padStart(3, '0')}.png`,
      width,
      height,
      anchor: {
        x: width / 2,
        y: (sprite.anchorY ?? 1) * height,
      },
    };
  }

  private frameKey(sheet: SpriteSheetId, frame: number, actorId: FighterActorId = 'lead'): string {
    return this.config.actors?.length ? `${this.config.id}:${actorId}:${sheet}:${frame}` : `${this.config.id}:${sheet}:${frame}`;
  }
}
