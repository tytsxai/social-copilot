import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(`release validation failed: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`cannot read JSON: ${filePath} (${err instanceof Error ? err.message : String(err)})`);
  }
}

function walkFiles(dir) {
  const result = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(full));
    else result.push(full);
  }
  return result;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const extDir = path.join(rootDir, 'packages', 'browser-extension');
const packagesDir = path.join(rootDir, 'packages');
const distDir = path.join(extDir, 'dist');

const rootPkg = readJson(path.join(rootDir, 'package.json'));
const extPkg = readJson(path.join(extDir, 'package.json'));
const manifest = readJson(path.join(extDir, 'manifest.json'));

// Keep monorepo package versions aligned for releases
if (existsSync(packagesDir) && statSync(packagesDir).isDirectory()) {
  const packageDirs = readdirSync(packagesDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dirent of packageDirs) {
    const pkgPath = path.join(packagesDir, dirent.name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = readJson(pkgPath);
    if (pkg?.version && pkg.version !== rootPkg.version) {
      fail(`version mismatch (packages/${dirent.name}=${pkg.version}, root=${rootPkg.version})`);
    }
  }
}

if (manifest.manifest_version !== 3) {
  fail('manifest_version must be 3');
}

if (manifest.version !== extPkg.version || manifest.version !== rootPkg.version) {
  fail(`version mismatch (manifest=${manifest.version}, browser-extension=${extPkg.version}, root=${rootPkg.version})`);
}

const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
if (permissions.some((p) => p === 'tabs' || p === 'activeTab')) {
  fail(`unnecessary permissions present: ${permissions.join(', ')}`);
}
if (!permissions.includes('storage')) {
  fail('manifest.permissions must include "storage"');
}

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  fail('dist not found, run `pnpm build:extension:release` first');
}

const distManifestPath = path.join(distDir, 'manifest.json');
if (!existsSync(distManifestPath)) {
  fail('dist/manifest.json missing (static assets copy failed)');
}
const distManifest = readJson(distManifestPath);
if (distManifest.version !== manifest.version) {
  fail(`dist manifest version mismatch (dist=${distManifest.version}, manifest=${manifest.version})`);
}

const requiredFiles = [
  'manifest.json',
  'background.js',
  path.join('content-scripts', 'telegram.js'),
  path.join('content-scripts', 'whatsapp.js'),
  path.join('content-scripts', 'slack.js'),
  path.join('popup', 'index.html'),
  path.join('popup', 'popup.js'),
  path.join('styles', 'copilot.css'),
  path.join('icons', 'icon16.png'),
  path.join('icons', 'icon48.png'),
  path.join('icons', 'icon128.png'),
];

for (const rel of requiredFiles) {
  const full = path.join(distDir, rel);
  if (!existsSync(full)) {
    fail(`missing build output: ${rel}`);
  }
}

// Release build should not emit sourcemaps
const files = walkFiles(distDir);
const mapFiles = files.filter((f) => f.endsWith('.map'));
if (mapFiles.length > 0) {
  fail(`sourcemaps found in dist (expected none in release): ${mapFiles.slice(0, 3).map((f) => path.relative(distDir, f)).join(', ')}`);
}

// eslint-disable-next-line no-console
console.log(`release validation ok (version=${manifest.version})`);
