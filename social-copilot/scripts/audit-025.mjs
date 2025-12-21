#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd());

const PACKAGES = [
  { name: 'core', root: path.join(repoRoot, 'packages/core/src') },
  { name: 'browser-extension', root: path.join(repoRoot, 'packages/browser-extension/src') },
  { name: 'mobile', root: path.join(repoRoot, 'packages/mobile/src') },
];

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.expo', '.turbo', '.vite', '.next']);

function walk(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const IMPORT_RE =
  /^\s*(?:import\s+(?:type\s+)?[\s\S]*?\s+from\s+|export\s+[\s\S]*?\s+from\s+|import\(\s*)['"]([^'"]+)['"]\s*\)?\s*;?/gm;

function parseImports(sourceText) {
  const imports = [];
  for (const match of sourceText.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec) imports.push(spec);
  }
  return imports;
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);

  const candidates = [
    base,
    ...Array.from(SOURCE_EXTS, (ext) => base + ext),
    ...Array.from(SOURCE_EXTS, (ext) => path.join(base, 'index' + ext)),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function normalize(p) {
  return p.split(path.sep).join('/');
}

function tarjanScc(graph) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const idx = new Map();
  const low = new Map();
  const sccs = [];

  function strongconnect(v) {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    const edges = graph.get(v) ?? [];
    for (const w of edges) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), idx.get(w)));
      }
    }

    if (low.get(v) === idx.get(v)) {
      const component = [];
      while (true) {
        const w = stack.pop();
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      sccs.push(component);
    }
  }

  for (const v of graph.keys()) {
    if (!idx.has(v)) strongconnect(v);
  }
  return sccs;
}

function dirnameBucket(pkgRoot, filePath) {
  const rel = path.relative(pkgRoot, filePath);
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0] : '(root)';
}

function analyzePackage({ name, root }) {
  const files = fs.existsSync(root) ? walk(root) : [];
  const graph = new Map();
  const rev = new Map();
  const externalImports = new Map();

  for (const file of files) {
    graph.set(file, []);
    rev.set(file, []);
    externalImports.set(file, []);
  }

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const specs = parseImports(text);
    for (const spec of specs) {
      const resolved = resolveSpec(file, spec);
      if (resolved && graph.has(resolved)) {
        graph.get(file).push(resolved);
      } else if (!spec.startsWith('.')) {
        externalImports.get(file).push(spec);
      }
    }
  }

  for (const [from, tos] of graph.entries()) {
    for (const to of tos) rev.get(to).push(from);
  }

  const sccs = tarjanScc(graph);
  const cycles = sccs
    .filter((c) => c.length > 1)
    .map((component) => component.map((p) => normalize(path.relative(repoRoot, p))).sort());

  const fileStats = files
    .map((f) => {
      const fanOut = graph.get(f)?.length ?? 0;
      const fanIn = rev.get(f)?.length ?? 0;
      const rel = normalize(path.relative(repoRoot, f));
      const bucket = dirnameBucket(root, f);
      return { file: rel, bucket, fanIn, fanOut };
    })
    .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut));

  const bucketStats = new Map();
  for (const s of fileStats) {
    const prev = bucketStats.get(s.bucket) ?? { bucket: s.bucket, files: 0, fanIn: 0, fanOut: 0 };
    prev.files += 1;
    prev.fanIn += s.fanIn;
    prev.fanOut += s.fanOut;
    bucketStats.set(s.bucket, prev);
  }

  const topFilesByCoupling = fileStats.slice(0, 15);
  const topBucketsByCoupling = Array.from(bucketStats.values())
    .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut))
    .slice(0, 10);

  const externalCounts = new Map();
  for (const [file, specs] of externalImports.entries()) {
    for (const spec of specs) externalCounts.set(spec, (externalCounts.get(spec) ?? 0) + 1);
  }

  const topExternal = Array.from(externalCounts.entries())
    .map(([spec, count]) => ({ spec, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    name,
    root: normalize(path.relative(repoRoot, root)),
    files: files.length,
    cycles,
    topFilesByCoupling,
    topBucketsByCoupling,
    topExternal,
  };
}

function readTextFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function computeDupes(filePaths) {
  // Lightweight duplicate detector: normalize by stripping comments and whitespace,
  // then hash fixed-size windows of lines to find repeated blocks.
  const MIN_LINES = 20;
  const WINDOW = 30;
  const STOPWORDS = new Set(['{', '}', '(', ')', '[', ']', ';']);

  function normalizeLine(line) {
    const noLineComment = line.replace(/\/\/.*$/, '');
    const trimmed = noLineComment.trim();
    if (!trimmed) return '';
    if (STOPWORDS.has(trimmed)) return '';
    return trimmed.replace(/\s+/g, ' ');
  }

  const blocks = new Map(); // key -> [{file, startLine}]
  for (const file of filePaths) {
    const text = readTextFileSafe(file);
    if (!text) continue;
    const rawLines = text.split(/\r?\n/);
    const lines = rawLines.map(normalizeLine);
    for (let i = 0; i + WINDOW <= lines.length; i += 5) {
      const chunk = lines.slice(i, i + WINDOW).filter(Boolean);
      if (chunk.length < MIN_LINES) continue;
      const key = chunk.join('\n');
      const list = blocks.get(key) ?? [];
      list.push({ file: normalize(path.relative(repoRoot, file)), startLine: i + 1 });
      blocks.set(key, list);
    }
  }

  const dupes = [];
  for (const [key, occurrences] of blocks.entries()) {
    if (occurrences.length < 2) continue;
    dupes.push({ lines: key.split('\n').length, occurrences });
  }

  dupes.sort((a, b) => b.lines * b.occurrences.length - a.lines * a.occurrences.length);

  // Deduplicate near-identical findings by keeping only top N.
  return dupes.slice(0, 20);
}

function main() {
  const analyzed = PACKAGES.map(analyzePackage);

  const srcFiles = PACKAGES.flatMap((p) => (fs.existsSync(p.root) ? walk(p.root) : []));
  const dupes = computeDupes(srcFiles);

  const result = {
    generatedAt: new Date().toISOString(),
    repoRoot: normalize(repoRoot),
    packages: analyzed,
    duplicates: dupes,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
