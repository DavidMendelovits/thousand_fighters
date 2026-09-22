// Phaser's core entry deliberately omits physics and optional object factories.
// Keep this list aligned with the runtime routes, including the debug gallery.
import Phaser from 'phaser/src/phaser-core.js';
import Container from 'phaser/src/gameobjects/container/Container.js';
import Rectangle from 'phaser/src/gameobjects/shape/rectangle/Rectangle.js';
import Line from 'phaser/src/gameobjects/shape/line/Line.js';
import Clamp from 'phaser/src/math/Clamp.js';
import 'phaser/src/gameobjects/container/ContainerFactory.js';
import 'phaser/src/gameobjects/shape/rectangle/RectangleFactory.js';
import 'phaser/src/gameobjects/shape/line/LineFactory.js';

Object.assign(Phaser.GameObjects, { Container, Rectangle, Line });
Phaser.Math.Clamp = Clamp;
export default Phaser;
