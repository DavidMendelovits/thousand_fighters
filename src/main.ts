import Phaser from 'phaser';
import { FightScene } from './scenes/FightScene';
import { loadCmsRoster } from './characters/roster';
import { CANVAS_PARENT_ID, LayoutShell } from './ui/LayoutShell';
import './style.css';

const shell = new LayoutShell();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: CANVAS_PARENT_ID,
  backgroundColor: '#141820',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 450,
  },
  fps: {
    target: 60,
    forceSetTimeOut: false,
  },
  scene: [FightScene],
};

// Merge CMS-exported fighters into the roster before the scenes construct;
// loadCmsRoster never rejects, so the game always starts.
loadCmsRoster().then((roster) => {
  if (!roster.length) {
    const message = document.createElement('p');
    message.textContent = 'Fighters could not load. Check your connection and reload.';
    message.style.cssText = 'padding:32px;color:white';
    shell.canvasParent.append(message);
    return;
  }
  const game = new Phaser.Game(config);

  shell.onChange(() => {
    game.scale.refresh();
  });
  // The thumb deck changes the parent's available height without necessarily
  // changing orientation. Keep FIT bounds in sync with the actual arena box.
  const resize = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
      game.scale.setParentSize(entry.contentRect.width, entry.contentRect.height);
    }
  });
  resize.observe(shell.canvasParent);
  game.events.once(Phaser.Core.Events.DESTROY, () => resize.disconnect());
});
