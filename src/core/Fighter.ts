import Phaser from 'phaser';
import { InputBuffer } from './InputBuffer';
import { MoveExecutor } from './MoveExecutor';
import type { ProjectilePool } from './ProjectilePool';
import type {
  CharacterConfig,
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

  currentMove: Move | null = null;
  movePhaseIndex = 0;
  movePhaseFrame = 0;
  activeHitboxes = new Map<string, Hitbox>();
  hasHitThisMove = new Set<string>();

  inputBuffer = new InputBuffer();
  animationKey = 'idle';

  readonly body: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite;
  readonly label: Phaser.GameObjects.Text;
  readonly suspensionLine?: Phaser.GameObjects.Graphics;
  readonly hairTie?: Phaser.GameObjects.Sprite;

  constructor(scene: FighterScene, config: CharacterConfig, playerNum: 1 | 2, position: { x: number; y: number }) {
    this.scene = scene;
    this.id = `${config.id}-p${playerNum}`;
    this.config = config;
    this.playerNum = playerNum;
    this.x = position.x;
    this.y = config.suspension?.pivotY ?? position.y;
    this.facing = playerNum === 1 ? 1 : -1;
    this.health = config.maxHealth;

    const fill = playerNum === 1 ? 0xd44949 : 0x426edb;
    this.body = config.sprite
      ? scene.add.sprite(this.x, this.y, this.frameKey('base', 0))
      : scene.add.rectangle(this.x, this.y, FIGHTER_WIDTH, FIGHTER_HEIGHT, fill).setOrigin(0.5, 1);
    this.body.setDepth(10);
    if (config.suspension) {
      this.grounded = true;
      this.suspensionLine = scene.add.graphics().setDepth(6);
      this.hairTie = scene.add.sprite(this.x, this.y - config.suspension.tieOffsetY, `${config.id}:hair_tie`).setOrigin(0.5, 1).setDepth(12);
    }
    this.label = scene.add
      .text(this.x, this.y - FIGHTER_HEIGHT - 24, '', {
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '12px',
      })
      .setOrigin(0.5, 1)
      .setDepth(20);
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
    }
  }

  getHurtboxWorld(): AABB | null {
    if (this.hurtboxDisabled) return null;
    const hurtbox = this.hurtboxOverride ?? this.config.hurtboxes[this.state] ?? this.config.hurtboxes.idle;
    return hurtbox ? boxToWorld(hurtbox, this.x, this.y, this.facing) : null;
  }

  getActiveHitboxesWorld(): Array<{ id: string; hitbox: Hitbox; world: AABB }> {
    return [...this.activeHitboxes.entries()].map(([id, hitbox]) => ({
      id,
      hitbox,
      world: boxToWorld(hitbox, this.x, this.y, this.facing),
    }));
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

    if (this.config.suspension) {
      this.runSuspendedState(input);
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

    if (input.up && !this.config.suspension) {
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

  private runSuspendedState(input: RawInput): void {
    const suspension = this.config.suspension;
    if (!suspension) return;

    if (input.up) {
      this.vy -= suspension.liftAcceleration ?? 0.72;
    } else if (input.down) {
      this.vy += suspension.tuckAcceleration ?? 0.58;
    }

    const forwardHeld = this.facing === 1 ? input.right : input.left;
    const backHeld = this.facing === 1 ? input.left : input.right;
    const tuckMultiplier = input.down ? 0.55 : 1;
    if (forwardHeld) {
      this.vx = this.config.walkForwardSpeed * tuckMultiplier * this.facing;
      this.changeState(input.down ? 'crouch' : input.up ? 'airborne' : 'walk_forward');
    } else if (backHeld) {
      this.vx = -this.config.walkBackSpeed * tuckMultiplier * this.facing;
      this.changeState(input.down ? 'crouch' : input.up ? 'airborne' : 'walk_back');
    } else {
      this.vx = 0;
      this.changeState(input.down ? 'crouch' : input.up ? 'airborne' : 'idle');
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
    if (this.config.suspension) {
      this.applySuspensionPhysics();
      return;
    }

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

  private applySuspensionPhysics(): void {
    const suspension = this.config.suspension;
    if (!suspension) return;

    const targetY = suspension.pivotY + Math.sin((this.scene.frameCounter + this.playerNum * 17) / 38) * (suspension.swayY ?? 5);
    const minPivotY = suspension.minPivotY ?? suspension.ceilingY + suspension.tieOffsetY + 42;
    const maxPivotY = suspension.maxPivotY ?? FLOOR_Y - 52;
    const returnStrength = suspension.returnStrength ?? 0.035;
    const damping = suspension.damping ?? 0.9;
    this.vy = Phaser.Math.Clamp((this.vy + (targetY - this.y) * returnStrength) * damping, -5.2, 5.2);
    this.x += this.vx;
    this.y += this.vy;

    if (this.y < minPivotY) {
      this.y = minPivotY;
      this.vy = Math.max(0, this.vy);
    } else if (this.y > maxPivotY) {
      this.y = maxPivotY;
      this.vy = Math.min(0, this.vy);
    }

    this.grounded = true;
    if (this.state === 'landing') {
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
    if (this.invulnerable) {
      this.invulnerable.duration -= 1;
      if (this.invulnerable.duration <= 0) this.invulnerable = null;
    }
    if (this.armor) {
      this.armor.duration -= 1;
      if (this.armor.duration <= 0 || this.armor.hits <= 0) this.armor = null;
    }
  }

  private syncVisuals(): void {
    this.body.setPosition(this.x, this.y);

    if (this.body instanceof Phaser.GameObjects.Sprite && this.config.sprite) {
      const visual = this.currentVisualFrame();
      const frameMeta = this.frameMeta(visual.sheet, visual.frame);
      const originX = frameMeta.anchor.x / frameMeta.width;
      const originY = frameMeta.anchor.y / frameMeta.height;
      this.body.setTexture(this.frameKey(visual.sheet, visual.frame));
      this.body.setOrigin(this.facing === -1 ? 1 - originX : originX, originY);
      this.body.setFlipX(this.facing === -1);
      this.body.setScale(this.config.sprite.scale);
      this.body.clearTint();
      if (this.state === 'hitstun' || this.state === 'juggle') this.body.setTint(0xffffff);
      if (this.state === 'blockstun') this.body.setTint(0x9dffbd);
    } else if (this.body instanceof Phaser.GameObjects.Rectangle) {
      this.body.setScale(this.facing, this.state === 'crouch' ? 0.58 : 1);
      this.body.setFillStyle(this.playerNum === 1 ? 0xd44949 : 0x426edb);
      if (this.state === 'attack') this.body.setFillStyle(0xf2b84b);
      if (this.state === 'hitstun' || this.state === 'juggle') this.body.setFillStyle(0xffffff);
      if (this.state === 'blockstun') this.body.setFillStyle(0x62d980);
    }

    if (this.invulnerable) this.body.setAlpha(0.55);
    else this.body.setAlpha(1);

    this.syncSuspensionVisuals();
    this.label.setPosition(this.x, this.y - FIGHTER_HEIGHT - 18);
    this.label.setText(this.currentMove?.id ?? this.state);
  }

  private syncSuspensionVisuals(): void {
    const suspension = this.config.suspension;
    if (!suspension) return;

    const tieX = this.x + (suspension.tieOffsetX ?? 0);
    const tieY = this.y - suspension.tieOffsetY;
    const tieScale = suspension.hairTieScale ?? 1;
    const lineEndX = this.x + (suspension.lineAttachOffsetX ?? suspension.tieOffsetX ?? 0);
    const lineEndY = this.y + (suspension.lineAttachOffsetY ?? -suspension.tieOffsetY);

    this.suspensionLine?.clear();
    this.suspensionLine?.lineStyle(3, suspension.lineColor ?? 0x78f0d2, suspension.lineAlpha ?? 0.9);
    this.suspensionLine?.lineBetween(tieX, suspension.ceilingY, lineEndX, lineEndY);
    this.suspensionLine?.fillStyle(0x101820, 1);
    this.suspensionLine?.fillCircle(tieX, suspension.ceilingY, 7);
    this.suspensionLine?.lineStyle(1, 0xd7fff5, 0.95);
    this.suspensionLine?.strokeCircle(tieX, suspension.ceilingY, 7);

    this.hairTie?.setPosition(tieX, tieY);
    this.hairTie?.setScale(tieScale);
    this.hairTie?.setAlpha(this.body.alpha);
  }

  private currentVisualFrame(): { sheet: SpriteSheetId; frame: number } {
    if (this.currentMove && MOVE_SHEETS.has(this.currentMove.animation as SpriteSheetId)) {
      return {
        sheet: this.currentMove.animation as SpriteSheetId,
        frame: this.moveVisualFrame(this.currentMove),
      };
    }

    const configuredFrame = this.config.sprite?.stateFrames?.[this.state];
    if (configuredFrame !== undefined) {
      return {
        sheet: 'base',
        frame: Array.isArray(configuredFrame)
          ? configuredFrame[Math.floor(this.stateFrame / 14) % configuredFrame.length]
          : configuredFrame,
      };
    }

    const baseFrameByState: Partial<Record<FighterState, number | number[]>> = {
      idle: Math.floor(this.stateFrame / 14) % 3,
      walk_forward: 1 + (Math.floor(this.stateFrame / 8) % 2),
      walk_back: 2 - (Math.floor(this.stateFrame / 8) % 2),
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
      frame: this.resolveBaseFrame(baseFrameByState[this.state] ?? 0),
    };
  }

  private resolveBaseFrame(frame: number | number[]): number {
    if (!Array.isArray(frame)) return frame;
    return frame[Math.floor(this.stateFrame / 14) % frame.length] ?? 0;
  }

  private moveVisualFrame(move: Move): number {
    const elapsed =
      move.phases.slice(0, this.movePhaseIndex).reduce((sum, phase) => sum + phase.frames, 0) + this.movePhaseFrame;
    const frameCount = this.config.sprite?.frameCounts[move.animation as SpriteSheetId] ?? 4;
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

  private frameMeta(sheet: SpriteSheetId, frame: number): SpriteFrameMeta {
    const configured = this.config.sprite?.frames?.[sheet]?.[frame];
    if (configured) return configured;

    const width = this.config.sprite?.frameWidth ?? 256;
    const height = this.config.sprite?.frameHeight ?? 256;
    return {
      file: `sprites/${sheet}/${sheet}_${String(frame + 1).padStart(3, '0')}.png`,
      width,
      height,
      anchor: {
        x: width / 2,
        y: (this.config.sprite?.anchorY ?? 1) * height,
      },
    };
  }

  private frameKey(sheet: SpriteSheetId, frame: number): string {
    return `${this.config.id}:${sheet}:${frame}`;
  }
}
