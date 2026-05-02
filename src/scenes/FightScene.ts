import Phaser from 'phaser';
import { playableCharacters } from '../characters/stamptownFighters';
import { ComputerPlayer } from '../core/ComputerPlayer';
import { Fighter } from '../core/Fighter';
import { GameLoop } from '../core/GameLoop';
import { HitboxSystem } from '../core/HitboxSystem';
import { InputReader } from '../core/InputReader';
import { ProjectilePool } from '../core/ProjectilePool';
import { TouchInput } from '../core/TouchInput';
import type { CharacterConfig, CharacterSpriteConfig, SpriteFrameMeta, SpriteSheetId } from '../schema/types';
import { LayoutShell } from '../ui/LayoutShell';
import { prefersTouchControls } from '../util/device';
import { DebugOverlay } from './DebugOverlay';

const FLOOR_Y = 390;
const ROUND_FRAMES = 99 * 60;
const STAGE_LEFT = 96;
const STAGE_RIGHT = 704;
const MIN_FIGHTER_DISTANCE = 96;
const SPRITE_ASSET_VERSION = 'animation-timeline-v1';
const DEBUG_MOVE_KEYS: Record<string, { player: 0 | 1; moveId: string }> = {
  Digit1: { player: 0, moveId: 'fireball' },
  Digit2: { player: 0, moveId: 'dash_punch' },
  Digit3: { player: 0, moveId: 'uppercut' },
  Digit7: { player: 1, moveId: 'fireball' },
  Digit8: { player: 1, moveId: 'dash_punch' },
  Digit9: { player: 1, moveId: 'uppercut' },
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
  fighters!: [Fighter, Fighter];
  projectiles!: ProjectilePool;
  hitPauseFrames = 0;
  roundTimer = ROUND_FRAMES;
  debugMode = true;
  frameCounter = 0;

  readonly gameLoop = new GameLoop();
  readonly computerPlayer = new ComputerPlayer();
  singlePlayer = true;
  isPaused = false;
  selectedP1Id = playableCharacters[0].id;
  selectedP2Id = playableCharacters[2].id;
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
    this.hasSceneData = Object.keys(data).length > 0;
    this.selectedP1Id = data.p1Id ?? playableCharacters[0].id;
    this.selectedP2Id = data.p2Id ?? playableCharacters[2].id;
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
    this.load.image('cardbross_cross', this.assetUrl('/fighters/mr_cardboard/projectiles/cardbross_cross.png'));
    this.load.image('hi_vis_vest', this.assetUrl('/fighters/viggo/projectiles/hi_vis_vest.png'));
    this.load.image('bucket_wave', this.assetUrl('/fighters/janitor/projectiles/bucket_wave.png'));
    this.load.image('apple_shards', this.assetUrl('/fighters/jack_tucker/projectiles/apple_shards.png'));

    for (const character of playableCharacters) {
      if (!character.sprite) continue;
      for (const [sheet, frameCount] of Object.entries(character.sprite.frameCounts)) {
        if (!frameCount) continue;
        const sheetId = sheet as SpriteSheetId;
        const frameMeta = character.sprite.frames?.[sheetId];
        for (let frame = 1; frame <= frameCount; frame += 1) {
          const frameNumber = String(frame).padStart(3, '0');
          this.load.image(
            `${character.id}:${sheet}:${frame - 1}`,
            this.assetUrl(frameMeta?.[frame - 1]
              ? `${character.sprite.basePath}/${frameMeta[frame - 1].file}`
              : `${character.sprite.basePath}/sprites/${sheet}/${sheet}_${frameNumber}.png`),
          );
        }
      }
    }
  }

  create(): void {
    const params = new URLSearchParams(window.location.search);
    if (!this.hasSceneData && params.get('cpu') === 'off') this.singlePlayer = false;
    const p1FromQuery = params.get('p1');
    const p2FromQuery = params.get('p2');
    if (!this.hasSceneData) {
      if (p1FromQuery) this.selectedP1Id = this.characterFromParam(p1FromQuery, playableCharacters[0]).id;
      if (p2FromQuery) this.selectedP2Id = this.characterFromParam(p2FromQuery, playableCharacters[2]).id;
    }

    this.cameras.main.setBackgroundColor('#141820');
    this.createProjectileTextures();
    if (params.get('debug') === 'sprites') {
      this.createSpriteDebugView(params);
      return;
    }
    if (
      this.showCharacterSelect ||
      params.get('select') === '1' ||
      (!this.hasSceneData && !p1FromQuery && !p2FromQuery && this.p1Rounds === 0 && this.p2Rounds === 0)
    ) {
      this.createCharacterSelectScreen();
      return;
    }

    this.add.rectangle(400, FLOOR_Y + 30, 800, 120, 0x20262f).setOrigin(0.5, 0);
    this.add.rectangle(400, FLOOR_Y + 1, 800, 2, 0x9aa8bb);

    this.projectiles = new ProjectilePool(this);
    this.fighters = [
      new Fighter(this, this.characterFromParam(this.selectedP1Id, playableCharacters[0]), 1, { x: 200, y: FLOOR_Y }),
      new Fighter(this, this.characterFromParam(this.selectedP2Id, playableCharacters[2]), 2, { x: 600, y: FLOOR_Y }),
    ];

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

    this.input.keyboard?.on('keydown-F1', () => {
      this.debugMode = !this.debugMode;
      if (!this.debugMode) DebugOverlay.clear(this);
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
    this.installDebugHooks();
    this.installTouchHooks();

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
    shell.controls.setPauseHandler(() => {
      if (this.roundResolved) return;
      this.setPaused(!this.isPaused);
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
      shell.controls.setPauseHandler(() => {});
      shell.controls.releaseAll();
      TouchInput.clearAll();
    });
  }

  update(time: number): void {
    if (!this.fighters) return;
    this.gameLoop.update(time, () => this.fixedUpdate());
  }

  fixedUpdate(): void {
    if (!this.fighters || !this.projectiles) return;

    if (this.roundResolved) {
      this.renderFrame();
      return;
    }

    if (this.isPaused) {
      this.renderFrame();
      return;
    }

    if (this.hitPauseFrames > 0) {
      this.hitPauseFrames -= 1;
      this.renderFrame();
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
      HitboxSystem.checkAll(this.fighters, this.projectiles);
      this.roundTimer -= 1;
      this.frameCounter += 1;
      if (this.isRoundOver()) this.resolveRound();
    }

    this.renderFrame();
  }

  renderFrame(): void {
    this.renderHUD();
    if (this.debugMode) DebugOverlay.render(this);
  }

  private renderHUD(): void {
    if (!this.fighters) return;
    const [p1, p2] = this.fighters;
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
      : `${this.singlePlayer ? 'CPU: ON' : 'CPU: OFF'}  click/F2  P/Esc pause  R reset  P1:1-3 P2:7-9`;
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
          'F2             Toggle CPU',
          'R              Restart round',
          '',
          'P1             WASD move, F/G/H attacks',
          'P2             Arrows move, J/K/L attacks',
          '',
          'QCF + H/L      Projectile special',
          'F, F + F/J     Dash special',
          'F, D, DF + H/L Uppercut special',
          'Down + G/K     Low attack',
          '',
          'Debug moves    P1: 1/2/3   P2: 7/8/9',
        ].join('\n'),
        {
          color: '#dbe7ff',
          fontFamily: 'monospace',
          fontSize: '13px',
          lineSpacing: 3,
        },
      )
      .setOrigin(0, 0);

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
    let p1Id = this.selectedP1Id;
    let p2Id = this.selectedP2Id;
    const cardBackgrounds: Array<{ characterId: string; player: 1 | 2; rect: Phaser.GameObjects.Rectangle }> = [];
    const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      color: '#dbe7ff',
      fontFamily: 'monospace',
      fontSize: '12px',
      align: 'center',
    };

    this.add.rectangle(400, 225, 800, 450, 0x141820, 1);
    this.add.rectangle(400, FLOOR_Y + 30, 800, 120, 0x20262f).setOrigin(0.5, 0);
    this.add.rectangle(400, FLOOR_Y + 1, 800, 2, 0x9aa8bb);
    this.add
      .text(400, 28, 'CHARACTER SELECT', {
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '24px',
      })
      .setOrigin(0.5, 0);
    const helpText = this.add
      .text(400, 60, 'Click a card in each row. CPU uses P2 when enabled.', {
        color: '#8de6ff',
        fontFamily: 'monospace',
        fontSize: '12px',
      })
      .setOrigin(0.5, 0);

    const updateCards = (): void => {
      for (const card of cardBackgrounds) {
        const selected = card.player === 1 ? card.characterId === p1Id : card.characterId === p2Id;
        card.rect.setStrokeStyle(2, selected ? 0xfff0a3 : 0x485568, selected ? 1 : 0.85);
        card.rect.setFillStyle(selected ? 0x24364b : 0x0b0e13, 1);
      }
      helpText.setText(`P1: ${this.characterFromParam(p1Id, playableCharacters[0]).displayName}     P2: ${this.characterFromParam(p2Id, playableCharacters[2]).displayName}     CPU: ${this.singlePlayer ? 'ON' : 'OFF'}`);
    };

    const createRow = (player: 1 | 2, y: number): void => {
      this.add
        .text(36, y + 44, `P${player}`, {
          color: player === 1 ? '#ff9b8f' : '#8de6ff',
          fontFamily: 'monospace',
          fontSize: '18px',
        })
        .setOrigin(0, 0.5);
      playableCharacters.forEach((character, index) => {
        const x = 88 + index * 124;
        const rect = this.add.rectangle(x, y, 112, 112, 0x0b0e13, 1).setInteractive({ useHandCursor: true });
        rect.on('pointerdown', () => {
          if (player === 1) p1Id = character.id;
          else p2Id = character.id;
          updateCards();
        });
        cardBackgrounds.push({ characterId: character.id, player, rect });
        const baseFrame = character.sprite ? this.debugFrameMeta(character.sprite, 'base', character.sprite.frameCounts.base ?? 1)[0] : null;
        const previewScale = baseFrame ? Math.min(0.34, 76 / Math.max(baseFrame.width, baseFrame.height)) : 0.5;
        this.add
          .sprite(x, y + 34, `${character.id}:base:0`)
          .setOrigin(0.5, 1)
          .setScale(previewScale);
        this.add.text(x, y - 48, character.displayName, { ...labelStyle, fontSize: '10px' }).setOrigin(0.5, 0);
      });
    };

    createRow(1, 152);
    createRow(2, 292);

    const startButton = this.createPauseButton(318, 406, 'START', () => {
      this.scene.restart({
        p1Id,
        p2Id,
        cpu: this.singlePlayer,
        p1Rounds: 0,
        p2Rounds: 0,
        roundNumber: 1,
      } satisfies FightSceneData);
    });
    const cpuButton = this.createPauseButton(436, 406, 'CPU', () => {
      this.toggleCpu();
      updateCards();
    });
    const backButton = this.createPauseButton(554, 406, 'DEFAULTS', () => {
      p1Id = playableCharacters[0].id;
      p2Id = playableCharacters[2].id;
      updateCards();
    });
    this.add.container(0, 0, [...startButton, ...cpuButton, ...backButton]).setDepth(10);
    updateCards();
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
    for (const character of playableCharacters) {
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
      { key: 'sound_wave', x: 104 },
      { key: 'feedback_wave', x: 230 },
      { key: 'cardbross_cross', x: 356 },
      { key: 'hi_vis_vest', x: 482 },
      { key: 'bucket_wave', x: 608 },
      { key: 'apple_shards', x: 734 },
    ].forEach(({ key, x }) => {
      const texture = this.textures.get(key).getSourceImage() as { width: number; height: number };
      const scale = Math.min(0.75, 86 / Math.max(texture.width, texture.height));
      this.add.image(x, y + 34, key).setOrigin(0.5).setScale(scale);
      this.add.text(x - 42, y + 62, key, labelStyle).setOrigin(0, 0);
    });

    this.cameras.main.setBounds(0, 0, 800, Math.max(450, y + 110));
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
      this.cameras.main.scrollY = Phaser.Math.Clamp(this.cameras.main.scrollY + dy * 0.7, 0, Math.max(0, y - 340));
    });
  }

  private installDebugHooks(): void {
    const win = window as typeof window & {
      __stamptownDebug?: {
        startMove: (player: 1 | 2, moveId: string) => boolean;
        setCpu: (enabled: boolean) => void;
        frame: () => number;
      };
    };
    win.__stamptownDebug = {
      startMove: (player, moveId) => this.fighters[player - 1].debugStartMove(moveId),
      setCpu: (enabled) => {
        this.singlePlayer = enabled;
      },
      frame: () => this.frameCounter,
    };
  }

  private assetUrl(path: string): string {
    const requestedVersion = new URLSearchParams(window.location.search).get('v');
    const version = encodeURIComponent(requestedVersion || SPRITE_ASSET_VERSION);
    return `${path}?v=${version}`;
  }

  private characterFromParam(id: string | null, fallback: CharacterConfig): CharacterConfig {
    if (!id) return fallback;
    return playableCharacters.find((character) => character.id === id) ?? fallback;
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
    const [leftFighter, rightFighter] =
      this.fighters[0].x <= this.fighters[1].x ? this.fighters : [this.fighters[1], this.fighters[0]];
    const overlap = MIN_FIGHTER_DISTANCE - (rightFighter.x - leftFighter.x);
    if (overlap <= 0) return;

    const midpoint = (leftFighter.x + rightFighter.x) / 2;
    let leftX = midpoint - MIN_FIGHTER_DISTANCE / 2;
    let rightX = midpoint + MIN_FIGHTER_DISTANCE / 2;

    if (leftX < STAGE_LEFT) {
      leftX = STAGE_LEFT;
      rightX = STAGE_LEFT + MIN_FIGHTER_DISTANCE;
    } else if (rightX > STAGE_RIGHT) {
      rightX = STAGE_RIGHT;
      leftX = STAGE_RIGHT - MIN_FIGHTER_DISTANCE;
    }

    leftFighter.x = leftX;
    rightFighter.x = rightX;
    leftFighter.refreshVisuals();
    rightFighter.refreshVisuals();
  }
}
