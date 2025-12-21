import type { ContactKey } from '@social-copilot/core';
import { renderStyleStats } from './preferences';
import { parseAndValidateUserDataBackup, validateImportFileSize } from './importUserData';
import { escapeHtml } from '../utils/escape-html';

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
const privacyAcknowledgedCheckbox = document.getElementById('privacyAcknowledged') as HTMLInputElement;
const redactPiiCheckbox = document.getElementById('redactPii') as HTMLInputElement;
const anonymizeSendersCheckbox = document.getElementById('anonymizeSenders') as HTMLInputElement;
const contextMessageLimitInput = document.getElementById('contextMessageLimit') as HTMLInputElement;
const maxCharsPerMessageInput = document.getElementById('maxCharsPerMessage') as HTMLInputElement;
const maxTotalCharsInput = document.getElementById('maxTotalChars') as HTMLInputElement;
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
const contactListEl = document.getElementById('contactList')!;
const clearDataBtn = document.getElementById('clearDataBtn')!;
const exportUserDataBtn = document.getElementById('exportUserDataBtn')!;
const importUserDataBtn = document.getElementById('importUserDataBtn')!;
const importUserDataFile = document.getElementById('importUserDataFile') as HTMLInputElement;
const debugEnabledCheckbox = document.getElementById('debugEnabled') as HTMLInputElement;
const copyDiagnosticsBtn = document.getElementById('copyDiagnosticsBtn')!;
const downloadDiagnosticsBtn = document.getElementById('downloadDiagnosticsBtn')!;
const clearDiagnosticsBtn = document.getElementById('clearDiagnosticsBtn')!;
const aboutVersionEl = document.getElementById('aboutVersion');

let lastStatus: {
  hasApiKey?: boolean;
  hasFallback?: boolean;
  activeProvider?: string;
  activeModel?: string;
  debugEnabled?: boolean;
  privacyAcknowledged?: boolean;
  autoTrigger?: boolean;
} | null = null;

try {
  if (aboutVersionEl) {
    aboutVersionEl.textContent = `Social Copilot v${chrome.runtime.getManifest().version}`;
  }
} catch {
  // ignore
}

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

    // 加载联系人列表
    if (tabId === 'contacts') {
      loadContacts();
    }
  });
});

// 风格选择
document.querySelectorAll('.style-option').forEach((option) => {
  option.addEventListener('click', () => {
    option.classList.toggle('selected');
  });
});

// Provider 切换时更新提示
providerSelect.addEventListener('change', () => {
  updateApiKeyHint(providerSelect.value, apiKeyHint);
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
  hintEl.innerHTML = `留空则使用默认：<code>${escapeHtml(meta.defaultBaseUrl)}</code>，<a href="${escapeHtml(
    meta.docsUrl
  )}" target="_blank" rel="noopener noreferrer">查看接口文档</a>（默认仅支持官方域名，不要包含 <code>/v1</code>）`;
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

  hintEl.innerHTML = `不填写则使用默认：<code>${escapeHtml(meta.defaultModel)}</code>，<a href="${escapeHtml(
    meta.docsUrl
  )}" target="_blank" rel="noopener noreferrer">查看模型列表</a>`;
}

function updateApiKeyHint(provider: string, hintEl: HTMLElement) {
  if (provider === 'openai') {
    hintEl.innerHTML =
      '<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">获取 OpenAI API Key</a>';
  } else if (provider === 'claude') {
    hintEl.innerHTML =
      '<a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">获取 Claude API Key</a>';
  } else {
    hintEl.innerHTML =
      '<a href="https://platform.deepseek.com/" target="_blank" rel="noopener noreferrer">获取 DeepSeek API Key</a>';
  }
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

// 检查状态
async function checkStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    lastStatus = response ?? null;

    if (response?.storeOk === false) {
      statusEl.className = 'status warning';
      const errMsg = response.storeError?.message ? `（${response.storeError.message}）` : '';
      statusEl.textContent = `⚠ 本地数据库初始化失败${errMsg}：请先导出诊断并点击“清除数据”恢复`;
      return;
    }

    if (response?.hasApiKey) {
      const privacyOk = Boolean(response.privacyAcknowledged);
      const autoTrigger = response.autoTrigger === undefined ? true : Boolean(response.autoTrigger);

      if (!privacyOk) {
        statusEl.className = 'status warning';
        statusEl.textContent = '⚠ 已配置，但需确认隐私告知才能生成建议';
        return;
      }

      statusEl.className = 'status success';
      const providerText = response.activeProvider ? `当前提供商：${response.activeProvider}` : '已配置，准备就绪';
      const modelText = response.activeModel ? ` / ${response.activeModel}` : '';
      const fallbackText = response.hasFallback ? '，已启用备用模型' : '';
      const autoText = autoTrigger ? '' : '，自动触发已关闭';
      statusEl.textContent = `✓ ${providerText}${modelText}${fallbackText}${autoText}`;
    } else {
      statusEl.className = 'status warning';
      statusEl.textContent = '⚠ 请设置 API Key';
    }
  } catch (error) {
    statusEl.className = 'status warning';
    statusEl.textContent = '⚠ 无法连接到扩展';
  }
}

