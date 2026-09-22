#!/usr/bin/env node
import path from 'node:path';
import {parseArgs} from 'node:util';
import {preflightPalimpsestCombos, activatePalimpsestCombos, rollbackPalimpsestCombos} from '../cms/migrations/palimpsestCombos.js';

// This local-file migration never talks to a provider or republishes a fighter.
// Stop the CMS server and all generation workers before activate or rollback.
const {values, positionals} = parseArgs({allowPositionals:true, options:{
  root:{type:'string'}, 'expected-hash':{type:'string'}, bundle:{type:'string'}, 'writers-stopped':{type:'boolean', default:false}, help:{type:'boolean'},
}});
const usage = 'Usage: node scripts/migrate_palimpsest_combos.mjs preflight|activate|rollback --root cms-data\n  activate --expected-hash <preflight sourceHash> --writers-stopped\n  rollback --bundle <activation bundleDir> --writers-stopped\nOnly Palimpsest draft content is modified. Archive, metadata and published files are preserved.\nStop every CMS server and generation worker before passing --writers-stopped.';
try {
  if (values.help) { console.log(usage); }
  else {
    if (positionals.length !== 1 || !['preflight','activate','rollback'].includes(positionals[0])) throw new Error(usage);
    if ((process.env.CMS_STORAGE_PROVIDER ?? 'file') !== 'file') throw new Error('This migration supports local file storage only. Set CMS_STORAGE_PROVIDER=file for an explicitly chosen offline root.');
    const options = {rootDir:path.resolve(values.root ?? process.env.CMS_FILE_STORAGE_ROOT ?? 'cms-data'), writersStopped:values['writers-stopped'], expectedHash:values['expected-hash'], bundleDir:values.bundle};
    if (positionals[0] === 'rollback' && !values.bundle) throw new Error('Rollback requires --bundle');
    const result = await ({preflight:preflightPalimpsestCombos, activate:activatePalimpsestCombos, rollback:rollbackPalimpsestCombos}[positionals[0]])(options);
    console.log(JSON.stringify(result, null, 2));
    if (result.ok === false) process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
