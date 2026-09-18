import Phaser from 'phaser';
import type { Fighter } from './Fighter';
import type { CharacterConfig, ProjectileConfig,FighterScene } from '../schema/types';

/** Small code-native pixel effects, independent of the generated actor art. */
export function createCombatTextures(scene: Phaser.Scene, configs: CharacterConfig[]): void {
  for (const config of configs) for (const move of config.moves) for (const phase of move.phases) for (const { event } of phase.events) {
    if (!('projectile' in event)) continue;
    const p: ProjectileConfig = event.projectile;
    if (!p.visual || scene.textures.exists(p.animation)) continue;
    const g = scene.add.graphics();
    const { kind, color, accent } = p.visual;
    if(kind.startsWith('paint-')) {
      // Layered translucent pigment, not opaque pixel blocks. Seeded grain is
      // stable across frames; all flying effects remain independent entities.
      const dab=(x:number,y:number,w:number,h:number,c:number)=>{
        for(let layer=3;layer>=0;layer--)g.fillStyle(c,.13).fillEllipse(x,y,w+layer*2,h+layer*2);
        for(let n=0;n<36;n++){
          const a=n*2.39996,r=Math.sqrt((n+.5)/36);
          g.fillStyle(n%3?c:accent,.16).fillEllipse(x+Math.cos(a)*r*w*.45,y+Math.sin(a)*r*h*.45,1+n%3,1+n%2);
        }
      };
      if(kind==='paint-wave') {
        for(let n=0;n<13;n++){const a=-1.2+n*.2;dab(22+Math.cos(a)*18,32+Math.sin(a)*23,9,9,n%4?color:accent);}
      } else {
        dab(32,34,24,29,color);dab(27,28,10,11,accent);
        if(kind==='paint-fist') {
          g.generateTexture(`${p.animation}:drop`,64,64);g.clear();
          dab(22,37,28,18,color);dab(40,31,25,29,color);
          for(let n=0;n<4;n++)dab(29+n*6,20,8,14,n%2?color:accent);
        }
      }
      g.generateTexture(p.animation,64,64);g.destroy();continue;
    }
    const pixel = (x: number, y: number, w: number, h: number, c: number) => g.fillStyle(c).fillRect(x, y, w, h);
    if (kind === 'needle') {
      pixel(2, 14, 26, 4, 0x172332); pixel(8, 12, 16, 8, color); pixel(12, 14, 20, 4, accent);
      pixel(4, 10, 8, 2, color); pixel(0, 20, 12, 2, color);
    } else if (kind === 'cage') {
      for (let n = 0; n < 4; n++) { pixel(5 + n * 6, 4, 2, 24, color); pixel(4, 5 + n * 6, 24, 2, accent); }
      pixel(10, 10, 12, 12, color); pixel(12, 12, 8, 8, 0x172332);
    } else if (kind === 'wave') {
      for (let n = 0; n < 3; n++) { pixel(4 + n * 7, 5 + n * 2, 3, 22 - n * 4, color); pixel(7 + n * 7, 9 + n * 2, 3, 14 - n * 4, accent); }
    } else if (kind === 'scrap') {
      pixel(7, 6, 18, 22, 0x172332); pixel(9, 8, 14, 18, color); pixel(3, 13, 26, 6, color); pixel(13, 12, 6, 8, accent);
    } else if (kind === 'juggling-ball') {
      pixel(8, 3, 16, 26, 0x172332); pixel(3, 8, 26, 16, 0x172332);
      pixel(7, 7, 18, 18, color); pixel(11, 4, 10, 24, color); pixel(4, 11, 24, 10, color);
      pixel(16, 5, 5, 22, accent); pixel(6, 16, 21, 5, accent); pixel(9, 7, 5, 4, 0xffffff);
    } else if (kind === 'ink-fist') {
      // Separate ink droplet texture: it visibly resolves into the fist in flight.
      pixel(11, 7, 10, 19, color); pixel(7, 13, 18, 10, color); pixel(14, 2, 4, 10, color);
      pixel(12, 11, 4, 7, accent);
      g.generateTexture(`${p.animation}:drop`, 32, 32); g.clear();
      pixel(3, 14, 14, 12, color); pixel(12, 7, 17, 19, color);
      for (let n=0;n<3;n++) { pixel(14+n*5, 5, 4, 12, color); pixel(15+n*5, 7, 2, 7, accent); }
      pixel(13, 19, 11, 5, accent); pixel(3, 18, 8, 3, accent);
    } else if (kind === 'spore') {
      pixel(13, 10, 6, 21, color); pixel(5, 6, 22, 8, color); pixel(9, 3, 14, 5, accent);
      pixel(4, 23, 10, 3, color); pixel(18, 18, 10, 3, color);
    } else {
      pixel(8, 3, 16, 26, 0x172332); pixel(3, 8, 26, 16, 0x172332);
      pixel(7, 7, 18, 18, color); pixel(11, 4, 10, 24, color); pixel(4, 11, 24, 10, color);
      pixel(11, 8, 8, 7, accent); pixel(8, 11, 5, 6, accent);
    }
    g.generateTexture(p.animation, 32, 32); g.destroy();
  }
}

