import type { ContactKey } from '@social-copilot/core';
import { parseAndValidateUserDataBackup, validateImportFileSize } from './importUserData';
import { getStyleLabel } from './preferences';
import {
  runtimeGetManifestVersion,
  runtimeSendMessage,
  storageLocalClear,
  storageLocalGet,
  storageLocalRemove,
  storageLocalSet,
} from '../utils/webext';

// DOM 元素
const statusEl = document.getElementById('status')!;
const providerSelect = document.getElementById('provider') as HTMLSelectElement;
const baseUrlInput = document.getElementById('baseUrl') as HTMLInputElement;
const baseUrlHint = document.getElementById('baseUrlHint')!;
const allowInsecureHttpCheckbox = document.getElementById('allowInsecureHttp') as HTMLInputElement;
const allowPrivateHostsCheckbox = document.getElementById('allowPrivateHosts') as HTMLInputElement;
const modelInput = document.getElementById('model') as HTMLInputElement;
const modelHint = document.getElementById('modelHint')!;
const modelSuggestions = document.getElementById('modelSuggestions') as HTMLDataListElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const apiKeyHint = document.getElementById('apiKeyHint')!;
const persistApiKeyCheckbox = document.getElementById('persistApiKey') as HTMLInputElement;
const enableMemoryCheckbox = document.getElementById('enableMemory') as HTMLInputElement;
const languageSelect = document.getElementById('language') as HTMLSelectElement;
const autoInGroupsCheckbox = document.getElementById('autoInGroups') as HTMLInputElement;
const autoTriggerCheckbox = document.getElementById('autoTrigger') as HTMLInputElement;
const autoAgentCheckbox = document.getElementById('autoAgent') as HTMLInputElement;
const customSystemPromptInput = document.getElementById('customSystemPrompt') as HTMLTextAreaElement;
const customUserPromptInput = document.getElementById('customUserPrompt') as HTMLTextAreaElement;
const privacyAcknowledgedCheckbox = document.getElementById('privacyAcknowledged') as HTMLInputElement;
const redactPiiCheckbox = document.getElementById('redactPii') as HTMLInputElement;
const anonymizeSendersCheckbox = document.getElementById('anonymizeSenders') as HTMLInputElement;
const contextMessageLimitInput = document.getElementById('contextMessageLimit') as HTMLInputElement;
const maxCharsPerMessageInput = document.getElementById('maxCharsPerMessage') as HTMLInputElement;
const maxTotalCharsInput = document.getElementById('maxTotalChars') as HTMLInputElement;
const temperatureInput = document.getElementById('temperature') as HTMLInputElement | null;
const temperatureValueEl = document.getElementById('temperatureValue') as HTMLElement | null;
const enableFallbackCheckbox = document.getElementById('enableFallback') as HTMLInputElement;
const fallbackFields = document.getElementById('fallbackFields')!;
const fallbackProviderSelect = document.getElementById('fallbackProvider') as HTMLSelectElement;
const fallbackBaseUrlInput = document.getElementById('fallbackBaseUrl') as HTMLInputElement;
const fallbackBaseUrlHint = document.getElementById('fallbackBaseUrlHint')!;
const fallbackAllowInsecureHttpCheckbox = document.getElementById('fallbackAllowInsecureHttp') as HTMLInputElement;
const fallbackAllowPrivateHostsCheckbox = document.getElementById('fallbackAllowPrivateHosts') as HTMLInputElement;
const fallbackModelInput = document.getElementById('fallbackModel') as HTMLInputElement;
const fallbackModelHint = document.getElementById('fallbackModelHint')!;
const fallbackModelSuggestions = document.getElementById('fallbackModelSuggestions') as HTMLDataListElement;
const fallbackApiKeyInput = document.getElementById('fallbackApiKey') as HTMLInputElement;
const fallbackApiKeyHint = document.getElementById('fallbackApiKeyHint')!;
const suggestionCountSelect = document.getElementById('suggestionCount') as HTMLSelectElement;
const saveBtn = document.getElementById('saveBtn')!;
const testConnectionBtn = document.getElementById('testConnectionBtn') as HTMLButtonElement | null;
const contactListEl = document.getElementById('contactList');
const clearDataBtn = document.getElementById('clearDataBtn')!;
const exportUserDataBtn = document.getElementById('exportUserDataBtn')!;
const importUserDataBtn = document.getElementById('importUserDataBtn')!;
const importUserDataFile = document.getElementById('importUserDataFile') as HTMLInputElement;
const debugEnabledCheckbox = document.getElementById('debugEnabled') as HTMLInputElement;
const copyDiagnosticsBtn = document.getElementById('copyDiagnosticsBtn')!;
const downloadDiagnosticsBtn = document.getElementById('downloadDiagnosticsBtn')!;
const clearDiagnosticsBtn = document.getElementById('clearDiagnosticsBtn')!;
const aboutVersionEl = document.getElementById('aboutVersion');
const remoteSelectorsUrlInput = document.getElementById('remoteSelectorsUrl') as HTMLInputElement | null;
const advancedModeCheckbox = document.getElementById('advancedMode') as HTMLInputElement | null;
const advancedFields = document.getElementById('advancedFields') as HTMLElement | null;
const IS_RELEASE = __SC_RELEASE__;

type StatusResponse = {
  hasApiKey?: boolean;
  hasFallback?: boolean;
  activeProvider?: string;
  activeModel?: string;
  debugEnabled?: boolean;
  privacyAcknowledged?: boolean;
  autoTrigger?: boolean;
  storeOk?: boolean;
  storeError?: { message?: string };
};

