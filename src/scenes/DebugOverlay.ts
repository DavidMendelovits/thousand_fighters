import type { FightScene } from './FightScene';

export class DebugOverlay {
  static render(scene: FightScene): void {
    scene.debugGraphics.clear();
    scene.debugReadout.setVisible(true);

    for (const fighter of scene.fighters) {
      for (const hurtbox of fighter.getHurtboxesWorld()) {
        scene.debugGraphics.fillStyle(0x3498ff, 0.22);
        scene.debugGraphics.fillRect(hurtbox.world.x, hurtbox.world.y, hurtbox.world.width, hurtbox.world.height);
        scene.debugGraphics.lineStyle(1, 0x74b9ff, 0.95);
        scene.debugGraphics.strokeRect(hurtbox.world.x, hurtbox.world.y, hurtbox.world.width, hurtbox.world.height);
      }

      for (const active of fighter.getActiveHitboxesWorld()) {
        scene.debugGraphics.fillStyle(0xff3b30, 0.35);
        scene.debugGraphics.fillRect(active.world.x, active.world.y, active.world.width, active.world.height);
        scene.debugGraphics.lineStyle(2, 0xff6b5f, 0.95);
        scene.debugGraphics.strokeRect(active.world.x, active.world.y, active.world.width, active.world.height);
      }
    }

    for (const projectile of scene.projectiles.active) {
      const box = scene.projectiles.getHitboxWorld(projectile);
      scene.debugGraphics.fillStyle(0x3dff7a, 0.3);
      scene.debugGraphics.fillRect(box.x, box.y, box.width, box.height);
      scene.debugGraphics.lineStyle(1, 0x63ff94, 0.95);
      scene.debugGraphics.strokeRect(box.x, box.y, box.width, box.height);
    }

    const lines = scene.fighters.map((fighter) => {
      const move = fighter.currentMove;
      return [
        `P${fighter.playerNum} ${fighter.state} f:${fighter.stateFrame}`,
        `move:${move?.id ?? '-'} phase:${fighter.movePhaseIndex} phaseF:${fighter.movePhaseFrame}`,
        `hit:${fighter.hitstun} block:${fighter.blockstun} hp:${Math.ceil(fighter.health)}`,
      ].join(' | ');
    });

    scene.debugReadout.setText([`frame:${scene.frameCounter} timer:${Math.ceil(scene.roundTimer / 60)} debug:F1`, ...lines].join('\n'));
  }

  static clear(scene: FightScene): void {
    scene.debugGraphics.clear();
    scene.debugReadout.setVisible(false);
  }
}
