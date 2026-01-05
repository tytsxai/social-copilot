// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock chrome API
const sendMessage = vi.fn();
(globalThis as any).chrome = {
  runtime: {
    getManifest: () => ({ version: '1.0.0' }),
    sendMessage,
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    }
  }
};

// Mock window.confirm
(globalThis as any).confirm = vi.fn(() => true);

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
    <input id="autoAgent" type="checkbox" />
    <textarea id="customSystemPrompt"></textarea>
    <textarea id="customUserPrompt"></textarea>
    <input id="privacyAcknowledged" type="checkbox" />
    <input id="redactPii" type="checkbox" />
    <input id="anonymizeSenders" type="checkbox" />
    <input id="contextMessageLimit" />
    <input id="maxCharsPerMessage" />
    <input id="maxTotalChars" />
    <input id="temperature" />
    <span id="temperatureValue"></span>
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
    <button id="testConnectionBtn"></button>
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

    <div class="tabs">
      <button class="tab" data-tab="settings">Settings</button>
      <button class="tab" data-tab="contacts">Contacts</button>
    </div>
    <div id="settings" class="tab-content active"></div>
    <div id="contacts" class="tab-content"></div>
  `;
}

describe('Contact List Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDom();
    vi.resetModules();
  });

  test('renders contact list with correct structure and tooltip', async () => {
    const mockContacts = [
      {
        displayName: 'Long Name That Should Be Truncated And Have A Tooltip',
        app: 'Telegram',
        messageCount: 42,
        key: { platform: 'web', app: 'telegram', conversationId: '123' },
        memorySummary: 'Has a long memory that should be aligned.',
        memoryUpdatedAt: Date.UTC(2025, 11, 23),
        preference: { styleHistory: [{ style: 'casual', count: 5 }] }
      }
    ];

    sendMessage.mockImplementation(async (msg) => {
      if (msg.type === 'GET_CONTACTS_WITH_PREFS') {
        return { contacts: mockContacts };
      }
      if (msg.type === 'GET_STATUS') {
        return { hasApiKey: true };
      }
      return {};
    });

    await import('./popup');

    const contactsTab = document.querySelector('[data-tab="contacts"]') as HTMLElement;
    contactsTab.click();

    await new Promise(resolve => setTimeout(resolve, 10));

    const contactList = document.getElementById('contactList')!;
    const contactItem = contactList.querySelector('.contact-item')!;
    
    expect(contactItem).toBeTruthy();
    
    // Check for tooltip (title attribute)
    const nameEl = contactItem.querySelector('.contact-name')!;
    expect(nameEl.getAttribute('title')).toBe(mockContacts[0].displayName);

    // Check for actions placement (outside header)
    const header = contactItem.querySelector('.contact-header')!;
    const actions = contactItem.querySelector('.contact-actions')!;
    expect(header.contains(actions)).toBe(false);
    expect(contactItem.contains(actions)).toBe(true);
    
    expect(actions.querySelectorAll('button').length).toBe(4);

    // Check memory box
    const memoryBox = contactItem.querySelector('.memory-box')!;
    expect(memoryBox).toBeTruthy();
    expect(memoryBox.textContent).toContain('2025-12-23');
  });

  test('triggers correct actions when buttons are clicked', async () => {
    const mockContacts = [
      {
        displayName: 'Test Contact',
        app: 'Slack',
        messageCount: 10,
        key: { platform: 'web', app: 'slack', conversationId: '456' },
        memorySummary: 'Some memory',
        memoryUpdatedAt: Date.now(),
        preference: null
      }
    ];

    sendMessage.mockImplementation(async (msg) => {
      if (msg.type === 'GET_CONTACTS_WITH_PREFS') {
        return { contacts: mockContacts };
      }
      return { success: true };
    });

    await import('./popup');

    const contactsTab = document.querySelector('[data-tab="contacts"]') as HTMLElement;
    contactsTab.click();
    await new Promise(resolve => setTimeout(resolve, 10));

    const contactList = document.getElementById('contactList')!;
    
    // Test Reset Preference
    const resetBtn = contactList.querySelector('.reset-pref-btn') as HTMLButtonElement;
    resetBtn.click();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RESET_STYLE_PREFERENCE',
        contactKey: mockContacts[0].key,
      }),
      expect.any(Function)
    );

    // Test Reset Thought Preference
    const resetThoughtBtn = contactList.querySelector('.reset-thought-btn') as HTMLButtonElement;
    resetThoughtBtn.click();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RESET_THOUGHT_PREFERENCE',
        contactKey: mockContacts[0].key,
      }),
      expect.any(Function)
    );

    // Test Clear Memory
    const clearMemoryBtn = contactList.querySelector('.clear-memory-btn') as HTMLButtonElement;
    clearMemoryBtn.click();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CLEAR_CONTACT_MEMORY',
        contactKey: mockContacts[0].key,
      }),
      expect.any(Function)
    );

    // Test Clear Data
    const clearDataBtn = contactList.querySelector('.clear-contact-btn') as HTMLButtonElement;
    clearDataBtn.click();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CLEAR_CONTACT_DATA',
        contactKey: mockContacts[0].key,
      }),
      expect.any(Function)
    );
  });
});