type TestConnectionResponse = {
  error?: string;
  primary?: { ok?: boolean; provider?: string; model?: string; error?: string };
  fallback?: { ok?: boolean; provider?: string; model?: string; error?: string };
};

type SetConfigResponse = { error?: string };
type ExportUserDataResponse = { json?: string; error?: string };
type ImportUserDataResponse = { success?: boolean; error?: string; imported?: Record<string, number> };
type ClearDataResponse = { success?: boolean; error?: string };

type PopupStoredConfigRecord = Record<string, unknown> &
  Partial<{
    advancedMode: boolean;
    apiKey: string;
    provider: string;
    baseUrl: string;
    allowInsecureHttp: boolean;
    allowPrivateHosts: boolean;
    model: string;
    styles: string[];
    language: string;
    autoInGroups: boolean;
    autoTrigger: boolean;
    autoAgent: boolean;
    customSystemPrompt: string;
    customUserPrompt: string;
    privacyAcknowledged: boolean;
    redactPii: boolean;
    anonymizeSenders: boolean;
    contextMessageLimit: number | string;
    maxCharsPerMessage: number | string;
    maxTotalChars: number | string;
    temperature: number | string;
    fallbackProvider: string;
    fallbackBaseUrl: string;
    fallbackAllowInsecureHttp: boolean;
    fallbackAllowPrivateHosts: boolean;
    fallbackModel: string;
    fallbackApiKey: string;
    enableFallback: boolean;
    suggestionCount: number | string;
    persistApiKey: boolean;
    enableMemory: boolean;
  }>;

let lastStatus: StatusResponse | null = null;

function normalizeTemperaturePercent(value: unknown): number {
  const fallback = 80;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.trunc(n)));
}

function syncTemperatureUi(value: unknown) {
  const normalized = normalizeTemperaturePercent(value);
  if (!temperatureInput || !temperatureValueEl) return;
  temperatureInput.value = String(normalized);
  temperatureValueEl.textContent = String(normalized);
}

temperatureInput?.addEventListener('input', () => {
  syncTemperatureUi(temperatureInput.value);
});

try {
  if (aboutVersionEl) {
    const version = runtimeGetManifestVersion();
    aboutVersionEl.textContent = version ? `Social Copilot v${version}` : 'Social Copilot';
  }
} catch {
  // ignore
}

function hideReleaseOnlyFields() {
  if (!IS_RELEASE) return;

  const toHide = [
    allowInsecureHttpCheckbox,
    allowPrivateHostsCheckbox,
    fallbackAllowInsecureHttpCheckbox,
    fallbackAllowPrivateHostsCheckbox,
  ];

  for (const checkbox of toHide) {
    checkbox.checked = false;
    const row = checkbox.closest('.form-group');
    if (row instanceof HTMLElement) {
      row.style.display = 'none';
    }
  }
}

hideReleaseOnlyFields();

// Tab 切换
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const tabId = tab.getAttribute('data-tab')!;

    // 更新 tab 状态
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    // 更新内容
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    document.getElementById(tabId)?.classList.add('active');

    if (tabId === 'contacts') {
      void loadContacts();
    }
  });
});

type ContactListItem = {
  displayName: string;
  app: string;
  messageCount: number;
  key: ContactKey;
  memorySummary?: string | null;
  memoryUpdatedAt?: number | null;
  preference?: { styleHistory?: { style: string; count: number }[] } | null;
};

type GetContactsResponse = { contacts?: ContactListItem[] };

let contactsCache: ContactListItem[] = [];

if (contactListEl) {
  contactListEl.addEventListener('click', async (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest('button');
    if (!btn) return;

    const index = Number(btn.getAttribute('data-index') || '-1');
    const contact = contactsCache[index];
    if (!contact) return;

    try {
      if (btn.classList.contains('reset-pref-btn')) {
        if (!confirm(`重置 ${contact.displayName} 的风格偏好？`)) return;
        await runtimeSendMessage({ type: 'RESET_STYLE_PREFERENCE', contactKey: contact.key });
        await loadContacts();
        return;
      }
      if (btn.classList.contains('clear-memory-btn')) {
        if (!confirm(`清空 ${contact.displayName} 的长期记忆？`)) return;
        await runtimeSendMessage({ type: 'CLEAR_CONTACT_MEMORY', contactKey: contact.key });
        await loadContacts();
        return;
      }
      if (btn.classList.contains('clear-contact-btn')) {
        if (!confirm(`清除 ${contact.displayName} 的全部本地数据（消息/画像/偏好/记忆）？`)) return;
        await runtimeSendMessage({ type: 'CLEAR_CONTACT_DATA', contactKey: contact.key });
        await loadContacts();
        return;
      }
    } catch (err) {
      statusEl.className = 'status warning';
      statusEl.textContent = `操作失败：${(err as Error).message}`;
    }
  });
}

