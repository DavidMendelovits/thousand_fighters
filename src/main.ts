import Phaser from 'phaser';
import { FightScene } from './scenes/FightScene';
import './style.css';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 800,
  height: 450,
  backgroundColor: '#141820',
  fps: {
    target: 60,
    forceSetTimeOut: true,
  },
  scene: [FightScene],
};

new Phaser.Game(config);
