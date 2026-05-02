import Phaser from 'phaser';

export type HitFxKind = 'hit' | 'heavy' | 'block' | 'ko';

const PALETTE: Record<HitFxKind, { color: number; size: number; rays: number; durationMs: number }> = {
  hit: { color: 0xffe066, size: 22, rays: 6, durationMs: 220 },
  heavy: { color: 0xffb14b, size: 34, rays: 8, durationMs: 280 },
  block: { color: 0x9eecff, size: 18, rays: 5, durationMs: 200 },
  ko: { color: 0xffffff, size: 60, rays: 14, durationMs: 420 },
};

export class HitFx {
  static spark(scene: Phaser.Scene, x: number, y: number, kind: HitFxKind = 'hit'): void {
    const palette = PALETTE[kind];
    const graphics = scene.add.graphics({ x, y }).setDepth(120);
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(0, 0, palette.size * 0.32);
    graphics.lineStyle(3, palette.color, 1);
    for (let i = 0; i < palette.rays; i += 1) {
      const angle = (Math.PI * 2 * i) / palette.rays + Math.random() * 0.45;
      const len = palette.size * (0.7 + Math.random() * 0.6);
      graphics.lineBetween(0, 0, Math.cos(angle) * len, Math.sin(angle) * len);
    }
    scene.tweens.add({
      targets: graphics,
      alpha: 0,
      scaleX: { from: 0.6, to: 1.7 },
      scaleY: { from: 0.6, to: 1.7 },
      duration: palette.durationMs,
      ease: 'Cubic.Out',
      onComplete: () => graphics.destroy(),
    });
  }

  static shake(scene: Phaser.Scene, durationMs: number, intensity: number): void {
    scene.cameras.main.shake(durationMs, intensity);
  }

  static flashWhite(scene: Phaser.Scene, durationMs: number): void {
    scene.cameras.main.flash(durationMs, 255, 255, 255, false);
  }

  static comboPopup(scene: Phaser.Scene, x: number, y: number, count: number, side: 1 | 2): void {
    const clampedX = Phaser.Math.Clamp(x, 80, 720);
    const text = scene.add
      .text(clampedX, y, `${count} HITS!`, {
        color: side === 1 ? '#ff8a78' : '#8de6ff',
        fontFamily: 'monospace',
        fontSize: '22px',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(130);
    scene.tweens.add({
      targets: text,
      y: y - 36,
      alpha: 0,
      scaleX: { from: 1.5, to: 1.0 },
      scaleY: { from: 1.5, to: 1.0 },
      duration: 700,
      ease: 'Quad.Out',
      onComplete: () => text.destroy(),
    });
  }
}