function clearChildren(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function buildEmptyState(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.textContent = text;
  return el;
}

function buildStyleStats(preference: ContactListItem['preference']): DocumentFragment {
  const frag = document.createDocumentFragment();
  const history = preference?.styleHistory;
  if (!history || history.length === 0) {
    const muted = document.createElement('span');
    muted.className = 'muted';
    muted.textContent = '暂无风格选择记录';
    frag.appendChild(muted);
    return frag;
  }

  const sorted = [...history].sort((a, b) => b.count - a.count);
  for (const entry of sorted) {
    const pill = document.createElement('span');
    pill.className = 'style-pill';

    const label = document.createTextNode(`${getStyleLabel(entry.style)} `);
    const count = document.createElement('strong');
    count.textContent = String(entry.count);

    pill.appendChild(label);
    pill.appendChild(count);
    frag.appendChild(pill);
  }

  return frag;
}

async function loadContacts() {
  if (!contactListEl) return;

  const listEl = contactListEl as HTMLElement;
  clearChildren(listEl);

  try {
    const response = await runtimeSendMessage<GetContactsResponse>({ type: 'GET_CONTACTS_WITH_PREFS' });
    const contacts = response?.contacts ?? [];
    contactsCache = contacts;

    if (contacts.length === 0) {
      listEl.appendChild(buildEmptyState('暂无联系人记录'));
      return;
    }

    for (const [index, contact] of contacts.entries()) {
      const item = document.createElement('div');
      item.className = 'contact-item';

      const header = document.createElement('div');
      header.className = 'contact-header';

      const avatar = document.createElement('div');
      avatar.className = 'contact-avatar';
      avatar.textContent = contact.displayName.charAt(0).toUpperCase();

      const info = document.createElement('div');
      info.className = 'contact-info';

      const name = document.createElement('div');
      name.className = 'contact-name';
      name.setAttribute('title', contact.displayName);
      name.textContent = contact.displayName;

      const meta = document.createElement('div');
      meta.className = 'contact-meta';
      meta.textContent = `${contact.app} · ${contact.messageCount} 条消息`;

      info.appendChild(name);
      info.appendChild(meta);

      header.appendChild(avatar);
      header.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'contact-actions';

      const resetBtn = document.createElement('button');
      resetBtn.className = 'reset-pref-btn';
      resetBtn.setAttribute('data-index', String(index));
      resetBtn.textContent = '重置偏好';

      const clearMemoryBtn = document.createElement('button');
      clearMemoryBtn.className = 'clear-memory-btn';
      clearMemoryBtn.setAttribute('data-index', String(index));
      clearMemoryBtn.textContent = '清空记忆';

      const clearContactBtn = document.createElement('button');
      clearContactBtn.className = 'clear-contact-btn';
      clearContactBtn.setAttribute('data-index', String(index));
      clearContactBtn.textContent = '清除数据';

      actions.appendChild(resetBtn);
      actions.appendChild(clearMemoryBtn);
      actions.appendChild(clearContactBtn);

      const styleStats = document.createElement('div');
      styleStats.className = 'style-stats';
      styleStats.appendChild(buildStyleStats(contact.preference ?? null));

      const memoryBox = document.createElement('div');
      memoryBox.className = 'memory-box';

      const memoryTitle = document.createElement('div');
      memoryTitle.className = 'memory-title';
      memoryTitle.appendChild(document.createTextNode('长期记忆'));
      if (contact.memoryUpdatedAt) {
        memoryTitle.appendChild(document.createTextNode(' '));
        const date = document.createElement('span');
        date.className = 'muted';
        date.textContent = `(${new Date(contact.memoryUpdatedAt).toISOString().slice(0, 10)})`;
        memoryTitle.appendChild(date);
      }

      const memoryText = document.createElement('div');
      memoryText.className = 'memory-text';
      if (contact.memorySummary) {
        memoryText.textContent = contact.memorySummary;
      } else {
        const muted = document.createElement('span');
        muted.className = 'muted';
        muted.textContent = '暂无长期记忆';
        memoryText.appendChild(muted);
      }

      memoryBox.appendChild(memoryTitle);
      memoryBox.appendChild(memoryText);

      item.appendChild(header);
      item.appendChild(actions);
      item.appendChild(styleStats);
      item.appendChild(memoryBox);

      listEl.appendChild(item);
    }
  } catch {
    listEl.appendChild(buildEmptyState('加载失败'));
  }
}

// 风格选择
document.querySelectorAll('.style-option').forEach((option) => {
  const toggleSelection = () => {
    option.classList.toggle('selected');
  };
  option.addEventListener('click', toggleSelection);
  option.addEventListener('keydown', (ev) => {
    const keyEv = ev as KeyboardEvent;
    if (keyEv.key === 'Enter' || keyEv.key === ' ') {
      keyEv.preventDefault();
      toggleSelection();
    }
  });
});

// Provider 切换时更新提示
providerSelect.addEventListener('change', () => {
  refreshApiKeyHint();
  updateBaseUrlUi(providerSelect.value, baseUrlInput, baseUrlHint);
  updateModelUi(providerSelect.value, modelInput, modelHint, modelSuggestions);
});

fallbackProviderSelect.addEventListener('change', () => {
  updateApiKeyHint(fallbackProviderSelect.value, fallbackApiKeyHint);
  updateBaseUrlUi(fallbackProviderSelect.value, fallbackBaseUrlInput, fallbackBaseUrlHint);
  updateModelUi(fallbackProviderSelect.value, fallbackModelInput, fallbackModelHint, fallbackModelSuggestions);
});

enableFallbackCheckbox.addEventListener('change', () => {
  toggleFallbackFields();
});

advancedModeCheckbox?.addEventListener('change', () => {
  toggleAdvancedFields();
  refreshApiKeyHint();
});

function toggleAdvancedFields() {
  if (!advancedModeCheckbox || !advancedFields) return;
  advancedFields.classList.toggle('hidden', !advancedModeCheckbox.checked);
}

function getProviderModelMeta(provider: string): { defaultModel: string; docsUrl: string; suggestions: string[] } {
  if (provider === 'openai') {
    return {
      defaultModel: 'gpt-5.2-chat-latest',
      docsUrl: 'https://platform.openai.com/docs/models',
      suggestions: ['gpt-5.2-chat-latest', 'gpt-5.2', 'gpt-5.2-pro'],
    };
  }
  if (provider === 'claude') {
    return {
      defaultModel: 'claude-sonnet-4-5',
      docsUrl: 'https://docs.anthropic.com/',
      suggestions: [
        'claude-opus-4-5',
        'claude-sonnet-4-5',
        'claude-haiku-4-5',
      ],
    };
  }
  // deepseek
  return {
    defaultModel: 'deepseek-v3.2',
    docsUrl: 'https://platform.deepseek.com/',
    suggestions: ['deepseek-v3.2', 'deepseek-v3.1', 'deepseek-r1-0528'],
  };
}

function getProviderBaseUrlMeta(provider: string): { defaultBaseUrl: string; docsUrl: string } {
  if (provider === 'openai') {
    return { defaultBaseUrl: 'https://api.openai.com', docsUrl: 'https://platform.openai.com/docs/api-reference' };
  }
  if (provider === 'claude') {
    return { defaultBaseUrl: 'https://api.anthropic.com', docsUrl: 'https://docs.anthropic.com/en/api' };
  }
  return { defaultBaseUrl: 'https://api.deepseek.com', docsUrl: 'https://platform.deepseek.com/' };
}

function updateBaseUrlUi(provider: string, inputEl: HTMLInputElement, hintEl: HTMLElement) {
  const meta = getProviderBaseUrlMeta(provider);
  inputEl.placeholder = meta.defaultBaseUrl;

  while (hintEl.firstChild) hintEl.removeChild(hintEl.firstChild);

  hintEl.appendChild(document.createTextNode('留空则使用默认：'));

  const codeEl = document.createElement('code');
  codeEl.textContent = meta.defaultBaseUrl;
  hintEl.appendChild(codeEl);

  hintEl.appendChild(document.createTextNode('，'));

  const linkEl = document.createElement('a');
  linkEl.href = meta.docsUrl;
  linkEl.target = '_blank';
  linkEl.rel = 'noopener noreferrer';
  linkEl.textContent = '查看接口文档';
  hintEl.appendChild(linkEl);

  hintEl.appendChild(document.createTextNode('（默认仅支持官方域名，不要包含 '));

  const v1CodeEl = document.createElement('code');
  v1CodeEl.textContent = '/v1';
  hintEl.appendChild(v1CodeEl);

  hintEl.appendChild(document.createTextNode('）'));
}

function isPrivateOrLocalHost(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  if (!host) return false;

  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  if (host === 'localhost' || host === '::1') return true;

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((s) => Number.parseInt(s, 10));
    if (octets.some((o) => !Number.isFinite(o) || o < 0 || o > 255)) return true;
    const [a, b] = octets;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }

  if (host.startsWith('fc') || host.startsWith('fd')) return true;
  if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return true;

  return false;
}

