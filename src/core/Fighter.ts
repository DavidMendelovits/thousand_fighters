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
  GrabSpec,
  Hitbox,
  HitboxKeyframe,
  Hurtbox,
  Move,
  RawInput,
  SpriteFrameMeta,
  SpriteSheetId,
  PowerUpSpec,
  CharacterForm,
} from '../schema/types';
import { MOVE_SHEET_IDS } from '../../shared/animationRows.js';
import { moveVisualFrameAt } from '../../shared/moveVisualFrame.js';
import { resolveStateSheet, stateRowFrame, isLoopingStateRow,timedStateRowFrame } from './animationRowPlayback';
import { boxToWorld, type AABB } from '../util/aabb';
import { interpolateHitboxGeometry } from './hitboxGeometry';
import { selectTriggeredMove } from './moveSelection';
import {ComboCounter,effectiveStats,scaledBox} from './combatRules';
import {heldGripFrame} from './gripPlayback';

const STAGE_LEFT = 96;
const STAGE_RIGHT = 704;
const FLOOR_Y = 390;
const FIGHTER_WIDTH = 60;
const FIGHTER_HEIGHT = 120;
const MOVE_SHEETS = new Set<SpriteSheetId>(MOVE_SHEET_IDS);

type ActiveHitbox = {
  actorId?: FighterActorId;
  hitbox: Hitbox;
  keyframes?: HitboxKeyframe[];
  // Frames since activation, drives keyframe interpolation.
  age: number;
};

type ActiveGrab = {
  actorId?: FighterActorId;
  grab: GrabSpec;
  keyframes?: HitboxKeyframe[];
  age: number;
};

type GrabHold = {
  offsetX: number;
  offsetY: number;
  remaining: number;
  requiresAttack?: boolean;
  actorGrip?: NonNullable<GrabSpec['actorGrip']> & { duration: number; fromX: number; fromY: number; torsoY: number; facing: 1|-1 };
  anchor?: { x: number; y: number; facing: 1 | -1 };
  pull: { fromX: number; frames: number; elapsed: number } | null;
  release: {
    facing?: 1 | -1;
    knockback: { x: number; y: number };
    hitstun: number;
    launches: boolean;
    knockdown: boolean;
  };
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
  rearLayer?: Phaser.GameObjects.Sprite;
};

export class Fighter {
  controlledSummon: {actor:string; remaining:number; speed:number; x:number; y:number; facing:1|-1} | null = null;
  id: string;
  config: CharacterConfig;
  readonly baseConfig: CharacterConfig;
  activeForm: CharacterForm | null = null;
  formTicks: number | null = null;
  powers: Array<{spec:PowerUpSpec;remaining:number|null}> = [];
  meter=60;
  contactThisMove=false;
  hitThisMove=false;
  moveSerial=0;
  readonly combo=new ComboCounter();
  airDodgeUsed=false;
  movementTicks=0;
  private movementDirection:1|-1=1;
  private lastDirection:{direction:number;tick:number}|null=null;
  private priorHorizontal=0;
  private simulationTick=0;
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
  grabImmunity = 0;

  invulnerable: { duration: number; against: string[] } | null = null;
  armor: { hits: number; duration: number } | null = null;
  hurtboxOverride: Hurtbox | null = null;
  hurtboxDisabled = false;
  actorHurtboxOverrides = new Map<FighterActorId, Hurtbox | null>();

  currentMove: Move | null = null;
  movePhaseIndex = 0;
  movePhaseFrame = 0;
  activeHitboxes = new Map<string, ActiveHitbox>();
  activeGrabs = new Map<string, ActiveGrab>();
  hasHitThisMove = new Set<string>();

  // Set while this fighter is held by the opponent's grab.
  grabbedBy: Fighter | null = null;
  grabHold: GrabHold | null = null;

  inputBuffer = new InputBuffer();
  animationKey = 'idle';

