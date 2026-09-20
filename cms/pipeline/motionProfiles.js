/** Action contracts shared by batch generation, review, and runtime publication. */
export const MOTION_PROFILES = Object.freeze({
  idle: { loop: true, frames: 20, prompt: 'A lively fighting idle loop: relaxed rhythmic breathing, subtle shoulder and hip counter-motion, shifting weight between planted feet. One seamless cycle. No attacks, no walking.' },
  walk_forward: { loop: true, frames: 24, prompt: 'Walk briskly IN PLACE facing RIGHT for TWO complete natural stride cycles, like walking on a treadmill. Alternate left and right feet, heel contact, weight transfer, passing foot, toe-off; knees bend and arms counter-swing. Feet lift clearly. Torso stays centered, no sideways travel. Do not slide a static pose. Maintain right-facing profile throughout.' },
  walk_back: { loop: true, frames: 24, prompt: 'Backpedal IN PLACE while facing RIGHT throughout, TWO complete backward fighting-footwork cycles. Alternating feet step backward then recover, bent knees and lively guarded upper body. Stay centered like a treadmill. Never turn around, never moonwalk a frozen pose.' },
  punch: { frames: 18, prompt: 'One decisive forward jab: wind up with shoulder rotation, snap free fist toward RIGHT with full arm extension and hip rotation, follow through, recoil, settle back to the reference ready stance. A readable whole-body attack, not just hand movement. Keep handheld prop close in the other hand.' },
  kick: { frames: 20, prompt: 'One powerful RIGHT-facing waist-height side kick: knee chamber, pivot supporting foot, extend kicking leg horizontally, hip and torso counterbalance, retract knee, plant foot, return to ready stance. Full body visible throughout.' },
  juggle: { frames: 24, prompt: 'Three quick alternating UNDERHAND THROW gestures toward RIGHT, with expressive hip and shoulder rhythm: scoop, release, catch-ready, scoop, release, scoop, release, return to stance. Microphone stays in other hand. BODY PASS ONLY: no balls or other flying objects; engine adds them at hand release.' },
  sound: { frames: 20, prompt: 'Raise microphone to mouth, take a deep breath leaning back, then lunge upper body forward and project a powerful vocal shout toward RIGHT, free arm thrust out for emphasis; recover to ready stance. Feet stay grounded. No visible sound waves or VFX; body animation only.' },
  ink: { frames: 20, prompt: 'Draw with a small black ink brush: wind up brush arm across chest, sweep a large forceful arc outward toward RIGHT with shoulders and hips, finish with a sharp forward wrist flick, recoil to ready stance. No floating ink or VFX; engine spawns them.' },
  cable: { frames: 24, prompt: 'Dynamic cable-cast BODY animation: wind up free arm behind shoulder, cast arm hard toward RIGHT with a forward lean and OPEN hand, then both arms pull an imaginary taut rope back toward waist with a deep braced stance, release tension and return to ready stance. Do not draw a second microphone or any long cable outside the body; those are separate game effects.' },
  jump: { frames: 18, prompt: 'Jump pose sequence IN PLACE with NO vertical body translation: bend knees to prepare, straighten for takeoff, tuck knees into an airborne pose, extend legs into a falling-ready pose and HOLD it. The game supplies vertical movement; do not actually jump up the canvas. Keep the hips at consistent screen position except the preparatory crouch.' },
  landing: { frames: 12, prompt: 'A landing recovery: begin in bent-knee impact crouch, absorb impact through knees, hips and shoulders, then smoothly rise to the reference ready stance. Feet stay at the same floor line.' },
  crouch: { frames: 12, hold: true, prompt: 'From the ready stance, smoothly lower into a deep crouched guard. Head and hips visibly lower, knees bend deeply, feet remain planted. HOLD the low crouch for the final second; do not stand back up.' },
  block: { frames: 12, hold: true, prompt: 'Raise forearms into a strong defensive guard facing RIGHT, brace as if absorbing one hit, lean slightly backward and HOLD the guard for the final second. Do not return to idle.' },
  hurt: { frames: 16, prompt: 'One dramatic non-graphic chest-hit reaction: chest snaps backward, head and shoulders recoil, knees buckle, arms flinch, then regain balance into the reference ready stance. Stay facing RIGHT, feet grounded, no attacker and no VFX.' },
  getup: { frames: 20, prompt: 'Start kneeling low with one hand near the floor, push up through the legs, unfold the torso and return to the reference ready stance. Clearly articulated recovery with no camera motion.' },
});

const PAINT_ACTIONS={
  idle:'A seamless pulse of viscous pigment: ribbons slowly curl, swell and unwind while the puddle base stays planted. Preserve the same center and readable identity.',
  walk_forward:'Two clear forward-flow locomotion cycles in place: pigment gathers at the rear, rolls through the body and pours toward RIGHT, then recirculates. No human stride, knees or walking feet. The engine supplies horizontal translation.',
  walk_back:'Two retreating-flow cycles in place while the eye/front remains facing RIGHT: the puddle draws pigment backward toward LEFT, ribbon mass follows and recirculates. Never turn to face left. No human footwork.',
  jump:'Compress into a squat pool, elongate elastically for takeoff, gather into a compact airborne knot with trailing ribbons and HOLD that suspended shape. Do not translate vertically; the engine supplies the jump arc.',
  landing:'Begin as a flattened impact splash, pull the pigment inward, spiral upward and reform the exact reference silhouette. Do not add detached droplets or scenery.',
  crouch:'Melt downward into a low broad puddle and HOLD it, with the eye still oriented RIGHT. Lower the silhouette genuinely; do not shrink the entire character.',
  block:'Fold and overlap painted ribbons into a thick defensive shield of its own body, recoil slightly on an imagined impact from RIGHT and HOLD the guard. No arms or forearms required.',
  hurt:'One quick non-graphic impact deformation: front surface dimples, ribbons buckle backward, then elastic paint tension restores the reference shape. No detached pieces or attacker.',
  getup:'Begin pooled low on the ground, gather into a rising spiral, unroll the ribbons and restore the exact reference silhouette. No kneeling human or skeleton.',
};

export function motionProfile(action, description = '', {artStyle} = {}) {
  const profile = MOTION_PROFILES[action] ?? { frames: 20, prompt: `One complete ${action} action: clear anticipation, action, follow-through and return to ready stance. ${description}` };
  if(artStyle==='paint')return {...profile,action,duration:3,prompt:PAINT_ACTIONS[action]??`One complete ${action} action performed by flowing, stretching and folding the reference pigment, not human hinged limbs. Clear anticipation, contact, follow-through and return to the reference shape. ${description}`};
  return { ...profile, action, duration: 3 };
}