function parseOptionalBaseUrl(
  raw: string,
  options: { allowInsecureHttp: boolean; allowPrivateHosts: boolean }
): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Base URL 必须是完整 URL（例如 https://api.deepseek.com）');
  }

  if (url.protocol !== 'https:' && !(options.allowInsecureHttp && url.protocol === 'http:')) {
    throw new Error('Base URL 仅支持 https（或勾选允许 http）');
  }

  if (!options.allowPrivateHosts && isPrivateOrLocalHost(url.hostname)) {
    throw new Error('Base URL 不支持 localhost/内网地址（或勾选允许本地/私有地址）');
  }

  // Drop query/hash; keep origin + pathname. Trailing slash is fine (core will normalize).
  return `${url.origin}${url.pathname}`;
}

function ensureAllowedBaseUrl(
  provider: string,
  baseUrl: string | undefined,
  label: string,
  options: { allowInsecureHttp: boolean; allowPrivateHosts: boolean }
) {
  if (!baseUrl) return;
  if (options.allowInsecureHttp || options.allowPrivateHosts) return;
  const allowedOrigin = new URL(getProviderBaseUrlMeta(provider).defaultBaseUrl).origin;
  const origin = new URL(baseUrl).origin;
  if (origin !== allowedOrigin) {
    throw new Error(`${label} 仅支持官方域名（${allowedOrigin}），以避免额外权限告警。`);
  }
}

function updateModelUi(
  provider: string,
  inputEl: HTMLInputElement,
  hintEl: HTMLElement,
  datalistEl: HTMLDataListElement
) {
  const meta = getProviderModelMeta(provider);
  inputEl.placeholder = meta.defaultModel;

  while (datalistEl.firstChild) datalistEl.removeChild(datalistEl.firstChild);
  for (const model of meta.suggestions) {
    const opt = document.createElement('option');
    opt.value = model;
    datalistEl.appendChild(opt);
  }

  while (hintEl.firstChild) hintEl.removeChild(hintEl.firstChild);

  hintEl.appendChild(document.createTextNode('不填写则使用默认：'));

  const codeEl = document.createElement('code');
  codeEl.textContent = meta.defaultModel;
  hintEl.appendChild(codeEl);

  hintEl.appendChild(document.createTextNode('，'));

  const linkEl = document.createElement('a');
  linkEl.href = meta.docsUrl;
  linkEl.target = '_blank';
  linkEl.rel = 'noopener noreferrer';
  linkEl.textContent = '查看模型列表';
  hintEl.appendChild(linkEl);
}

