import type { ContactKey } from '@social-copilot/core';
import { renderStyleStats } from './preferences';

// DOM 元素
const statusEl = document.getElementById('status')!;
const providerSelect = document.getElementById('provider') as HTMLSelectElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const apiKeyHint = document.getElementById('apiKeyHint')!;
const enableFallbackCheckbox = document.getElementById('enableFallback') as HTMLInputElement;
const fallbackFields = document.getElementById('fallbackFields')!;
const fallbackProviderSelect = document.getElementById('fallbackProvider') as HTMLSelectElement;
const fallbackApiKeyInput = document.getElementById('fallbackApiKey') as HTMLInputElement;
const fallbackApiKeyHint = document.getElementById('fallbackApiKeyHint')!;
const saveBtn = document.getElementById('saveBtn')!;
const contactListEl = document.getElementById('contactList')!;
const clearDataBtn = document.getElementById('clearDataBtn')!;

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
});

fallbackProviderSelect.addEventListener('change', () => {
  updateApiKeyHint(fallbackProviderSelect.value, fallbackApiKeyHint);
});

enableFallbackCheckbox.addEventListener('change', () => {
  toggleFallbackFields();
});

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

    if (response?.hasApiKey) {
      statusEl.className = 'status success';
      const providerText = response.activeProvider ? `当前模型：${response.activeProvider}` : '已配置，准备就绪';
      const fallbackText = response.hasFallback ? '，已启用备用模型' : '';
      statusEl.textContent = `✓ ${providerText}${fallbackText}`;
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
    'styles',
    'fallbackProvider',
    'fallbackApiKey',
    'enableFallback',
  ]);

  if (result.apiKey) {
    apiKeyInput.value = result.apiKey;
  }

  if (result.provider) {
    providerSelect.value = result.provider;
    providerSelect.dispatchEvent(new Event('change'));
  }

  if (result.fallbackProvider) {
    fallbackProviderSelect.value = result.fallbackProvider;
  }

  if (result.fallbackApiKey) {
    fallbackApiKeyInput.value = result.fallbackApiKey;
  }

  enableFallbackCheckbox.checked = Boolean(result.enableFallback);
  toggleFallbackFields();
  fallbackProviderSelect.dispatchEvent(new Event('change'));

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
  const enableFallback = enableFallbackCheckbox.checked;
  const fallbackProvider = fallbackProviderSelect.value;
  const fallbackApiKey = fallbackApiKeyInput.value.trim();

  if (!apiKey) {
    alert('请输入 API Key');
    return;
  }

  if (enableFallback && !fallbackApiKey) {
    alert('请输入备用 API Key');
    return;
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
    styles,
    enableFallback,
    fallbackProvider,
    fallbackApiKey,
  };

  // 保存到 storage
  await chrome.storage.local.set(config);

  // 通知 background
  await chrome.runtime.sendMessage({
    type: 'SET_CONFIG',
    config,
  });

  statusEl.className = 'status success';
  statusEl.textContent = '✓ 设置已保存';
});

// 加载联系人列表
async function loadContacts() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONTACTS' });

    if (response?.contacts && response.contacts.length > 0) {
      const contactsWithPrefs = await Promise.all(
        response.contacts.map(async (contact: { displayName: string; app: string; messageCount: number; key: ContactKey }) => {
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
            </div>
          </div>
          <div class="style-stats">
            ${renderStyleStats(contact.preference)}
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

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 初始化
checkStatus();
loadSettings();
