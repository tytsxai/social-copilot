import type { ContactKey } from '@social-copilot/core';
import { renderStyleStats } from './preferences';

// DOM 元素
const statusEl = document.getElementById('status')!;
const providerSelect = document.getElementById('provider') as HTMLSelectElement;
const modelInput = document.getElementById('model') as HTMLInputElement;
const modelHint = document.getElementById('modelHint')!;
const modelSuggestions = document.getElementById('modelSuggestions') as HTMLDataListElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const apiKeyHint = document.getElementById('apiKeyHint')!;
const persistApiKeyCheckbox = document.getElementById('persistApiKey') as HTMLInputElement;
const enableMemoryCheckbox = document.getElementById('enableMemory') as HTMLInputElement;
const enableFallbackCheckbox = document.getElementById('enableFallback') as HTMLInputElement;
const fallbackFields = document.getElementById('fallbackFields')!;
const fallbackProviderSelect = document.getElementById('fallbackProvider') as HTMLSelectElement;
const fallbackModelInput = document.getElementById('fallbackModel') as HTMLInputElement;
const fallbackModelHint = document.getElementById('fallbackModelHint')!;
const fallbackModelSuggestions = document.getElementById('fallbackModelSuggestions') as HTMLDataListElement;
const fallbackApiKeyInput = document.getElementById('fallbackApiKey') as HTMLInputElement;
const fallbackApiKeyHint = document.getElementById('fallbackApiKeyHint')!;
const suggestionCountSelect = document.getElementById('suggestionCount') as HTMLSelectElement;
const saveBtn = document.getElementById('saveBtn')!;
const contactListEl = document.getElementById('contactList')!;
const clearDataBtn = document.getElementById('clearDataBtn')!;
const debugEnabledCheckbox = document.getElementById('debugEnabled') as HTMLInputElement;
const copyDiagnosticsBtn = document.getElementById('copyDiagnosticsBtn')!;
const downloadDiagnosticsBtn = document.getElementById('downloadDiagnosticsBtn')!;
const clearDiagnosticsBtn = document.getElementById('clearDiagnosticsBtn')!;

let lastStatus: { hasApiKey?: boolean; hasFallback?: boolean; activeProvider?: string; activeModel?: string; debugEnabled?: boolean } | null = null;

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
  updateModelUi(providerSelect.value, modelInput, modelHint, modelSuggestions);
});

fallbackProviderSelect.addEventListener('change', () => {
  updateApiKeyHint(fallbackProviderSelect.value, fallbackApiKeyHint);
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
  )}" target="_blank">查看模型列表</a>`;
}

function updateApiKeyHint(provider: string, hintEl: HTMLElement) {
  if (provider === 'openai') {
    hintEl.innerHTML = '<a href="https://platform.openai.com/api-keys" target="_blank">获取 OpenAI API Key</a>';
  } else if (provider === 'claude') {
    hintEl.innerHTML = '<a href="https://console.anthropic.com/" target="_blank">获取 Claude API Key</a>';
  } else {
    hintEl.innerHTML = '<a href="https://platform.deepseek.com/" target="_blank">获取 DeepSeek API Key</a>';
  }
}

function toggleFallbackFields() {
  fallbackFields.classList.toggle('hidden', !enableFallbackCheckbox.checked);
}

// 检查状态
async function checkStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    lastStatus = response ?? null;

    if (response?.hasApiKey) {
      statusEl.className = 'status success';
      const providerText = response.activeProvider ? `当前提供商：${response.activeProvider}` : '已配置，准备就绪';
      const modelText = response.activeModel ? ` / ${response.activeModel}` : '';
      const fallbackText = response.hasFallback ? '，已启用备用模型' : '';
      statusEl.textContent = `✓ ${providerText}${modelText}${fallbackText}`;
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
    'model',
    'styles',
    'fallbackProvider',
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

  if (typeof result.model === 'string') {
    modelInput.value = result.model;
  }

  providerSelect.dispatchEvent(new Event('change'));

  if (result.fallbackProvider) {
    fallbackProviderSelect.value = result.fallbackProvider;
  }

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
  const model = modelInput.value.trim();
  const persistApiKey = persistApiKeyCheckbox.checked;
  const enableMemory = enableMemoryCheckbox.checked;
  const enableFallback = enableFallbackCheckbox.checked;
  const fallbackProvider = fallbackProviderSelect.value;
  const fallbackModel = fallbackModelInput.value.trim();
  const fallbackApiKey = fallbackApiKeyInput.value.trim();
  const suggestionCount = Number(suggestionCountSelect.value);

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
    model,
    styles,
    persistApiKey,
    enableMemory,
    enableFallback,
    fallbackProvider,
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
              <div class="contact-meta">${contact.app} · ${contact.messageCount} 条消息</div>
            </div>
            <div class="contact-actions">
              <button class="reset-btn" data-index="${index}">重置偏好</button>
              <button class="reset-btn clear-memory-btn" data-index="${index}">清空记忆</button>
            </div>
          </div>
          <div class="style-stats">
            ${renderStyleStats(contact.preference)}
          </div>
          <div class="memory-box">
            <div class="memory-title">长期记忆${contact.memoryUpdatedAt ? ` <span class="muted">(${new Date(contact.memoryUpdatedAt).toISOString().slice(0, 10)})</span>` : ''}</div>
            <div class="memory-text">${contact.memorySummary ? escapeHtml(contact.memorySummary) : '<span class="muted">暂无长期记忆</span>'}</div>
          </div>
        </div>
      `
        )
        .join('');

      contactListEl.querySelectorAll<HTMLButtonElement>('.reset-btn').forEach((btn) => {
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
    } else {
      contactListEl.innerHTML = '<div class="empty-state">暂无联系人记录</div>';
    }
  } catch (error) {
    contactListEl.innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

// 清除数据
clearDataBtn.addEventListener('click', async () => {
  if (confirm('确定要清除所有数据吗？这将删除所有联系人记录和设置。')) {
    await chrome.storage.local.clear();
    await chrome.runtime.sendMessage({ type: 'CLEAR_DATA' });

    statusEl.className = 'status warning';
    statusEl.textContent = '⚠ 数据已清除，请重新设置';
    apiKeyInput.value = '';
    fallbackApiKeyInput.value = '';
    enableFallbackCheckbox.checked = false;
    toggleFallbackFields();
    loadContacts();
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

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 初始化
checkStatus();
loadSettings();
loadDebugFlag();