// 加载已保存的设置
async function loadSettings() {
  const result = await chrome.storage.local.get([
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
    'privacyAcknowledged',
    'redactPii',
    'anonymizeSenders',
    'contextMessageLimit',
    'maxCharsPerMessage',
    'maxTotalChars',
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
  privacyAcknowledgedCheckbox.checked = Boolean(result.privacyAcknowledged);

  // privacy defaults: true/true if missing
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

  if (result.suggestionCount === 2 || result.suggestionCount === 3) {
    suggestionCountSelect.value = String(result.suggestionCount);
  }

  if (result.styles && Array.isArray(result.styles)) {
    document.querySelectorAll('.style-option').forEach((option) => {
      const style = option.getAttribute('data-style');
      if (result.styles.includes(style)) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });
  }
}

// 保存设置
saveBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  const provider = providerSelect.value;
  const baseUrlRaw = baseUrlInput.value;
  const allowInsecureHttp = allowInsecureHttpCheckbox.checked;
  const allowPrivateHosts = allowPrivateHostsCheckbox.checked;
  const model = modelInput.value.trim();
  const persistApiKey = persistApiKeyCheckbox.checked;
  const enableMemory = enableMemoryCheckbox.checked;
  const language = languageSelect.value;
  const autoInGroups = autoInGroupsCheckbox.checked;
  const autoTrigger = autoTriggerCheckbox.checked;
  const privacyAcknowledged = privacyAcknowledgedCheckbox.checked;
  const redactPii = redactPiiCheckbox.checked;
  const anonymizeSenders = anonymizeSendersCheckbox.checked;
  const contextMessageLimit = parseOptionalInt(contextMessageLimitInput);
  const maxCharsPerMessage = parseOptionalInt(maxCharsPerMessageInput);
  const maxTotalChars = parseOptionalInt(maxTotalCharsInput);
  const enableFallback = enableFallbackCheckbox.checked;
  const fallbackProvider = fallbackProviderSelect.value;
  const fallbackBaseUrlRaw = fallbackBaseUrlInput.value;
  const fallbackAllowInsecureHttp = fallbackAllowInsecureHttpCheckbox.checked;
  const fallbackAllowPrivateHosts = fallbackAllowPrivateHostsCheckbox.checked;
  const fallbackModel = fallbackModelInput.value.trim();
  const fallbackApiKey = fallbackApiKeyInput.value.trim();
  const suggestionCount = Number(suggestionCountSelect.value);

  let baseUrl: string | undefined;
  let fallbackBaseUrl: string | undefined;
  try {
    baseUrl = parseOptionalBaseUrl(baseUrlRaw, { allowInsecureHttp, allowPrivateHosts });
    fallbackBaseUrl = enableFallback
      ? parseOptionalBaseUrl(fallbackBaseUrlRaw, {
          allowInsecureHttp: fallbackAllowInsecureHttp,
          allowPrivateHosts: fallbackAllowPrivateHosts,
        })
      : undefined;
  } catch (err) {
    alert((err as Error).message);
    return;
  }

  try {
    ensureAllowedBaseUrl(provider, baseUrl, '主用 Base URL', { allowInsecureHttp, allowPrivateHosts });
    if (enableFallback) {
      const fallbackProviderForValidation = fallbackProvider || provider;
      ensureAllowedBaseUrl(fallbackProviderForValidation, fallbackBaseUrl, '备用 Base URL', {
        allowInsecureHttp: fallbackAllowInsecureHttp,
        allowPrivateHosts: fallbackAllowPrivateHosts,
      });
    }
  } catch (err) {
    alert((err as Error).message);
    return;
  }

  if (!privacyAcknowledged) {
    alert('请先勾选「我已理解并同意隐私告知」');
    return;
  }

  if (!apiKey) {
    const status = lastStatus ?? (await chrome.runtime.sendMessage({ type: 'GET_STATUS' }));
    if (!status?.hasApiKey) {
      alert('请输入 API Key');
      return;
    }
  }

  if (enableFallback && !fallbackApiKey) {
    const status = lastStatus ?? (await chrome.runtime.sendMessage({ type: 'GET_STATUS' }));
    if (!status?.hasFallback) {
      alert('请输入备用 API Key');
      return;
    }
  }

  // 获取选中的风格
  const styles: string[] = [];
  document.querySelectorAll('.style-option.selected').forEach((option) => {
    const style = option.getAttribute('data-style');
    if (style) styles.push(style);
  });

  if (styles.length === 0) {
    alert('请至少选择一种回复风格');
    return;
  }

  const config = {
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
    privacyAcknowledged,
    persistApiKey,
    enableMemory,
    redactPii,
    anonymizeSenders,
    contextMessageLimit,
    maxCharsPerMessage,
    maxTotalChars,
    enableFallback,
    fallbackProvider,
    fallbackBaseUrl: enableFallback ? fallbackBaseUrl : undefined,
    fallbackAllowInsecureHttp,
    fallbackAllowPrivateHosts,
    fallbackModel,
    fallbackApiKey,
    suggestionCount,
  };

  // 通知 background（由 background 决定是否持久化 key）
  const response = await chrome.runtime.sendMessage({
    type: 'SET_CONFIG',
    config,
  });

  if (response?.error) {
    statusEl.className = 'status warning';
    statusEl.textContent = `⚠ ${response.error}`;
    return;
  }

  statusEl.className = 'status success';
  statusEl.textContent = '✓ 设置已保存';

  if (!persistApiKey) {
    apiKeyInput.value = '';
    fallbackApiKeyInput.value = '';
  }

  await checkStatus();
});