function updateApiKeyHint(provider: string, hintEl: HTMLElement) {
  while (hintEl.firstChild) hintEl.removeChild(hintEl.firstChild);

  const linkEl = document.createElement('a');
  linkEl.target = '_blank';
  linkEl.rel = 'noopener noreferrer';

  if (provider === 'builtin') {
    linkEl.href = 'https://siliconflow.cn/';
    linkEl.textContent = '获取官方服务 API Key';
  } else if (provider === 'openai') {
    linkEl.href = 'https://platform.openai.com/api-keys';
    linkEl.textContent = '获取 OpenAI API Key';
  } else if (provider === 'claude') {
    linkEl.href = 'https://console.anthropic.com/';
    linkEl.textContent = '获取 Claude API Key';
  } else {
    linkEl.href = 'https://platform.deepseek.com/';
    linkEl.textContent = '获取 DeepSeek API Key';
  }

  hintEl.appendChild(linkEl);
}

function getEffectiveProviderForApiKey(): string {
  const advancedMode = advancedModeCheckbox?.checked ?? false;
  return advancedMode ? providerSelect.value : 'builtin';
}

function refreshApiKeyHint() {
  updateApiKeyHint(getEffectiveProviderForApiKey(), apiKeyHint);
}

function toggleFallbackFields() {
  fallbackFields.classList.toggle('hidden', !enableFallbackCheckbox.checked);
}

function parseOptionalInt(input: HTMLInputElement): number | undefined {
  const raw = input.value.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}

function getSelectedStyles(): string[] {
  const styles: string[] = [];
  document.querySelectorAll('.style-option.selected').forEach((option) => {
    const style = option.getAttribute('data-style');
    if (style) styles.push(style);
  });
  return styles;
}

function buildConfigFromForm() {
  const advancedMode = advancedModeCheckbox?.checked ?? false;
  const apiKey = apiKeyInput.value.trim();
  const provider = advancedMode ? providerSelect.value : 'builtin';
  const baseUrlRaw = advancedMode ? baseUrlInput.value : '';
  const allowInsecureHttp = IS_RELEASE ? false : (advancedMode && allowInsecureHttpCheckbox.checked);
  const allowPrivateHosts = IS_RELEASE ? false : (advancedMode && allowPrivateHostsCheckbox.checked);
  const model = advancedMode ? modelInput.value.trim() : '';
  const persistApiKey = persistApiKeyCheckbox.checked;
  const enableMemory = enableMemoryCheckbox.checked;
  const language = languageSelect.value;
  const autoInGroups = autoInGroupsCheckbox.checked;
  const autoTrigger = autoTriggerCheckbox.checked;
  const autoAgent = autoAgentCheckbox.checked;
  const privacyAcknowledged = privacyAcknowledgedCheckbox.checked;
  const redactPii = redactPiiCheckbox.checked;
  const anonymizeSenders = anonymizeSendersCheckbox.checked;
  const contextMessageLimit = parseOptionalInt(contextMessageLimitInput);
  const maxCharsPerMessage = parseOptionalInt(maxCharsPerMessageInput);
  const maxTotalChars = parseOptionalInt(maxTotalCharsInput);
  const temperature = normalizeTemperaturePercent(temperatureInput?.value ?? 80);
  const enableFallback = enableFallbackCheckbox.checked;
  const fallbackProvider = fallbackProviderSelect.value;
  const fallbackBaseUrlRaw = fallbackBaseUrlInput.value;
  const fallbackAllowInsecureHttp = IS_RELEASE ? false : fallbackAllowInsecureHttpCheckbox.checked;
  const fallbackAllowPrivateHosts = IS_RELEASE ? false : fallbackAllowPrivateHostsCheckbox.checked;
  const fallbackModel = fallbackModelInput.value.trim();
  const fallbackApiKey = fallbackApiKeyInput.value.trim();
  const suggestionCount = Number(suggestionCountSelect.value);
  const customSystemPrompt = customSystemPromptInput.value.trim();
  const customUserPrompt = customUserPromptInput.value.trim();

  const baseUrl = advancedMode ? parseOptionalBaseUrl(baseUrlRaw, { allowInsecureHttp, allowPrivateHosts }) : undefined;
  const fallbackBaseUrl = enableFallback
    ? parseOptionalBaseUrl(fallbackBaseUrlRaw, {
        allowInsecureHttp: fallbackAllowInsecureHttp,
        allowPrivateHosts: fallbackAllowPrivateHosts,
      })
    : undefined;

  if (advancedMode) {
    ensureAllowedBaseUrl(provider, baseUrl, '主用 Base URL', { allowInsecureHttp, allowPrivateHosts });
  }
  if (enableFallback) {
    const fallbackProviderForValidation = fallbackProvider || provider;
    ensureAllowedBaseUrl(fallbackProviderForValidation, fallbackBaseUrl, '备用 Base URL', {
      allowInsecureHttp: fallbackAllowInsecureHttp,
      allowPrivateHosts: fallbackAllowPrivateHosts,
    });
  }

  const styles = getSelectedStyles();
  if (styles.length === 0) {
    throw new Error('请至少选择一种回复风格');
  }

  return {
    advancedMode,
    apiKey,
    provider,
    baseUrl,
    allowInsecureHttp,
    allowPrivateHosts,
    model,
    styles,
    language: language === 'zh' || language === 'en' || language === 'auto' ? language : 'auto',
    autoInGroups,
    autoTrigger,
    autoAgent,
    customSystemPrompt: customSystemPrompt || undefined,
    customUserPrompt: customUserPrompt || undefined,
    privacyAcknowledged,
    persistApiKey,
    enableMemory,
    redactPii,
    anonymizeSenders,
    contextMessageLimit,
    maxCharsPerMessage,
    maxTotalChars,
    temperature,
    enableFallback,
    fallbackProvider,
    fallbackBaseUrl: enableFallback ? fallbackBaseUrl : undefined,
    fallbackAllowInsecureHttp,
    fallbackAllowPrivateHosts,
    fallbackModel,
    fallbackApiKey,
    suggestionCount,
  };
}

