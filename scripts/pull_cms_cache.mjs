import { createCmsStorage } from '../cms/storage/createCmsStorage.js';

const args = parseArgs(process.argv.slice(2));
const storage = createCmsStorage({
  provider: 'cached',
});

if (typeof storage.syncPrefix !== 'function') {
  throw new Error('cms:pull requires CMS_STORAGE_PROVIDER=cached-compatible storage.');
}

const prefixes = prefixesFor(args);
const results = [];

for (const prefix of prefixes) {
  console.log(`Pulling CMS cache prefix: ${prefix || '<root>'}`);
  const result = await storage.syncPrefix(prefix, {
    force: args.force,
    onProgress: ({ copied, skipped, total, key }) => {
      if (copied <= 10 || copied % 100 === 0 || copied + skipped === total) {
        console.log(`  ${copied + skipped}/${total} cached (${copied} copied, ${skipped} skipped): ${key}`);
      }
    },
  });
  results.push(result);
}

const copied = results.reduce((sum, result) => sum + result.copied, 0);
const skipped = results.reduce((sum, result) => sum + result.skipped, 0);
const total = results.reduce((sum, result) => sum + result.total, 0);

console.log(`CMS cache pull complete: ${copied} copied, ${skipped} skipped, ${total} remote object(s) inspected.`);

function prefixesFor(parsedArgs) {
  if (parsedArgs.all) return [''];
  if (parsedArgs.prefixes.length > 0) return parsedArgs.prefixes;
  if (parsedArgs.characters.length > 0) {
    return [
      'characters/index.json',
      ...parsedArgs.characters.map((characterId) => `characters/${characterId}`),
    ];
  }
  return ['characters/index.json'];
}

function parseArgs(argv) {
  const parsed = {
    all: false,
    force: false,
    characters: [],
    prefixes: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') {
      parsed.all = true;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--character') {
      parsed.characters.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--character=')) {
      parsed.characters.push(arg.slice('--character='.length));
    } else if (arg === '--prefix') {
      parsed.prefixes.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--prefix=')) {
      parsed.prefixes.push(arg.slice('--prefix='.length));
    } else {
      throw new Error(`Unknown cms:pull argument: ${arg}`);
    }
  }

  if (parsed.all && (parsed.characters.length > 0 || parsed.prefixes.length > 0)) {
    throw new Error('Use either --all, --character, or --prefix. Do not combine them.');
  }

  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}