// 加载联系人列表
async function loadContacts() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONTACTS' });

    if (response?.contacts && response.contacts.length > 0) {
      const contactsWithPrefs = await Promise.all(
        response.contacts.map(async (contact: { displayName: string; app: string; messageCount: number; key: ContactKey; memorySummary?: string | null; memoryUpdatedAt?: number | null }) => {
          const prefRes = await chrome.runtime.sendMessage({
            type: 'GET_STYLE_PREFERENCE',
            contactKey: contact.key,
          });
          return { ...contact, preference: prefRes?.preference ?? null };
        })
      );

      contactListEl.innerHTML = contactsWithPrefs
        .map(
          (contact, index) => `
        <div class="contact-item">
          <div class="contact-header">
            <div class="contact-avatar">${escapeHtml(contact.displayName.charAt(0).toUpperCase())}</div>
            <div class="contact-info">
              <div class="contact-name">${escapeHtml(contact.displayName)}</div>
            <div class="contact-meta">${escapeHtml(contact.app)} · ${escapeHtml(String(contact.messageCount))} 条消息</div>
            </div>
            <div class="contact-actions">
              <button class="reset-pref-btn" data-index="${index}">重置偏好</button>
              <button class="clear-memory-btn" data-index="${index}">清空记忆</button>
              <button class="clear-contact-btn" data-index="${index}">清除数据</button>
            </div>
          </div>
          <div class="style-stats">
            ${renderStyleStats(contact.preference)}
          </div>
          <div class="memory-box">
            <div class="memory-title">长期记忆${contact.memoryUpdatedAt ? ` <span class="muted">(${escapeHtml(new Date(contact.memoryUpdatedAt).toISOString().slice(0, 10))})</span>` : ''}</div>
            <div class="memory-text">${contact.memorySummary ? escapeHtml(contact.memorySummary) : '<span class="muted">暂无长期记忆</span>'}</div>
          </div>
        </div>
      `
        )
        .join('');

      contactListEl.querySelectorAll<HTMLButtonElement>('.reset-pref-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const index = Number(btn.getAttribute('data-index') || '-1');
          const target = contactsWithPrefs[index];
          if (target && confirm(`重置 ${target.displayName} 的风格偏好？`)) {
            await chrome.runtime.sendMessage({
              type: 'RESET_STYLE_PREFERENCE',
              contactKey: target.key,
            });
            await loadContacts();
          }
        });
      });

      contactListEl.querySelectorAll<HTMLButtonElement>('.clear-memory-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const index = Number(btn.getAttribute('data-index') || '-1');
          const target = contactsWithPrefs[index];
          if (target && confirm(`清空 ${target.displayName} 的长期记忆？`)) {
            await chrome.runtime.sendMessage({
              type: 'CLEAR_CONTACT_MEMORY',
              contactKey: target.key,
            });
            await loadContacts();
          }
        });
      });

      contactListEl.querySelectorAll<HTMLButtonElement>('.clear-contact-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const index = Number(btn.getAttribute('data-index') || '-1');
          const target = contactsWithPrefs[index];
          if (target && confirm(`清除 ${target.displayName} 的全部本地数据（消息/画像/偏好/记忆）？`)) {
            await chrome.runtime.sendMessage({
              type: 'CLEAR_CONTACT_DATA',
              contactKey: target.key,
            });
            await loadContacts();
          }
        });
      });
    } else {
      contactListEl.innerHTML = '<div class="empty-state">暂无联系人记录</div>';
    }
  } catch (error) {
    contactListEl.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

function downloadJson(filename: string, json: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 备份导出
exportUserDataBtn.addEventListener('click', async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'EXPORT_USER_DATA' });
    const backup = res?.backup;
    if (!backup) {
      throw new Error(res?.error || '导出失败');
    }

    const json = JSON.stringify(backup, null, 2);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`social-copilot-backup-${ts}.json`, json);
    statusEl.className = 'status info';
    statusEl.textContent = 'ℹ️ 已导出数据备份 JSON（不包含 API Key）';
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `⚠ 导出失败：${(err as Error).message}`;
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
    const res = await chrome.runtime.sendMessage({ type: 'IMPORT_USER_DATA', data });
    if (!res?.success) {
      statusEl.className = 'status warning';
      statusEl.textContent = `⚠ 导入失败：${res?.error || '未知错误'}`;
      return;
    }
    const imported = res?.imported as Record<string, number> | undefined;
    const summary = imported
      ? `profiles=${imported.profiles ?? 0}, prefs=${imported.stylePreferences ?? 0}, memories=${imported.contactMemories ?? 0}`
      : 'ok';
    statusEl.className = 'status info';
    statusEl.textContent = `ℹ️ 已导入数据备份（${summary}）`;
    await loadContacts();
    await checkStatus();
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `⚠ 导入失败：${(err as Error).message}`;
  }
});

