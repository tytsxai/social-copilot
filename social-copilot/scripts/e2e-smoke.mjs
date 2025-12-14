import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const projectRoot = process.cwd();
const extensionPath = path.resolve(projectRoot, 'packages/browser-extension/dist');
if (!fs.existsSync(extensionPath)) {
  throw new Error(`Extension dist not found at: ${extensionPath}. Run pnpm build:extension first.`);
}

function findChromeExecutable() {
  const fromEnv = process.env.SC_E2E_CHROME_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    // Windows (best-effort)
    'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
    'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
  ];
  return candidates.find((p) => fs.existsSync(p));
}

const executablePath = findChromeExecutable();
if (!executablePath) {
  throw new Error('No Chrome/Chromium executable found. Set SC_E2E_CHROME_PATH to your browser path.');
}

const providedUserDataDir = process.env.SC_E2E_USER_DATA_DIR;
const tempUserDataDir = providedUserDataDir
  ? null
  : fs.mkdtempSync(path.join(os.tmpdir(), 'social-copilot-e2e-'));
const userDataDir = providedUserDataDir ?? tempUserDataDir;

const outDir = process.env.SC_E2E_OUT_DIR
  ? path.resolve(process.env.SC_E2E_OUT_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'social-copilot-e2e-artifacts-'));
fs.mkdirSync(outDir, { recursive: true });

const defaultTargets = [
  { name: 'telegram', url: 'https://web.telegram.org/k/' },
  { name: 'whatsapp', url: 'https://web.whatsapp.com/' },
  { name: 'slack', url: 'https://app.slack.com/client' },
];

const urlOverrides = {
  telegram: process.env.SC_E2E_TELEGRAM_URL,
  whatsapp: process.env.SC_E2E_WHATSAPP_URL,
  slack: process.env.SC_E2E_SLACK_URL,
};

const parseTargets = () => {
  const raw = process.env.SC_E2E_TARGETS;
  const want = raw
    ? raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : null;
  const selected = want ? defaultTargets.filter((t) => want.includes(t.name)) : defaultTargets;
  return selected.map((t) => ({
    ...t,
    url: (urlOverrides[t.name] && urlOverrides[t.name].trim()) || t.url,
  }));
};

const targets = parseTargets();
if (targets.length === 0) {
  throw new Error('No targets selected. Set SC_E2E_TARGETS=telegram,whatsapp,slack (or omit for all).');
}

console.log(`[e2e] Using browser: ${executablePath}`);
console.log(`[e2e] Using extension: ${extensionPath}`);
console.log(`[e2e] Using userDataDir: ${userDataDir}`);
console.log(`[e2e] Artifacts: ${outDir}`);
console.log(`[e2e] Targets: ${targets.map((t) => `${t.name}=${t.url}`).join(', ')}`);

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  executablePath,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  const page = await context.newPage();

  for (const target of targets) {
    console.log(`[e2e] Opening ${target.name}: ${target.url}`);
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    await page.waitForSelector('#social-copilot-root', { timeout: 60_000 });

    const visible = await page.evaluate(() => {
      const el = document.getElementById('social-copilot-root');
      if (!el) return { ok: false };
      const style = window.getComputedStyle(el);
      const errorEl = el.querySelector('.sc-error');
      return {
        ok: true,
        display: style.display,
        hasPanel: Boolean(el.querySelector('.sc-panel')),
        errorText: errorEl ? errorEl.textContent?.trim() || '' : '',
      };
    });

    if (!visible.ok || !visible.hasPanel) {
      throw new Error(`[e2e] ${target.name}: UI root found but panel missing`);
    }
    if (visible.errorText) {
      throw new Error(`[e2e] ${target.name}: adapter health failed: ${visible.errorText}`);
    }

    const screenshotPath = path.join(outDir, `${target.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[e2e] ${target.name}: OK (screenshot: ${screenshotPath})`);
  }
} finally {
  await context.close();
  if (tempUserDataDir) {
    fs.rmSync(tempUserDataDir, { recursive: true, force: true });
  }
}
