import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outDir = path.join(repoRoot, 'public-export');

const shouldExclude = (srcPath) => {
  const rel = path.relative(repoRoot, srcPath).replaceAll(path.sep, '/');

  if (rel === '.git' || rel.startsWith('.git/')) return true;
  if (rel.endsWith('.DS_Store')) return true;

  if (rel === 'public-export' || rel.startsWith('public-export/')) return true;
  if (rel === 'private' || rel.startsWith('private/')) return true;

  if (rel === 'social-copilot/node_modules' || rel.startsWith('social-copilot/node_modules/')) return true;
  if (rel === 'social-copilot/.venv' || rel.startsWith('social-copilot/.venv/')) return true;

  // build outputs
  if (rel === 'social-copilot/dist' || rel.startsWith('social-copilot/dist/')) return true;
  if (rel.includes('/dist/')) return true;
  if (rel === 'social-copilot/packages/browser-extension/release' || rel.startsWith('social-copilot/packages/browser-extension/release/')) return true;

  return false;
};

const copy = async (from, to) => {
  await cp(from, to, {
    recursive: true,
    filter: (src) => !shouldExclude(src),
  });
};

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await copy(path.join(repoRoot, 'LICENSE'), path.join(outDir, 'LICENSE'));
await copy(path.join(repoRoot, 'README.md'), path.join(outDir, 'README.md'));
await copy(path.join(repoRoot, '.gitignore'), path.join(outDir, '.gitignore'));
await copy(path.join(repoRoot, '.github'), path.join(outDir, '.github'));
await copy(path.join(repoRoot, 'social-copilot'), path.join(outDir, 'social-copilot'));

console.log(`Public export ready: ${outDir}`);