function buildModelHint(errors: Array<string | undefined | null>): string {
  const text = errors.filter(Boolean).join(' ').toLowerCase();
  if (!text) return '';
  const looksLikeModelIssue =
    text.includes('model_not_found') ||
    text.includes('unknown model') ||
    text.includes('invalid model') ||
    (text.includes('model') && (text.includes('not found') || text.includes('does not exist') || text.includes('not exist')));
  return looksLikeModelIssue ? '（提示：模型名称可能无效，请核对提供商最新模型列表）' : '';
}

// 检查状态
async function checkStatus() {
  try {
    const response = await runtimeSendMessage<StatusResponse>({ type: 'GET_STATUS' });
    lastStatus = response ?? null;

    if (response?.storeOk === false) {
      statusEl.className = 'status warning';
      const errMsg = response.storeError?.message ? `（${response.storeError.message}）` : '';
      statusEl.textContent = `本地数据库初始化失败${errMsg}：请先导出诊断并点击“清除数据”恢复`;
      return;
    }

    if (response?.hasApiKey) {
      const privacyOk = Boolean(response.privacyAcknowledged);
      const autoTrigger = response.autoTrigger === undefined ? true : Boolean(response.autoTrigger);

      if (!privacyOk) {
        statusEl.className = 'status warning';
        statusEl.textContent = '已配置，但需确认隐私告知才能生成建议';
        return;
      }

      statusEl.className = 'status success';
      const providerText = response.activeProvider ? `当前提供商：${response.activeProvider}` : '已配置，准备就绪';
      const modelText = response.activeModel ? ` / ${response.activeModel}` : '';
      const fallbackText = response.hasFallback ? '，已启用备用模型' : '';
      const autoText = autoTrigger ? '' : '，自动触发已关闭';
      statusEl.textContent = `${providerText}${modelText}${fallbackText}${autoText}`;
    } else {
      statusEl.className = 'status warning';
      statusEl.textContent = '请设置 API Key';
    }
  } catch (error) {
    statusEl.className = 'status warning';
    statusEl.textContent = '无法连接到扩展';
  }
}

// 加载已保存的设置
async function loadSettings() {
  const result = await storageLocalGet<PopupStoredConfigRecord>([
    'advancedMode',
    'apiKey',
    'provider',
    'baseUrl',
    'allowInsecureHttp',
    'allowPrivateHosts',
    'model',
    'styles',
    'language',
    'autoInGroups',
    'autoTrigger',
    'autoAgent',
    'customSystemPrompt',
    'customUserPrompt',
    'privacyAcknowledged',
    'redactPii',
    'anonymizeSenders',
    'contextMessageLimit',
    'maxCharsPerMessage',
    'maxTotalChars',
    'temperature',
    'fallbackProvider',
    'fallbackBaseUrl',
    'fallbackAllowInsecureHttp',
    'fallbackAllowPrivateHosts',
    'fallbackModel',
    'fallbackApiKey',
    'enableFallback',
    'suggestionCount',
    'persistApiKey',
    'enableMemory',
  ]);

  if (remoteSelectorsUrlInput) {
    const remoteSelectorsUrl = await storageLocalGet<Record<string, unknown> & { remoteSelectorsUrl?: unknown }>(
      'remoteSelectorsUrl'
    );
    remoteSelectorsUrlInput.value = typeof remoteSelectorsUrl.remoteSelectorsUrl === 'string'
      ? remoteSelectorsUrl.remoteSelectorsUrl
      : '';
  }

  if (advancedModeCheckbox) {
    const inferred = typeof result.advancedMode === 'boolean'
      ? result.advancedMode
      : typeof result.provider === 'string'
        ? result.provider !== 'builtin'
        : false;
    advancedModeCheckbox.checked = inferred;
    toggleAdvancedFields();
  }

  if (result.apiKey) {
    apiKeyInput.value = result.apiKey;
  }

  if (result.provider) {
    providerSelect.value = result.provider;
  }

  if (typeof result.baseUrl === 'string') {
    baseUrlInput.value = result.baseUrl;
  }
  allowInsecureHttpCheckbox.checked = Boolean(result.allowInsecureHttp);
  allowPrivateHostsCheckbox.checked = Boolean(result.allowPrivateHosts);

  if (typeof result.model === 'string') {
    modelInput.value = result.model;
  }

  providerSelect.dispatchEvent(new Event('change'));
  refreshApiKeyHint();

  if (result.fallbackProvider) {
    fallbackProviderSelect.value = result.fallbackProvider;
  }

  if (typeof result.fallbackBaseUrl === 'string') {
    fallbackBaseUrlInput.value = result.fallbackBaseUrl;
  }
  fallbackAllowInsecureHttpCheckbox.checked = Boolean(result.fallbackAllowInsecureHttp);
  fallbackAllowPrivateHostsCheckbox.checked = Boolean(result.fallbackAllowPrivateHosts);

  if (typeof result.fallbackModel === 'string') {
    fallbackModelInput.value = result.fallbackModel;
  }

  if (result.fallbackApiKey) {
    fallbackApiKeyInput.value = result.fallbackApiKey;
  }

  enableFallbackCheckbox.checked = Boolean(result.enableFallback);
  toggleFallbackFields();
  fallbackProviderSelect.dispatchEvent(new Event('change'));

  persistApiKeyCheckbox.checked = Boolean(result.persistApiKey);
  enableMemoryCheckbox.checked = Boolean(result.enableMemory);
  if (result.language === 'zh' || result.language === 'en' || result.language === 'auto') {
    languageSelect.value = result.language;
  } else {
    languageSelect.value = 'auto';
  }
  autoInGroupsCheckbox.checked = Boolean(result.autoInGroups);
  autoTriggerCheckbox.checked = result.autoTrigger === undefined ? true : Boolean(result.autoTrigger);
  autoAgentCheckbox.checked = Boolean(result.autoAgent);
  privacyAcknowledgedCheckbox.checked = result.privacyAcknowledged === undefined ? false : Boolean(result.privacyAcknowledged);

  customSystemPromptInput.value = typeof result.customSystemPrompt === 'string' ? result.customSystemPrompt : '';
  customUserPromptInput.value = typeof result.customUserPrompt === 'string' ? result.customUserPrompt : '';

  // privacy defaults: redact/anonymize true when missing
  redactPiiCheckbox.checked = result.redactPii === undefined ? true : Boolean(result.redactPii);
  anonymizeSendersCheckbox.checked = result.anonymizeSenders === undefined ? true : Boolean(result.anonymizeSenders);
  if (typeof result.contextMessageLimit === 'number') {
    contextMessageLimitInput.value = String(result.contextMessageLimit);
  }
  if (typeof result.maxCharsPerMessage === 'number') {
    maxCharsPerMessageInput.value = String(result.maxCharsPerMessage);
  }
  if (typeof result.maxTotalChars === 'number') {
    maxTotalCharsInput.value = String(result.maxTotalChars);
  }

  syncTemperatureUi(result.temperature);

  if (result.suggestionCount === 2 || result.suggestionCount === 3) {
    suggestionCountSelect.value = String(result.suggestionCount);
  }

  const selectedStyles = Array.isArray(result.styles) ? result.styles : null;
  if (selectedStyles) {
    document.querySelectorAll('.style-option').forEach((option) => {
      const style = option.getAttribute('data-style');
      if (style && selectedStyles.includes(style)) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });
  }
}

