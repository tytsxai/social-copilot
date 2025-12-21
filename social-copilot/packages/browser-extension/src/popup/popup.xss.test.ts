// @vitest-environment jsdom
import { describe, test, expect, vi } from 'vitest';

function setupDom() {
  document.body.innerHTML = `
    <div id="status"></div>
    <select id="provider"></select>
    <input id="baseUrl" />
    <div id="baseUrlHint"></div>
    <input id="allowInsecureHttp" type="checkbox" />
    <input id="allowPrivateHosts" type="checkbox" />
    <input id="model" />
    <div id="modelHint"></div>
    <datalist id="modelSuggestions"></datalist>
    <input id="apiKey" />
    <div id="apiKeyHint"></div>
    <input id="persistApiKey" type="checkbox" />
    <input id="enableMemory" type="checkbox" />
    <select id="language"></select>
    <input id="autoInGroups" type="checkbox" />
    <input id="autoTrigger" type="checkbox" />
    <input id="privacyAcknowledged" type="checkbox" />
    <input id="redactPii" type="checkbox" />
    <input id="anonymizeSenders" type="checkbox" />
    <input id="contextMessageLimit" />
    <input id="maxCharsPerMessage" />
    <input id="maxTotalChars" />
    <input id="enableFallback" type="checkbox" />
    <div id="fallbackFields"></div>
    <select id="fallbackProvider"></select>
    <input id="fallbackBaseUrl" />
    <div id="fallbackBaseUrlHint"></div>
    <input id="fallbackAllowInsecureHttp" type="checkbox" />
    <input id="fallbackAllowPrivateHosts" type="checkbox" />
    <input id="fallbackModel" />
    <div id="fallbackModelHint"></div>
    <datalist id="fallbackModelSuggestions"></datalist>
    <input id="fallbackApiKey" />
    <div id="fallbackApiKeyHint"></div>
    <select id="suggestionCount"></select>
    <button id="saveBtn"></button>
    <div id="contactList"></div>
    <button id="clearDataBtn"></button>
    <button id="exportUserDataBtn"></button>
    <button id="importUserDataBtn"></button>
    <input id="importUserDataFile" type="file" />
    <input id="debugEnabled" type="checkbox" />
    <button id="copyDiagnosticsBtn"></button>
    <button id="downloadDiagnosticsBtn"></button>
    <button id="clearDiagnosticsBtn"></button>
    <div id="aboutVersion"></div>

    <div class="tab" data-tab="contacts">Contacts</div>
    <div id="contacts" class="tab-content"></div>
  `;
}

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('popup contacts rendering XSS', () => {
  test('escapes contact dynamic fields in innerHTML', async () => {
    setupDom();

    const sendMessage = vi.fn(async (msg: any) => {
      if (msg?.type === 'GET_CONTACTS') {
        return {
          contacts: [
            {
              displayName: '<svg onload=alert(1)>A</svg>',
              app: '<img src=x onerror=alert(1) />',
              messageCount: 123,
              key: { platform: 'test', id: '1' },
              memorySummary: '<b>pwn</b>',
              memoryUpdatedAt: Date.UTC(2025, 0, 2),
            },
          ],
        };
      }
      if (msg?.type === 'GET_STYLE_PREFERENCE') {
        return { preference: null };
      }
      return {};
    });

    (globalThis as any).chrome = {
      runtime: {
        getManifest: () => ({ version: '0.0.0-test' }),
        sendMessage,
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
    };

    vi.resetModules();
    await import('./popup');

    document.querySelector<HTMLElement>('.tab[data-tab="contacts"]')!.click();
    await flush();
    await flush();

    const contactListEl = document.getElementById('contactList')!;

    expect(contactListEl.innerHTML).toContain('&lt;img');
    expect(contactListEl.innerHTML).toContain('&lt;svg');
    expect(contactListEl.innerHTML).toContain('&lt;b&gt;pwn&lt;/b&gt;');

    expect(contactListEl.querySelector('img')).toBeNull();
    expect(contactListEl.querySelector('svg')).toBeNull();
  });
});