  body: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite;
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
    this.baseConfig = config;
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
      if(this.config.poseStyle==='fluid')this.stateFrame++;
      this.syncVisuals();
      return;
    }

    this.tickModifiers();
    this.simulationTick++;
    this.inputBuffer.record(input, this.facing);
    this.autoFace(opponent);
    this.tickControlledSummon(input, opponent);
    this.runState(input);
    this.applyPhysics();
    this.combo.tick(['hitstun','juggle','stunned','grabbed'].includes(this.state));
    this.keepInStage();
    this.recordPose();
    this.stateFrame += 1;
    this.syncVisuals();
  }

  changeState(next: FighterState): void {
    if(['hitstun','blockstun','juggle','stunned','grabbed','knockdown','dead'].includes(next))this.recallSummon(false);
    if(['hitstun','blockstun','juggle','stunned','grabbed','knockdown','dead'].includes(next))this.inputBuffer.consumeButtons();
    if(next==='dead') {this.powers=[];if(this.activeForm)this.exitForm(false);}
    if (this.state === next) return;
    if (this.state === 'grabbed' && next !== 'grabbed') {
      this.grabbedBy = null;
      this.grabHold = null;
    }
    this.state = next;
    this.stateFrame = 0;
    this.animationKey = this.config.animations[next] ?? next;

    if (next !== 'attack') {
      this.currentMove = null;
      this.movePhaseIndex = 0;
      this.movePhaseFrame = 0;
      this.activeHitboxes.clear();
      this.activeGrabs.clear();
      this.hurtboxOverride = null;
      this.hurtboxDisabled = false;
      this.clearActorMoveOverrides();
    }
  }

  getHurtboxWorld(): AABB | null {
    return this.getHurtboxesWorld()[0]?.world ?? null;
  }

  getGuardboxWorld(): AABB | null {
    const guardbox = this.config.guardboxes?.[this.state];
    if (!guardbox) return null;
    const actor = this.actorFor(this.primaryActorId());
    const pose = this.actorPose(actor);
    return boxToWorld(scaledBox(guardbox,this.stats.size), pose.x, pose.y, pose.facing);
  }

  getHurtboxesWorld(): Array<{ actorId: FighterActorId; world: AABB }> {
    if (this.hurtboxDisabled) return [];
    return this.activeCollisionActors().flatMap((actor) => {
      const override = this.actorHurtboxOverrides.has(actor.id) ? this.actorHurtboxOverrides.get(actor.id) : undefined;
      if (override === null) return [];
      const hurtbox = override ?? actor.config.hurtboxes?.[this.state] ?? actor.config.hurtboxes?.idle ?? this.hurtboxOverride ?? this.config.hurtboxes[this.state] ?? this.config.hurtboxes.idle;
      if (!hurtbox) return [];
      const pose = this.actorPose(actor);
      return [{ actorId: actor.id, world: boxToWorld(scaledBox(hurtbox,this.stats.size), pose.x, pose.y, pose.facing) }];
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
        world: boxToWorld(scaledBox(interpolateHitboxGeometry(active),this.stats.size), pose.x, pose.y, pose.facing),
      };
    });
  }

  refreshVisuals(): void {
    this.syncVisuals();
  }

  debugStartMove(moveId: string): boolean {
    if (this.state === 'dead') return false;
    const move = this.config.moves.find((candidate) => candidate.id === moveId);
    if (!move || (move.controlledActor??null)!==(this.controlledSummon?.actor??null)) return false;
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

    if(this.controlledSummon){
      this.vx=0;
      const move=this.findTriggeredMove(false);
      if(move)MoveExecutor.start(this,move);
      return;
    }

    if (this.state === 'hitstun' || this.state === 'juggle' || this.state === 'stunned') {
      this.hitstun = Math.max(0, this.hitstun - 1);
      if (this.hitstun === 0) this.changeState(this.grounded ? 'idle' : 'airborne');
      return;
    }

    if (this.state === 'blockstun') {
      this.blockstun = Math.max(0, this.blockstun - 1);
      if (this.blockstun === 0) this.changeState('idle');
      return;
    }

    if (this.state === 'grabbed') {
      this.tickGrabbed();
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

    if(this.state==='dash'||this.state==='air_dodge'||this.state==='wavedash'){
      this.movementTicks--;
      if(this.state==='wavedash')this.vx*=.88;
      if(this.movementTicks<=0){this.changeState(this.grounded?'idle':'airborne');return;}
      // Keep the opening commitment, then allow a grounded dash to flow into
      // a jump or attack. Air dodges retain their existing landing commitment.
      if(this.state==='dash'&&this.stateFrame>=4&&input.up){this.startJump(input);return;}
      if(this.state==='dash'&&this.stateFrame>=4){const m=this.findTriggeredMove(false);if(m){MoveExecutor.start(this,m);return;}}
      return;
    }
    if(input.transform&&this.grounded&&!this.activeForm){const form=this.baseConfig.forms?.[0];if(form&&this.enterForm(form.id))return;}
    if(input.power&&this.grounded){const power=this.config.powerUps?.[0]??this.baseConfig.powerUps?.[0];if(power&&this.applyPowerUp(power))return;}
    const horizontal=input.right&&!input.left?1:input.left&&!input.right?-1:0;
    let doubleTap=false;
    if(horizontal&&horizontal!==this.priorHorizontal){
      doubleTap=this.lastDirection?.direction===horizontal&&this.simulationTick-this.lastDirection.tick<=12;
      this.lastDirection={direction:horizontal,tick:this.simulationTick};
    }
    this.priorHorizontal=horizontal;
    if(input.dash||doubleTap){
      if(this.grounded&&input.up){this.startJump(input);this.startAirDodge(horizontal||this.facing,true);return;}
      if(this.grounded){this.movementDirection=(horizontal||this.facing) as 1|-1;this.vx=this.movementDirection*8*this.stats.speed;this.movementTicks=13;this.changeState('dash');return;}
      if(!this.airDodgeUsed){this.startAirDodge(horizontal||this.facing,Boolean(input.down));return;}
    }

    // Maintain active block state while holding back; exit when released.
    // HitResolver.isBlocking() reads raw input so it still works in blockstun
    // (the reactive path) without any changes here.
    if (this.state === 'block') {
      const backHeld = this.facing === 1 ? input.left : input.right;
      if (!this.grounded || !backHeld) {
        this.changeState('idle');
        // Fall through to normal state handling below.
      } else {
        const guardedMove = this.findTriggeredMove(false);
        if (guardedMove) { MoveExecutor.start(this, guardedMove); return; }
        this.vx = 0;
        return;
      }
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

    // Hold-back guard: grounded + back held → enter visible block state.
    // vx=0 (no backward movement while blocking).
    if (backHeld && !forwardHeld && !input.down && !input.up) {
      this.vx = 0;
      this.changeState('block');
    } else if (forwardHeld) {
      this.vx = this.config.walkForwardSpeed * this.facing * this.stats.speed;
      this.changeState('walk_forward');
    } else {
      this.vx = 0;
      this.changeState('idle');
    }
  }

  private findTriggeredMove(forCancel: boolean): Move | null {
    return selectTriggeredMove(this.config.moves.filter(m=>this.meter>=(m.cost?.meter??0) && (this.controlledSummon ? m.controlledActor===this.controlledSummon.actor : !m.controlledActor)), this.inputBuffer, this, forCancel);
  }

  summonControl(spec:{actor:string;duration:number;speed:number;offsetX:number;offsetY:number}):void {
    if(!this.actors.get(spec.actor)?.config.summon || this.controlledSummon)return;
    this.controlledSummon={actor:spec.actor,remaining:Math.max(1,spec.duration),speed:spec.speed,x:this.x+spec.offsetX*this.facing,y:this.y+spec.offsetY,facing:this.facing};
    this.vx=0;this.inputBuffer.clear();
  }

  recallSummon(endMove=true):void {
    if(!this.controlledSummon)return;
    // A KO can stop simulation before the victim gets its next update.
    for(const victim of (this.scene as FighterScene).fighters??[]){
      if(victim.grabbedBy===this && victim.grabHold?.actorGrip)victim.releaseGrab(false);
    }
    this.controlledSummon=null;
    this.activeHitboxes.clear();this.activeGrabs.clear();this.inputBuffer.clear();
    if(endMove && this.currentMove?.controlledActor)this.changeState('idle');
  }

  private tickControlledSummon(input:RawInput,opponent:Fighter):void {
    const summon=this.controlledSummon;
    if(!summon)return;
    if(--summon.remaining<=0){this.recallSummon();return;}
    if(opponent.grabbedBy!==this)summon.facing=opponent.x>=summon.x?1:-1;
    // A separate world-space entity: the body never slides along with it.
    const dx=Number(input.right)-Number(input.left),dy=Number(input.down)-Number(input.up);
    const length=Math.max(1,Math.hypot(dx,dy));
    if(!this.currentMove){
      summon.x=Math.max(STAGE_LEFT,Math.min(STAGE_RIGHT,summon.x+dx*summon.speed/length));
      summon.y=Math.max(FLOOR_Y-190,Math.min(FLOOR_Y,summon.y+dy*summon.speed/length));
    }
    this.vx=0;
  }

  get stats(){return effectiveStats(this.config.stats,this.powers.map(p=>p.spec));}
  resetAdvanced():void {this.recallSummon();this.exitForm();this.powers=[];this.meter=60;this.combo.reset();this.airDodgeUsed=false;this.movementTicks=0;this.lastDirection=null;this.priorHorizontal=0;}
  applyPowerUp(spec:PowerUpSpec):boolean {
    if(this.state==='dead'||this.meter<spec.cost)return false;
    this.meter-=spec.cost;
    this.powers=this.powers.filter(p=>p.spec.id!==spec.id);
    this.powers.push({spec,remaining:spec.durationTicks});
    return true;
  }
  enterForm(id:string):boolean {
    const form=this.baseConfig.forms?.find(f=>f.id===id);
    if(!form||this.activeForm||this.state==='dead'||this.meter<form.cost)return false;
    if(form.config.parentId!==this.baseConfig.id||form.config.selectable!==false)return false;
    this.meter-=form.cost;this.activeForm=form;this.formTicks=form.durationTicks;
    this.replaceConfig(form.config);this.changeState(this.grounded?'idle':'airborne');this.inputBuffer.consumeButtons();this.refreshVisuals();return true;
  }
  exitForm(resetState=true):void {
    if(!this.activeForm)return;
    this.activeForm=null;this.formTicks=null;
    const previous=this.state;
    this.replaceConfig(this.baseConfig);
    if(resetState){this.state='attack';this.changeState(['hitstun','juggle','stunned','grabbed','knockdown','dead'].includes(previous)?previous:(this.grounded?'idle':'airborne'));}
  }
  private replaceConfig(config:CharacterConfig):void {
    for(const actor of this.actors.values()){actor.body.destroy();actor.rearLayer?.destroy();}
    this.actors.clear();this.actorOrder.length=0;this.clearActorMoveOverrides();this.fusionFrames=0;this.leadSwapped=false;
    this.config=config;this.currentMove=null;this.activeHitboxes.clear();this.activeGrabs.clear();
    this.invulnerable=null;this.armor=null;
    this.body=this.createActors(this.playerNum===1?0xd44949:0x426edb);
    this.poseHistory=Array.from({length:this.maxPoseHistory},()=>({x:this.x,y:this.y,facing:this.facing}));
  }
  private startAirDodge(direction:number,down:boolean):void {
    this.airDodgeUsed=true;this.movementDirection=direction as 1|-1;this.vx=direction*8*this.stats.speed;this.vy=down?9:0;
    this.movementTicks=14;this.changeState('air_dodge');
    // Wavelanding is spacing, not a repeatable ground invincibility exploit.
    if(!down)this.invulnerable={duration:4,against:['high','mid','low','projectile']};
  }

  private tickGrabbed(): void {
    const grabber = this.grabbedBy;
    const hold = this.grabHold;
    // Grabber interrupted (hit out of the move, move ended early, died):
    // drop out without release knockback.
    if (!grabber || !hold || grabber.state === 'dead' ||
      ['hitstun', 'stunned', 'juggle', 'grabbed', 'knockdown'].includes(grabber.state) ||
      (hold.requiresAttack !== false && grabber.state !== 'attack')) {
      this.releaseGrab(false);
      return;
    }

    if(hold.actorGrip){
      const grip=hold.actorGrip, summon=grabber.controlledSummon;
      if(!summon || summon.actor!==grip.actor){this.releaseGrab(false);return;}
      const t=1-hold.remaining/grip.duration;
      const settle=Math.min(1,(t*grip.duration+1)/4);
      const arc=Math.sin(Math.PI*t);
      const targetX=summon.x+(grip.socketX+grip.swing*Math.sin(Math.PI*2*t))*grip.facing;
      const targetY=summon.y+grip.socketY-grip.torsoY-grip.lift*arc;
      this.x=hold.actorGrip.fromX+(targetX-hold.actorGrip.fromX)*settle;
      this.y=hold.actorGrip.fromY+(targetY-hold.actorGrip.fromY)*settle;
      this.facing=(grip.facing*-1) as 1|-1;
      this.vx=0;this.vy=0;this.grounded=this.y>=FLOOR_Y;
      if(--hold.remaining<=0)this.releaseGrab(true);
      return;
    }

    let offsetX = hold.offsetX;
    if (hold.pull && hold.pull.elapsed < hold.pull.frames) {
      const t = hold.pull.elapsed / hold.pull.frames;
      offsetX = hold.pull.fromX + (hold.offsetX - hold.pull.fromX) * t;
      hold.pull.elapsed += 1;
    }

    this.vx = 0;
    this.vy = 0;
    const anchor = hold.anchor ?? grabber;
    this.x = anchor.x + offsetX * anchor.facing;
    this.y = anchor.y + hold.offsetY;
    this.facing = (anchor.facing * -1) as 1 | -1;
    this.grounded = this.y >= FLOOR_Y;

    hold.remaining -= 1;
    if (hold.remaining <= 0) this.releaseGrab(true);
  }

  releaseGrab(applyRelease: boolean): void {
    const grabber = this.grabbedBy;
    const release = this.grabHold?.release ?? null;
    this.grabbedBy = null;
    this.grabHold = null;
    this.grabImmunity = 24;

    if (applyRelease && release && grabber) {
      this.vx = release.knockback.x * (release.facing??grabber.facing) * grabber.stats.knockback / this.stats.weight;
      this.vy = release.knockback.y;
      this.hitstun = release.hitstun;
      if (release.launches || !this.grounded) {
        this.grounded = false;
        this.changeState('juggle');
      } else if (release.knockdown) {
        this.changeState('knockdown');
      } else {
        this.changeState('hitstun');
      }
      return;
    }

    this.changeState(this.grounded ? 'idle' : 'airborne');
  }

  private startJump(input: RawInput): void {
    const forwardHeld = this.facing === 1 ? input.right : input.left;
    const backHeld = this.facing === 1 ? input.left : input.right;
    this.vy = -this.config.jumpVelocity;
    this.vx = forwardHeld
      ? this.config.jumpForwardVelocity * this.facing * this.stats.speed
      : backHeld
        ? -this.config.jumpBackVelocity * this.facing * this.stats.speed
        : 0;
    this.grounded = false;
    this.changeState('airborne');
  }

  private horizontalAirVelocity(input: RawInput): number {
    const forwardHeld = this.facing === 1 ? input.right : input.left;
    const backHeld = this.facing === 1 ? input.left : input.right;
    if (forwardHeld) return this.config.jumpForwardVelocity * 0.65 * this.facing * this.stats.speed;
    if (backHeld) return -this.config.jumpBackVelocity * 0.65 * this.facing * this.stats.speed;
    return this.vx * 0.98;
  }

  private applyPhysics(): void {
    // Position is locked to the grabber while held.
    if (this.state === 'grabbed') return;
    if (!this.grounded || this.vy < 0) {
      this.vy = Math.min(this.config.maxFallSpeed, this.vy + this.config.gravity);
    }

    this.x += this.vx;
    this.y += this.vy;

    if (this.y >= FLOOR_Y) {
      this.y = FLOOR_Y;
      this.vy = 0;
      if(!this.grounded&&this.state==='air_dodge'){this.changeState('wavedash');this.movementTicks=8;this.invulnerable=null;}
      if (!this.grounded && (this.state === 'airborne' || this.state === 'juggle')) {
        this.changeState(this.state === 'juggle' ? 'knockdown' : 'landing');
      }
      this.grounded = true;
      this.airDodgeUsed=false;
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
    if (!this.grounded || ['attack', 'dash','air_dodge','wavedash','hitstun', 'stunned', 'grabbed', 'block', 'blockstun'].includes(this.state)) return;
    this.facing = this.x <= opponent.x ? 1 : -1;
  }

  private tickModifiers(): void {
    for(const p of this.powers)if(p.remaining!==null)p.remaining--;
    this.powers=this.powers.filter(p=>p.remaining===null||p.remaining>0);
    if(this.formTicks!==null&&--this.formTicks<=0)this.exitForm();
    // Release protection is a window of usable control, not time spent
    // knocked down. Otherwise a launcher consumes all protection before wakeup.
    if(!['hitstun','stunned','juggle','grabbed','knockdown','getup','blockstun','dead'].includes(this.state))this.grabImmunity = Math.max(0, this.grabImmunity - 1);
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
    if (this.config.rosterGroup === 'oddities') {
      this.label.setText(this.currentMove?.displayName ?? ({ grabbed: 'CAPTURED', stunned: 'STUNNED', blockstun: 'BLOCK', juggle: 'LAUNCH' } as Partial<Record<FighterState,string>>)[this.state] ?? '');
      this.label.setFontSize(10);
    }
    if(this.controlledSummon)this.label.setText(`HANDS CONTROL · ${(this.controlledSummon.remaining/60).toFixed(1)}s`);
  }

  private syncActorVisual(actor: FighterActorRuntime): void {
    const visible = this.actorVisible(actor);
    actor.body.setVisible(visible);
    actor.rearLayer?.setVisible(false);
    if (!visible) return;

    const pose = this.actorPose(actor);
    actor.body.setPosition(pose.x, pose.y);
    actor.body.setAngle(this.config.poseStyle==='fluid'?0:this.state === 'grabbed' ? -12 * pose.facing : (this.state === 'knockdown' || this.state === 'dead') ? 75 * pose.facing : 0);

    const sprite = this.spriteForActor(actor);
    if (actor.body instanceof Phaser.GameObjects.Sprite && sprite) {
      const visual = this.currentVisualFrame(actor);
      const frameMeta = this.frameMeta(sprite, visual.sheet, visual.frame);
      const originX = frameMeta.anchor.x / frameMeta.width;
      const originY = frameMeta.anchor.y / frameMeta.height;
      actor.body.setTexture(this.frameKey(visual.sheet, visual.frame, actor.id));
      actor.body.setOrigin(pose.facing === -1 ? 1 - originX : originX, originY);
      actor.body.setFlipX(pose.facing === -1);
      actor.body.setScale(sprite.scale*this.stats.size);
      actor.body.setCrop();
      const held=(this.scene as FighterScene).fighters?.find(f=>f.grabbedBy===this&&f.grabHold?.actorGrip?.actor===actor.id);
      const grip=held?.grabHold?.actorGrip;
      if(grip?.layerSplitY!==undefined){
        // Divide the generated artwork, not the opponent: upper palm behind,
        // lower palm/fingers in front. Coordinates share the authored pivot.
        const split=Phaser.Math.Clamp(frameMeta.anchor.y+grip.layerSplitY/sprite.scale,0,frameMeta.height);
        actor.rearLayer??=this.scene.add.sprite(pose.x,pose.y,actor.body.texture.key).setDepth(-1);
        actor.rearLayer.setTexture(actor.body.texture.key).setPosition(pose.x,pose.y)
          .setOrigin(actor.body.originX,actor.body.originY).setFlipX(actor.body.flipX)
          .setScale(actor.body.scaleX,actor.body.scaleY).setAngle(actor.body.angle)
          .setCrop(0,0,frameMeta.width,split).setVisible(true);
        actor.body.setCrop(0,split,frameMeta.width,frameMeta.height-split);
      }
      if((this.state==='knockdown'||this.state==='dead')&&this.grounded){
        // Rotating around the feet can drive a long prop below the stage.
        // Lift only the rendered sprite; physics and collision stay unchanged.
        const below=actor.body.getBounds().bottom-pose.y;
        if(below>0)actor.body.setY(pose.y-below);
      }
      actor.body.clearTint();
      if (this.state === 'hitstun' || this.state === 'juggle') actor.body.setTint(0xffffff);
      if (this.state === 'stunned') actor.body.setTint(0xffef8a);
      if (this.state === 'grabbed') actor.body.setTint(0xffc38f);
      if (this.state === 'block' || this.state === 'blockstun') actor.body.setTint(0x9dffbd);
    } else if (actor.body instanceof Phaser.GameObjects.Rectangle) {
      actor.body.setScale(pose.facing, this.state === 'crouch' ? 0.58 : 1);
      actor.body.setFillStyle(this.playerNum === 1 ? 0xd44949 : 0x426edb);
      if (this.state === 'attack') actor.body.setFillStyle(0xf2b84b);
      if (this.state === 'hitstun' || this.state === 'juggle') actor.body.setFillStyle(0xffffff);
      if (this.state === 'block' || this.state === 'blockstun') actor.body.setFillStyle(0x62d980);
    }

    actor.body.setAlpha(this.invulnerable ? 0.55 : 1);
  }

  private currentVisualFrame(actor?: FighterActorRuntime): { sheet: SpriteSheetId; frame: number } {
    const visualDelay = this.fusionFrames > 0 ? 0 : (actor?.config.visualDelay ?? 0);
    const sprite = actor ? this.spriteForActor(actor) : this.config.sprite;
    if(this.controlledSummon && actor){
      const victim=(this.scene as FighterScene).fighters?.find(f=>f.grabbedBy===this&&f.grabHold?.actorGrip?.actor===actor.id);
      if(victim?.grabHold?.actorGrip){
        // Keep the closing/cupped section on the victim, rather than playing
        // the opening recovery while the opponent is still attached.
        const row=this.currentMove?.animation??'hands_pinch';
        const count=sprite?.frameCounts[row]??24;
        const grip=victim.grabHold.actorGrip;
        const first=grip.holdStartFrame??Math.floor(count*.375),last=grip.holdEndFrame??Math.floor(count*.667);
        return {sheet:row,frame:heldGripFrame(first,last,victim.grabHold.remaining,grip.duration,count)};
      }
      if(actor.id!==this.controlledSummon.actor || !this.currentMove?.controlledActor){
        const row=actor.id===this.controlledSummon.actor?'hands_idle':'idle';
        return {sheet:row,frame:stateRowFrame(this.simulationTick,sprite?.frameCounts[row]??1,true)};
      }
    }
    if(['dash','air_dodge','wavedash'].includes(this.state)){
      const row=this.state==='dash'?(this.movementDirection===this.facing?'dash_forward':'dash_back'):this.state==='air_dodge'?'jump':'crouch';
      if(sprite?.frameCounts[row])return {sheet:row,frame:stateRowFrame(this.stateFrame,sprite.frameCounts[row]!,false)};
    }
    if (this.currentMove && (MOVE_SHEETS.has(this.currentMove.animation as SpriteSheetId) || (sprite?.frameCounts[this.currentMove.animation] ?? 0) > 0)) {
      return {
        sheet: this.currentMove.animation as SpriteSheetId,
        frame: this.moveVisualFrame(this.currentMove, visualDelay, sprite),
      };
    }

    // State-driven row playback (T21): if this fighter owns a dedicated row for
    // the current state (jump/crouch/block), play it. Gated on row ownership so
    // fighters without these rows fall through to the base logic below,
    // byte-for-byte unchanged.
    const preferred=this.config.poseStyle==='fluid'?this.config.animations[this.state]:undefined;
    const stateSheet = preferred && sprite?.frameCounts[preferred] ? preferred : resolveStateSheet(this.state, (row) => (sprite?.frameCounts?.[row] ?? 0) > 0);
    if (stateSheet !== 'base') {
      const elapsed = Math.max(0, this.stateFrame - visualDelay);
      const count=sprite?.frameCounts?.[stateSheet]??1;
      const reaction=['hitstun','stunned','juggle'].includes(this.state);
      const duration=sprite?.rowPlayback?.[stateSheet]?.durationTicks;
      if(duration)return {sheet:stateSheet,frame:timedStateRowFrame(elapsed,count,duration)};
      return {
        sheet: stateSheet,
        frame: reaction?timedStateRowFrame(elapsed,count,this.stateFrame+this.hitstun):this.state==='getup'?timedStateRowFrame(elapsed,count,25):this.state==='landing'?timedStateRowFrame(elapsed,count,4):stateRowFrame(elapsed,count,sprite?.rowPlayback?.[stateSheet]?.loop??isLoopingStateRow(stateSheet),sprite?.rowPlayback?.[stateSheet]?.ticksPerFrame),
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
      block: 3,
      blockstun: 3,
      hitstun: 3,
      grabbed: 3,
      stunned: 3,
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
    return moveVisualFrameAt(move, elapsed, frameCount);
  }

  setActiveHitbox(id: string, hitbox: Hitbox, actorId?: FighterActorId, keyframes?: HitboxKeyframe[]): void {
    this.activeHitboxes.set(id, { actorId, hitbox, keyframes, age: 0 });
  }

  ageActiveHitboxes(): void {
    for (const active of this.activeHitboxes.values()) {
      active.age += 1;
    }
    for (const active of this.activeGrabs.values()) active.age += 1;
  }

  clearActiveHitbox(id: string): void {
    this.activeHitboxes.delete(id);
  }

  setActiveGrab(id: string, grab: GrabSpec, actorId?: FighterActorId, keyframes?: HitboxKeyframe[]): void {
    this.activeGrabs.set(id, { actorId, grab, keyframes, age: 0 });
  }

  clearActiveGrab(id: string): void {
    this.activeGrabs.delete(id);
  }

  getActiveGrabsWorld(): Array<{ actorId: FighterActorId; id: string; grab: GrabSpec; world: AABB }> {
    return [...this.activeGrabs.entries()].map(([id, active]) => {
      const actor = this.actorFor(this.fusionFrames > 0 ? this.primaryActorId() : (active.actorId ?? this.primaryActorId()));
      const pose = this.actorPose(actor);
      return {
        actorId: actor.id,
        id,
        grab: active.grab,
        world: boxToWorld(scaledBox(interpolateHitboxGeometry({ hitbox: active.grab.hitbox, keyframes: active.keyframes, age: active.age }),this.stats.size), pose.x, pose.y, pose.facing),
      };
    });
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
    if(actor.config.summon)return this.controlledSummon?.actor===actor.id;
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
    if(this.controlledSummon?.actor===actor.id){
      const victim=(this.scene as FighterScene).fighters?.find(f=>f.grabbedBy===this&&f.grabHold?.actorGrip?.actor===actor.id);
      const grip=victim?.grabHold?.actorGrip;
      if(victim&&grip)return {x:victim.x-grip.socketX*grip.facing,y:victim.y+grip.torsoY-grip.socketY,facing:grip.facing};
      return this.controlledSummon;
    }
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
