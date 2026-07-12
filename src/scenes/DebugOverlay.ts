import type { FightScene } from './FightScene';
import { DEBUG_COLORS, DebugPanel } from './DebugPanel';

export class DebugOverlay {
  static render(scene: FightScene): void {
    scene.debugGraphics.clear();

    const panel = DebugPanel.current();

    // If no panel is present, fall back to drawing everything (backward compat).
    const showHurtboxes = (actorKey: string) => !panel || panel.isEnabled('hurtboxes', actorKey);
    const showHitboxes = (actorKey: string) => !panel || panel.isEnabled('hitboxes', actorKey);
    const showProjectiles = !panel || panel.isEnabled('projectileBoxes');
    const showReadout = !panel || panel.isEnabled('readout');

    for (const fighter of scene.fighters) {
      const actorKey = `P${fighter.playerNum}` as 'P1' | 'P2';
      const colors = DEBUG_COLORS[actorKey];

      if (showHurtboxes(actorKey)) {
        for (const hurtbox of fighter.getHurtboxesWorld()) {
          scene.debugGraphics.fillStyle(colors.hurtbox.fill, 0.22);
          scene.debugGraphics.fillRect(hurtbox.world.x, hurtbox.world.y, hurtbox.world.width, hurtbox.world.height);
          scene.debugGraphics.lineStyle(1, colors.hurtbox.stroke, 0.95);
          scene.debugGraphics.strokeRect(hurtbox.world.x, hurtbox.world.y, hurtbox.world.width, hurtbox.world.height);
        }
      }

      if (showHitboxes(actorKey)) {
        for (const active of fighter.getActiveHitboxesWorld()) {
          scene.debugGraphics.fillStyle(colors.hitbox.fill, 0.35);
          scene.debugGraphics.fillRect(active.world.x, active.world.y, active.world.width, active.world.height);
          scene.debugGraphics.lineStyle(2, colors.hitbox.stroke, 0.95);
          scene.debugGraphics.strokeRect(active.world.x, active.world.y, active.world.width, active.world.height);
        }
        for (const active of fighter.getActiveGrabsWorld()) {
          scene.debugGraphics.fillStyle(0x37d67a, 0.3);
          scene.debugGraphics.fillRect(active.world.x, active.world.y, active.world.width, active.world.height);
          scene.debugGraphics.lineStyle(2, 0x37d67a, 0.95);
          scene.debugGraphics.strokeRect(active.world.x, active.world.y, active.world.width, active.world.height);
        }
      }
    }

    if (showProjectiles) {
      for (const projectile of scene.projectiles.active) {
        const box = scene.projectiles.getHitboxWorld(projectile);
        scene.debugGraphics.fillStyle(DEBUG_COLORS.projectile.fill, 0.3);
        scene.debugGraphics.fillRect(box.x, box.y, box.width, box.height);
        scene.debugGraphics.lineStyle(1, DEBUG_COLORS.projectile.stroke, 0.95);
        scene.debugGraphics.strokeRect(box.x, box.y, box.width, box.height);
      }
    }

    if (showReadout) {
      scene.debugReadout.setVisible(true);
      const lines = scene.fighters.map((fighter) => {
        const move = fighter.currentMove;
        return [
          `P${fighter.playerNum} ${fighter.state} f:${fighter.stateFrame}`,
          `move:${move?.id ?? '-'} phase:${fighter.movePhaseIndex} phaseF:${fighter.movePhaseFrame}`,
          `hit:${fighter.hitstun} block:${fighter.blockstun} hp:${Math.ceil(fighter.health)}`,
        ].join(' | ');
      });
      scene.debugReadout.setText([`frame:${scene.frameCounter} timer:${Math.ceil(scene.roundTimer / 60)} debug:F1 panel:F3`, ...lines].join('\n'));
    } else {
      scene.debugReadout.setVisible(false);
    }
  }

  static clear(scene: FightScene): void {
    scene.debugGraphics.clear();
    scene.debugReadout.setVisible(false);
  }
}
