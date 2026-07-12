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
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 450,
  },
  fps: {
    target: 60,
    forceSetTimeOut: true,
  },
  scene: [FightScene],
};

// Merge CMS-exported fighters into the roster before the scenes construct;
// loadCmsRoster never rejects, so the game always starts.
loadCmsRoster().then(() => {
  const game = new Phaser.Game(config);

  shell.onChange(() => {
    game.scale.refresh();
  });
});
