import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(`package failed: ${message}`);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const extDir = path.join(rootDir, 'packages', 'browser-extension');
const distDir = path.join(extDir, 'dist');

if (!existsSync(distDir)) {
  fail('dist not found, run `pnpm release:extension` or `pnpm build:extension:release` first');
}

const distManifestPath = path.join(distDir, 'manifest.json');
if (!existsSync(distManifestPath)) {
  fail('dist/manifest.json missing');
}

let version = 'unknown';
try {
  const manifest = JSON.parse(readFileSync(distManifestPath, 'utf8'));
  version = String(manifest.version || 'unknown');
} catch (err) {
  fail(`cannot read dist/manifest.json (${err instanceof Error ? err.message : String(err)})`);
}

const releaseDir = path.join(extDir, 'release');
mkdirSync(releaseDir, { recursive: true });
const zipPath = path.join(releaseDir, `social-copilot-${version}.zip`);
rmSync(zipPath, { force: true });

try {
  execFileSync('zip', ['-v'], { stdio: 'ignore' });
} catch {
  fail('`zip` command not found; install zip or package manually from dist/');
}

try {
  execFileSync('zip', ['-r', '-q', zipPath, '.', '-x', '*.DS_Store'], { cwd: distDir, stdio: 'inherit' });
} catch (err) {
  fail(`zip failed (${err instanceof Error ? err.message : String(err)})`);
}

// eslint-disable-next-line no-console
console.log(`created: ${zipPath}`);