testConnectionBtn?.addEventListener('click', async () => {
  testConnectionBtn.disabled = true;
  statusEl.className = 'status warning';
  statusEl.textContent = '正在测试连接...';

  try {
    const config = buildConfigFromForm();
    if (!config.privacyAcknowledged) throw new Error('请先勾选「我已理解并同意隐私告知」');
    if (!config.apiKey) throw new Error('请输入 API Key');
    if (config.enableFallback && !config.fallbackApiKey) throw new Error('请输入备用 API Key');

    const response = await runtimeSendMessage<TestConnectionResponse>({ type: 'TEST_CONNECTION', config });
    if (response?.error) throw new Error(response.error);

    const primaryOk = Boolean(response?.primary?.ok);
    const fallbackOk = response?.fallback ? Boolean(response.fallback.ok) : true;

    if (primaryOk && fallbackOk) {
      statusEl.className = 'status success';
      const primaryText = response.primary?.model
        ? `${response.primary.provider} / ${response.primary.model}`
        : response.primary?.provider;
      const fallbackText = response.fallback
        ? response.fallback?.model
          ? `；备用：${response.fallback.provider} / ${response.fallback.model}`
          : `；备用：${response.fallback.provider}`
        : '';
      statusEl.textContent = `连接成功：${primaryText}${fallbackText}`;
      return;
    }

    statusEl.className = 'status warning';
    const primaryErr = response?.primary?.ok ? '' : `主模型：${response?.primary?.error || '连接失败'}`;
    const fallbackErr =
      response?.fallback && !response.fallback.ok ? `；备用：${response.fallback.error || '连接失败'}` : '';
    const hint = buildModelHint([response?.primary?.error, response?.fallback?.error]);
    statusEl.textContent = `${primaryErr || '连接失败'}${fallbackErr}${hint}`;
  } catch (err) {
    statusEl.className = 'status warning';
    const hint = buildModelHint([(err as Error).message]);
    statusEl.textContent = `${(err as Error).message}${hint}`;
  } finally {
    testConnectionBtn.disabled = false;
  }
});

// 保存设置
saveBtn.addEventListener('click', async () => {
  let config: ReturnType<typeof buildConfigFromForm>;
  try {
    config = buildConfigFromForm();
  } catch (err) {
    alert((err as Error).message);
    return;
  }

  if (!config.privacyAcknowledged) {
    alert('请先勾选「我已理解并同意隐私告知」');
    return;
  }

  if (!config.apiKey) {
    const status = lastStatus ?? (await runtimeSendMessage<StatusResponse>({ type: 'GET_STATUS' }));
    if (!status?.hasApiKey) {
      alert('请输入 API Key');
      return;
    }
  }

  if (config.enableFallback && !config.fallbackApiKey) {
    const status = lastStatus ?? (await runtimeSendMessage<StatusResponse>({ type: 'GET_STATUS' }));
    if (!status?.hasFallback) {
      alert('请输入备用 API Key');
      return;
    }
  }

  // 通知 background（由 background 决定是否持久化 key）
  const response = await runtimeSendMessage<SetConfigResponse>({
    type: 'SET_CONFIG',
    config,
  });

  if (response?.error) {
    statusEl.className = 'status warning';
    statusEl.textContent = `${response.error}`;
    return;
  }

  statusEl.className = 'status success';
  statusEl.textContent = '设置已保存';

  if (remoteSelectorsUrlInput) {
    const value = remoteSelectorsUrlInput.value.trim();
    if (value) {
      await storageLocalSet({ remoteSelectorsUrl: value });
    } else {
      await storageLocalRemove('remoteSelectorsUrl');
    }
  }

  if (!config.persistApiKey) {
    apiKeyInput.value = '';
    if (config.enableFallback) fallbackApiKeyInput.value = '';
  }

  await checkStatus();
});

