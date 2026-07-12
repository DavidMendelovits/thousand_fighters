import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const adminRoot = path.join(repoRoot, 'admin');
const distRoot = path.join(repoRoot, 'dist');

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });
await cp(adminRoot, distRoot, { recursive: true });

console.log(`Built CMS admin static assets to ${distRoot}.`);