// 清除数据
clearDataBtn.addEventListener('click', async () => {
  if (confirm('确定要清除所有数据吗？这将删除所有联系人记录和设置。')) {
    try {
      await chrome.storage.local.clear();
      const res = await chrome.runtime.sendMessage({ type: 'CLEAR_DATA' });
      if (res?.success === false) {
        statusEl.className = 'status warning';
        statusEl.textContent = `⚠ 清除未完全成功：${res.error ?? '未知错误'}（可尝试关闭所有聊天站点标签页后重试）`;
        return;
      }

      statusEl.className = 'status warning';
      statusEl.textContent = '⚠ 数据已清除，请重新设置';
      apiKeyInput.value = '';
      fallbackApiKeyInput.value = '';
      enableFallbackCheckbox.checked = false;
      toggleFallbackFields();
      loadContacts();
      await checkStatus();
    } catch (err) {
      statusEl.className = 'status warning';
      statusEl.textContent = `⚠ 清除失败：${(err as Error).message}`;
    }
  }
});

// 诊断与调试
async function loadDebugFlag() {
  try {
    const stored = await chrome.storage.local.get('debugEnabled');
    debugEnabledCheckbox.checked = Boolean(stored.debugEnabled);
  } catch {
    debugEnabledCheckbox.checked = false;
  }
}

debugEnabledCheckbox.addEventListener('change', async () => {
  try {
    const enabled = debugEnabledCheckbox.checked;
    await chrome.runtime.sendMessage({ type: 'SET_DEBUG_ENABLED', enabled });
    statusEl.className = 'status info';
    statusEl.textContent = enabled ? 'ℹ️ 已启用诊断日志' : 'ℹ️ 已关闭诊断日志';
    await checkStatus();
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `⚠ 设置诊断失败：${(err as Error).message}`;
  }
});

async function getDiagnosticsJson(): Promise<string> {
  const snapshot = await chrome.runtime.sendMessage({ type: 'GET_DIAGNOSTICS' });
  return JSON.stringify(snapshot, null, 2);
}

copyDiagnosticsBtn.addEventListener('click', async () => {
  try {
    const json = await getDiagnosticsJson();
    await navigator.clipboard.writeText(json);
    statusEl.className = 'status info';
    statusEl.textContent = 'ℹ️ 诊断信息已复制到剪贴板';
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `⚠ 复制失败：${(err as Error).message}`;
  }
});

downloadDiagnosticsBtn.addEventListener('click', async () => {
  try {
    const json = await getDiagnosticsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `social-copilot-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    statusEl.className = 'status info';
    statusEl.textContent = 'ℹ️ 已下载诊断 JSON';
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `⚠ 下载失败：${(err as Error).message}`;
  }
});

clearDiagnosticsBtn.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_DIAGNOSTICS' });
    statusEl.className = 'status info';
    statusEl.textContent = 'ℹ️ 已清空诊断日志';
  } catch (err) {
    statusEl.className = 'status warning';
    statusEl.textContent = `⚠ 清空失败：${(err as Error).message}`;
  }
});

// 初始化
checkStatus();
loadSettings();
loadDebugFlag();