function downloadJson(filename: string, json: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// 备份导出
exportUserDataBtn.addEventListener('click', async () => {
  try {
    statusEl.className = 'status info';
    statusEl.textContent = '正在导出…';
    await nextFrame();

    const res = await runtimeSendMessage<ExportUserDataResponse>({ type: 'EXPORT_USER_DATA_JSON' });
    const json = typeof res?.json === 'string' ? res.json : undefined;
    if (!json) throw new Error(res?.error || '导出失败');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`social-copilot-backup-${ts}.json`, json);
    statusEl.className = 'status info';
    statusEl.textContent = '已导出数据备份 JSON（不包含 API Key）';
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `导出失败：${(err as Error).message}`;
  }
});

// 备份导入
importUserDataBtn.addEventListener('click', () => {
  importUserDataFile.click();
});

importUserDataFile.addEventListener('change', async () => {
  const file = importUserDataFile.files?.[0];
  importUserDataFile.value = '';
  if (!file) return;

  if (!confirm('导入会合并/覆盖本地画像、偏好与长期记忆（不会导入 API Key）。是否继续？')) {
    return;
  }

  try {
    validateImportFileSize(file.size);
    const text = await file.text();
    const data = parseAndValidateUserDataBackup(text);
    const res = await runtimeSendMessage<ImportUserDataResponse>({ type: 'IMPORT_USER_DATA', data });
    if (!res?.success) {
      statusEl.className = 'status warning';
      statusEl.textContent = `导入失败：${res?.error || '未知错误'}`;
      return;
    }
    const imported = res?.imported as Record<string, number> | undefined;
    const summary = imported
      ? `profiles=${imported.profiles ?? 0}, prefs=${imported.stylePreferences ?? 0}, memories=${imported.contactMemories ?? 0}`
      : 'ok';
    statusEl.className = 'status info';
    statusEl.textContent = `已导入数据备份（${summary}）`;
    await checkStatus();
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `导入失败：${(err as Error).message}`;
  }
});

// 清除数据
clearDataBtn.addEventListener('click', async () => {
  if (confirm('确定要清除所有数据吗？这将删除所有联系人记录和设置。')) {
    try {
      await storageLocalClear();
      const res = await runtimeSendMessage<ClearDataResponse>({ type: 'CLEAR_DATA' });
      if (res?.success === false) {
        statusEl.className = 'status warning';
        statusEl.textContent = `清除未完全成功：${res.error ?? '未知错误'}（可尝试关闭所有聊天站点标签页后重试）`;
        return;
      }

      statusEl.className = 'status warning';
      statusEl.textContent = '数据已清除，请重新设置';
      apiKeyInput.value = '';
      fallbackApiKeyInput.value = '';
      enableFallbackCheckbox.checked = false;
      toggleFallbackFields();
      await checkStatus();
    } catch (err) {
      statusEl.className = 'status warning';
      statusEl.textContent = `清除失败：${(err as Error).message}`;
    }
  }
});

// 诊断与调试
async function loadDebugFlag() {
  try {
    const stored = await storageLocalGet<Record<string, unknown> & { debugEnabled?: unknown }>('debugEnabled');
    debugEnabledCheckbox.checked = Boolean(stored.debugEnabled);
  } catch {
    debugEnabledCheckbox.checked = false;
  }
}

debugEnabledCheckbox.addEventListener('change', async () => {
  try {
    const enabled = debugEnabledCheckbox.checked;
    await runtimeSendMessage({ type: 'SET_DEBUG_ENABLED', enabled });
    statusEl.className = 'status info';
    statusEl.textContent = enabled ? '已启用诊断日志' : '已关闭诊断日志';
    await checkStatus();
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `设置诊断失败：${(err as Error).message}`;
  }
});

async function getDiagnosticsJson(): Promise<string> {
  const res = await runtimeSendMessage<{ json?: string }>({ type: 'GET_DIAGNOSTICS_JSON', pretty: true });
  if (res?.json && typeof res.json === 'string') return res.json;
  const snapshot = await runtimeSendMessage<unknown>({ type: 'GET_DIAGNOSTICS' });
  return JSON.stringify(snapshot, null, 2);
}

copyDiagnosticsBtn.addEventListener('click', async () => {
  try {
    const json = await getDiagnosticsJson();
    await navigator.clipboard.writeText(json);
    statusEl.className = 'status info';
    statusEl.textContent = '诊断信息已复制到剪贴板';
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `复制失败：${(err as Error).message}`;
  }
});

downloadDiagnosticsBtn.addEventListener('click', async () => {
  try {
    statusEl.className = 'status info';
    statusEl.textContent = '正在生成诊断 JSON…';
    await nextFrame();

    const json = await getDiagnosticsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `social-copilot-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    statusEl.className = 'status info';
    statusEl.textContent = '已下载诊断 JSON';
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `下载失败：${(err as Error).message}`;
  }
});

clearDiagnosticsBtn.addEventListener('click', async () => {
  try {
    await runtimeSendMessage({ type: 'CLEAR_DIAGNOSTICS' });
    statusEl.className = 'status info';
    statusEl.textContent = '已清空诊断日志';
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `清空失败：${(err as Error).message}`;
  }
});

// 初始化
checkStatus();
loadSettings();
loadDebugFlag();
