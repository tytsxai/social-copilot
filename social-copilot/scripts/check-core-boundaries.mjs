#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd());
const coreRoot = path.join(repoRoot, 'packages/core/src');

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.expo', '.turbo', '.vite', '.next']);

const FORBIDDEN = [
  { name: 'chrome', re: /\bchrome\b/ },
  { name: 'react-native', re: /\breact-native\b/ },
  { name: 'expo', re: /\bexpo\b/ },
];

function walk(dir) {
  const out = [];
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function stripStrings(line) {
  return line.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''");
}

function analyzeFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  let inBlockComment = false;
  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];

    // Remove block comments (possibly spanning lines) + line comments.
    let out = '';
    let cursor = 0;
    while (cursor < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', cursor);
        if (end === -1) {
          cursor = line.length;
          break;
        }
        inBlockComment = false;
        cursor = end + 2;
        continue;
      }

      const startBlock = line.indexOf('/*', cursor);
      const startLine = line.indexOf('//', cursor);

      if (startLine !== -1 && (startBlock === -1 || startLine < startBlock)) {
        out += line.slice(cursor, startLine);
        cursor = line.length;
        break;
      }

      if (startBlock !== -1) {
        out += line.slice(cursor, startBlock);
        cursor = startBlock + 2;
        inBlockComment = true;
        continue;
      }

      out += line.slice(cursor);
      cursor = line.length;
    }

    const normalized = stripStrings(out);
    for (const rule of FORBIDDEN) {
      if (rule.re.test(normalized)) {
        hits.push({ file: filePath, line: i + 1, rule: rule.name });
      }
    }
  }

  return hits;
}

function main() {
  if (!fs.existsSync(coreRoot)) {
    process.stdout.write(`[check-core-boundaries] core root not found: ${coreRoot}\n`);
    process.exit(0);
  }

  const files = walk(coreRoot);
  const hits = files.flatMap(analyzeFile);

  if (hits.length === 0) {
    process.stdout.write('[check-core-boundaries] ok\n');
    process.exit(0);
  }

  process.stderr.write('[check-core-boundaries] forbidden platform references found in core:\n');
  for (const hit of hits) {
    const rel = path.relative(repoRoot, hit.file).split(path.sep).join('/');
    process.stderr.write(`- ${rel}:${hit.line} (${hit.rule})\n`);
  }
  process.exit(1);
}

main();

