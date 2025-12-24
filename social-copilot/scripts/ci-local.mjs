import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

function run(cmd, opts = {}) {
  // eslint-disable-next-line no-console
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const nodeModulesDir = path.join(rootDir, 'node_modules');

const shouldInstall = process.env.FORCE_INSTALL === '1' || !existsSync(nodeModulesDir);
if (shouldInstall) {
  run('pnpm install --frozen-lockfile', { cwd: rootDir });
}

run('pnpm check:boundaries', { cwd: rootDir });
run('pnpm audit:025 > audit-025.json', { cwd: rootDir });
run('pnpm lint', { cwd: rootDir });
run('pnpm typecheck', { cwd: rootDir });
run('pnpm test', { cwd: rootDir });
run('pnpm release:extension', { cwd: rootDir });

// eslint-disable-next-line no-console
console.log('\nlocal CI ok');
