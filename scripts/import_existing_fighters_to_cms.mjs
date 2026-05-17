import { importExistingFightersToCms } from '../cms/import/importExistingFighters.js';

const result = await importExistingFightersToCms();

console.log(`Imported ${result.imported.length} fighter pack(s) into ${result.storageRoot}`);
for (const fighter of result.imported) {
  const actors = fighter.actorPacks.length > 0
    ? `, actors: ${fighter.actorPacks.map((actor) => actor.id).join(', ')}`
    : '';
  console.log(`- ${fighter.id}: ${fighter.copiedFileCount} file(s)${actors}`);
}

if (result.skipped.length > 0) {
  console.log(`Skipped ${result.skipped.length} fighter pack(s):`);
  for (const skipped of result.skipped) {
    console.log(`- ${skipped.id}: ${skipped.reason}`);
  }
}
