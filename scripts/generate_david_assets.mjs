import { mkdir, readFile, writeFile, appendFile, access } from 'node:fs/promises';
import { FalImageGeneratorAdapter } from '../cms/pipeline/adapters/falImageGeneratorAdapter.js';
import { BflFluxKleinGeneratorAdapter } from '../cms/pipeline/adapters/bflFluxKleinGeneratorAdapter.js';
import { createCmsStorage } from '../cms/storage/createCmsStorage.js';

// Private inputs and durable attempt receipts stay outside the public fighter pack.
const root = 'generated/david';
await mkdir(root, { recursive: true });
const adapter = process.env.DAVID_IMAGE_PROVIDER === 'bfl' ? new BflFluxKleinGeneratorAdapter() : new FalImageGeneratorAdapter();
const storage = createCmsStorage();
const reference = async (file) => ({ base64: (await readFile(file)).toString('base64'), contentType: file.endsWith('.jpg') ? 'image/jpeg' : 'image/png' });
const identity = 'David, the SAME slim adult man from the references, pale skin, medium brown curtain hair swept across forehead, subtle stubble, long narrow face. Colorful teal yellow coral abstract-print short-sleeve open-collar shirt, black trousers, black shoes. Full body 3/4 fighting-game SIDE VIEW facing RIGHT. Faithful face and hair, stylized readable 16-bit pixel clusters and dark outlines, NOT a toy, NOT 3D, NOT photoreal. Solid exact #ff00ff background. One character, no text, no shadow, no scenery. Whole body inside central 65% of square canvas with huge safe margins. Grounded feet on same baseline. No floating effects.';
const poses = {
  base: 'Relaxed ready stance, knees slightly bent. Holding a silver wired handheld microphone at chest level, other hand relaxed. Cable tucked close to body.',
  punch: 'Fast straight forward jab with the microphone in right hand, left hand guards. Feet remain planted. Right arm extends toward right.',
  kick: 'Dynamic forward waist-height side kick to the RIGHT, one foot planted. Keep microphone hand near chest.',
  juggle: 'Underhand toss toward the RIGHT with free hand, palm open extending forward at waist level. Mic in other hand. Do not draw the ball; engine adds it.',
  sound: 'Leans forward projecting voice into microphone held at mouth, free hand extended in performance gesture. No sound effects drawn.',
  ink: 'Sweeps a small black drawing brush forward toward RIGHT, low stance. Mic held near waist in other hand. Do not draw ink effects.',
  cable: 'Wide grounded stance, casts microphone forward with right arm at shoulder level, hand OPEN after releasing mic. Do not draw the flying mic or long cable; game draws them separately.',
  cable_cast: 'EDIT REFERENCE: REMOVE THE SILVER MICROPHONE FROM BOTH HANDS COMPLETELY. Neither hand holds a microphone. No microphone anywhere in image. Left hand at waist holding ONLY the end of a thin black wire. Right arm FULLY EXTENDED straight to the RIGHT with OPEN palm after having thrown the microphone away. Lean into the throw, feet stay planted. The thrown microphone is OFFSCREEN, not drawn. All clothing and face stay identical. Plain flat bright magenta background, absolutely no floor shadow.',
  hurt: 'Recoils backward from a chest strike, face strained, arms pulled inward, knees bent. Preserve full body and outfit.',
  crouch: 'Deep defensive crouch, both knees bent, mic tucked close, hands guarding face. Body naturally shorter than standing, do not enlarge.',
};
const targets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(poses);
for (const id of targets) {
  if (!poses[id]) throw new Error(`Unknown pose ${id}`);
  const output = `${root}/${id}.png`;
  try { await access(output); console.log(`Reuse ${id}`); continue; } catch {}
  const refs = id === 'base' ? await Promise.all([
    reference('/var/folders/7m/jy6l7kt52sd0yjg6tv5c8qyc0000gn/T/codex-clipboard-310d3d68-96c3-4916-b416-63ed7322d0fb.jpg'),
    reference('/var/folders/7m/jy6l7kt52sd0yjg6tv5c8qyc0000gn/T/TemporaryItems/NSIRD_screencaptureui_wigV6J/Screenshot 2026-09-16 at 10.12.22 PM.png'),
  ]) : [await reference(`${root}/base.png`)];
  const prompt = `${identity} ${poses[id]} ${id === 'base' ? '' : 'Match reference EXACTLY: identical face, hair, outfit, pixel density, body scale and feet baseline. Change only the pose.'}`;
  const result = await adapter.generateImage({ task: 'character-concept', prompt, referenceImages: refs, context: { characterId: 'david' },
    onGenerationAttempt: async (event) => {
      const receipt = { ...event, pose: id };
      await appendFile(`${root}/attempts.jsonl`, JSON.stringify(receipt) + '\n');
      const observation = event.completedAt.replaceAll(':', '-').replaceAll('.', '-');
      const key = `benchmarks/generation-attempts/${event.startedAt.slice(0, 10)}/${event.attemptId}-${observation}.json`;
      await storage.putJson(key, { ...receipt, benchmarkKey: key }, { artifactType: 'external-generation-attempt' });
    } });
  await writeFile(output, result.bytes);
  await writeFile(`${root}/${id}.json`, JSON.stringify({ prompt, provider: result.provider, model: result.model, taskId: result.taskId, elapsedMs: result.elapsedMs }, null, 2));
  console.log(`${id}: ${result.elapsedMs}ms`);
}