export class CombatVisuals {
  readonly graphics: Phaser.GameObjects.Graphics;
  constructor(private scene: Phaser.Scene) { this.graphics = scene.add.graphics().setDepth(15); }
  tick():void {
    const scene=this.scene as FighterScene;
    scene._combatImpacts=(scene._combatImpacts??[]).filter(i=>++i.age<i.spec.durationTicks);
  }

  draw(fighters: [Fighter, Fighter]): void {
    const g = this.graphics.clear();
    for(const impact of (this.scene as FighterScene)._combatImpacts??[]){
      const owner=impact.ownerId?fighters.find(f=>f.id===impact.ownerId):undefined;
      if(owner){impact.x=owner.x+(impact.offsetX??0)*owner.facing*owner.stats.size;impact.y=owner.y+(impact.offsetY??0)*owner.stats.size;}
      const {x,y,spec,blocked,age}=impact;const t=age/spec.durationTicks;
      const radius=spec.radius*(.45+t);const color=blocked?0xa6d7ff:spec.color;
      g.setAlpha(1);
      if(blocked||spec.kind==='pressure'||spec.kind==='bind'){
        for(let r=0;r<3;r++)g.lineStyle(Math.max(1,4-age/8),r%2?spec.accent:color,1-t).strokeEllipse(x,y+(spec.kind==='bind'?(r-1)*18:0),radius*2+r*9,spec.kind==='bind'?14:radius*1.6+r*9);
      }else for(let n=0;n<10;n++){
        const a=n*Math.PI/5+(spec.kind==='thread'?Math.PI/6:0);const px=Math.round(x+Math.cos(a)*radius),py=Math.round(y+Math.sin(a)*radius+(spec.kind==='shards'?t*t*25:0));
        g.fillStyle(n%3?color:spec.accent,1-t);
        if(spec.kind==='watercolor'){
          for(let layer=2;layer>=0;layer--)g.fillStyle(n%3?color:spec.accent,(1-t)*.22).fillEllipse(px,py,7+layer*5,5+layer*4);
        }
        else if(spec.kind==='electric'){g.fillRect(px,py,3,10).fillRect(px+3,py+7,8,3);}
        else if(spec.kind==='thread'){g.fillRect(px,py,14*(1-t)+2,2);}
        else if(spec.kind==='ink'){g.fillRect(px-4,py-4,9*(1-t)+2,7*(1-t)+2);}
        else if(spec.kind==='spores'){g.fillRect(px,py,5,5).fillRect(px-2,py-2,9,2);}
        else {g.fillRect(px,py,spec.kind==='shards'?7:4,4);}
      }
    }
    for (const f of fighters) {
      if(f.activeForm||f.powers.length){g.lineStyle(2,f.activeForm?0x87e7df:0xffd277,.6).strokeEllipse(f.x,f.y,58*f.stats.size,12);}
      if(['dash','air_dodge','wavedash'].includes(f.state))for(let n=0;n<4;n++)g.fillStyle(0x9edcd4,.5-n*.1).fillRect(Math.round(f.x-f.vx*(n+1)*2),Math.round(f.y-14+n*3),12,2);
      const held = fighters.find(v => v.grabbedBy === f && v.state === 'grabbed');
      const ext = f.currentMove?.extension;
      const grab = f.getActiveGrabsWorld()[0];
      const strike = f.getActiveHitboxesWorld()[0];
      const box = grab?.world ?? strike?.world;
      if ((ext && box) || held) {
        const color = ext?.color ?? Number.parseInt(f.config.concept?.accent.slice(1) ?? 'efc475', 16);
        const accent = ext?.accent ?? 0xffe6aa;
        const sx = f.x + 30 * f.facing, sy = f.y - 82;
        const ex = held ? held.x : box!.x + box!.width / 2;
        const ey = held ? held.y - 70 : box!.y + box!.height / 2;
        const count = Math.max(2, Math.ceil(Math.abs(ex - sx) / 3));
        const thickness = ext?.thickness ?? 4;
        const points: Array<{x:number;y:number}> = [];
        for (let i = 0; i <= count; i++) {
          const t = i / count;
          const wave = ext?.kind === 'elastic' ? 0 : Math.sin(t * Math.PI * 3 + f.stateFrame * .16) * 7 * Math.sin(t * Math.PI);
          const x = Math.round((sx + (ex - sx) * t) / 2) * 2;
          const y = Math.round((sy + (ey - sy) * t + wave) / 2) * 2;
          points.push({x,y});
        }
        if(ext?.kind==='paint-ribbon') {
          points.forEach(({x,y},i)=>{
            g.fillStyle(color,.22).fillEllipse(x,y,9,thickness+7);
            g.fillStyle(i%5?color:accent,.5).fillEllipse(x,y+Math.sin(i)*2,5,thickness);
          });
        }else{
          for (const {x,y} of points) g.fillStyle(0x18202a).fillRect(x - 2, y - thickness / 2 - 2, 6, thickness + 4);
          for (const {x,y} of points) g.fillStyle(color).fillRect(x, y - thickness / 2, 4, thickness);
          points.forEach(({x,y},i) => { if (i%4===0) g.fillStyle(accent).fillRect(x,y+1,3,3); });
        }
        if (ext?.kind === 'elastic') {
          g.fillStyle(0x251a18).fillRect(ex - 11, ey - 11, 24, 24);
          g.fillStyle(0xf68a35).fillRect(ex - 9, ey - 9, 20, 20);
          g.fillStyle(accent).fillRect(ex - 5, ey - 7, 8, 3);
        }
        if (ext?.kind === 'mic-cable') {
          g.fillStyle(0x10151e).fillRect(ex - 14, ey - 4, 19, 8);
          g.fillStyle(0x7f8b9d).fillRect(ex - 1, ey - 8, 14, 16);
          g.fillStyle(0xdbe5eb).fillRect(ex + 1, ey - 6, 10, 4);
          for (let n=0;n<3;n++) g.fillStyle(0x263441).fillRect(ex + 1, ey - 2+n*3, 10, 1);
        }
      }
      if (f.state === 'grabbed') {
        const color = f.grabbedBy?.currentMove?.extension?.color ?? Number.parseInt(f.grabbedBy?.config.concept?.accent.slice(1) ?? 'efc475', 16);
        for (let n = 0; n < 3; n++) {
          const paint=f.grabbedBy?.currentMove?.extension?.kind==='paint-ribbon';
          if(paint)g.lineStyle(9,color,.2).strokeEllipse(f.x,f.y-42-n*20,60,17);
          g.lineStyle(paint?5:3, color,paint?.6:1).strokeEllipse(Math.round(f.x), Math.round(f.y - 42 - n * 20), 58, 15);
        }
      }
      if (f.state === 'stunned') {
        for (let n = 0; n < 3; n++) {
          const angle = f.stateFrame * .13 + n * Math.PI * 2 / 3;
          const x = Math.round(f.x + Math.cos(angle) * 24), y = Math.round(f.y - 126 + Math.sin(angle) * 7);
          g.fillStyle(0xffe48b).fillRect(x - 4, y - 1, 8, 2).fillRect(x - 1, y - 4, 2, 8);
        }
      }
      if ((f.state === 'hitstun' || f.state === 'juggle') && f.stateFrame < 6) {
        const x = f.x, y = f.y - 70;
        for (let n = 0; n < 8; n++) {
          const a = n * Math.PI / 4;
          g.fillStyle(n % 2 ? 0xffffff : 0xffbd66).fillRect(Math.round(x + Math.cos(a) * 22), Math.round(y + Math.sin(a) * 22), 6, 6);
        }
      }
    }
  }
}
