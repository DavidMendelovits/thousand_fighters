import {motionProfile} from '../motionProfiles.js';
import {characterArtDirection} from './pixelArtDirection.js';
import {withMotionReviewFeedback} from '../../../shared/motionReviewFeedback.js';

/** The workbench action brief is authoritative. Saved recipes are defaults,
 * not a hidden override of the text a creator edits before regeneration. */
export function workbenchMotionPrompt({draft,row,prompt,actorId}) {
  const artStyle=['watercolor','paint'].includes(draft.artStyle)?draft.artStyle:'pixel';
  const actor=draft.actors?.find(item=>item.id===actorId);
  const actorIdle=Boolean(actor&&actor.idleAnimation===row);
  const profile={...motionProfile(row,'',{artStyle}),...(actorIdle?{loop:true,frames:20}: {})};
  const action=prompt?.trim()||draft.motionPrompts?.[row]?.trim()||profile.prompt;
  const move=draft.moves?.find(m=>m.id===row||m.animation===row);
  const grip=move?.phases?.flatMap(p=>p.events??[]).some(e=>e.event?.grab?.actorGrip);
  const subject=actorId?'summoned entity':artStyle==='paint'?'nonhuman creature':'fighter';
  const parts=[
    `Animate ONLY this exact reference ${subject}.`, action,
    actorId?`IDENTITY LOCK: exactly ONE ${actor?.description??actorId}. Never split, duplicate, transform, add a second orb or detached eye, or show the parent fighter. The game spawns any projectiles separately.`:'',
    actorIdle?'IDLE LOOP ONLY: gently hover in place by a few pixels while fins undulate. No dash, attack, collision, explosion, projectile, or extra creature. End in the exact opening pose so the loop joins cleanly.':'',
    grip?'Paired capture: close opposing palms around empty torso space, keep a clear upper/back palm and lower/front palm, maintain a stable grip for the engine-controlled lift and swing, then visibly open to release. Keep the grip center fixed in this actor pass; do not generate an opponent.':'',
    move?.extension?'ATTACHED REACH IS RENDERED BY THE GAME ENGINE: animate the body anticipation, a short connection nub at the socket, contact pose and recovery. Do not paint the long ribbon, tentacle, cable or opponent wrap into this video; those would double the gameplay effect.':'',
    characterArtDirection(artStyle),
    'Fixed side-view camera. Animate in place; the engine supplies world translation. Preserve reference palette, material, props, facing and identity. No opponent, text or scenery. Entire subject visible with generous margins.',
    artStyle==='paint'?'Background stays uniform white.':'Flat #ff00ff background, no floor shadow. Stay facing RIGHT. Projectiles and long extensions are separate game entities; animate only this actor and its held props.',
  ];
  return {artStyle,profile,motionPrompt:withMotionReviewFeedback(parts.filter(Boolean).join(' '),draft,row)};
}
