import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./webext', () => ({
  storageLocalGet: vi.fn(),
  storageLocalSet: vi.fn(),
  addStorageOnChangedListener: vi.fn(),
}));

import { storageLocalGet, storageLocalSet } from './webext';
import { fetchRemoteSelectors, getMergedSelectors } from './remote-config';

const mockedStorageLocalGet = vi.mocked(storageLocalGet);
const mockedStorageLocalSet = vi.mocked(storageLocalSet);

function mockFetchOnce(response: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => response));
}

describe('remote-config', () => {
  beforeEach(() => {
    mockedStorageLocalGet.mockReset();
    mockedStorageLocalSet.mockReset();
    vi.unstubAllGlobals();
  });

  it('returns null when remoteSelectorsUrl is missing', async () => {
    mockedStorageLocalGet.mockImplementation(async (key) => {
      if (key === 'remoteSelectorsUrl') return {};
      return {};
    });

    mockFetchOnce(new Response('{}', { status: 200 }));
    await expect(fetchRemoteSelectors()).resolves.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns null when remoteSelectorsUrl is invalid', async () => {
    mockedStorageLocalGet.mockImplementation(async (key) => {
      if (key === 'remoteSelectorsUrl') return { remoteSelectorsUrl: 'https://example.com/x.json' };
      return {};
    });

    mockFetchOnce(new Response('{}', { status: 200 }));
    await expect(fetchRemoteSelectors()).resolves.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid selectors url patterns', async () => {
    const invalidUrls = [
      'https://raw.githubusercontent.com/owner/repo/main/other.json',
      'https://raw.githubusercontent.com/owner/repo/main/nested/selectors.json',
      'https://raw.githubusercontent.com/owner/repo/feature/branch/selectors.json',
      'https://raw.githubusercontent.com/owner/repo/feature%2Fbranch/selectors.json',
    ];

    for (const url of invalidUrls) {
      mockedStorageLocalGet.mockImplementation(async (key) => {
        if (key === 'remoteSelectorsUrl') return { remoteSelectorsUrl: url };
        return {};
      });

      mockFetchOnce(new Response('{}', { status: 200 }));
      await expect(fetchRemoteSelectors()).resolves.toBeNull();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      mockedStorageLocalGet.mockReset();
    }
  });

  it('fetches, validates and caches selector config', async () => {
    const url = 'https://raw.githubusercontent.com/tytsxai/social-copilot/dev/selectors.json';
    mockedStorageLocalGet.mockImplementation(async (key) => {
      if (key === 'remoteSelectorsUrl') return { remoteSelectorsUrl: url };
      if (key === 'remote_selector_config') return {};
      return {};
    });

    mockFetchOnce(
      new Response(
        JSON.stringify({
          version: 1,
          platforms: {
            whatsapp: { legacy: { inputBox: '#main footer [contenteditable="true"]' } },
          },
        }),
        { status: 200 }
      )
    );

    const out = await fetchRemoteSelectors();
    expect(out?.version).toBe(1);
    expect(out?.platforms.whatsapp?.legacy?.inputBox).toContain('contenteditable');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(mockedStorageLocalSet).toHaveBeenCalledTimes(2);
  });

  it('accepts non-main branch refs', async () => {
    const url = 'https://raw.githubusercontent.com/owner/repo/release/selectors.json';
    mockedStorageLocalGet.mockImplementation(async (key) => {
      if (key === 'remoteSelectorsUrl') return { remoteSelectorsUrl: url };
      if (key === 'remote_selector_config') return {};
      return {};
    });

    mockFetchOnce(
      new Response(
        JSON.stringify({
          version: 2,
          platforms: {
            slack: { inputBox: '.composer' },
          },
        }),
        { status: 200 }
      )
    );

    const out = await fetchRemoteSelectors();
    expect(out?.version).toBe(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('enforces remote config size limits', async () => {
    const url = 'https://raw.githubusercontent.com/tytsxai/social-copilot/main/selectors.json';
    mockedStorageLocalGet.mockImplementation(async (key) => {
      if (key === 'remoteSelectorsUrl') return { remoteSelectorsUrl: url };
      if (key === 'remote_selector_config') return {};
      return {};
    });

    mockFetchOnce(
      new Response('{}'.padEnd(100_001, 'x'), {
        status: 200,
      })
    );

    await expect(fetchRemoteSelectors()).resolves.toBeNull();
  });

  it('sanitizes selector key/value pairs', async () => {
    const url = 'https://raw.githubusercontent.com/tytsxai/social-copilot/main/selectors.json';
    mockedStorageLocalGet.mockImplementation(async (key) => {
      if (key === 'remoteSelectorsUrl') return { remoteSelectorsUrl: url };
      if (key === 'remote_selector_config') return {};
      return {};
    });

    mockFetchOnce(
      new Response(
        JSON.stringify({
          version: 1,
          platforms: {
            telegram: {
              ok_key: ' .bubbles-inner ',
              'bad key': '#x',
              toolong: 'x'.repeat(401),
              empty: '   ',
              newline: 'a\n#b',
            },
          },
        }),
        { status: 200 }
      )
    );

    const out = await fetchRemoteSelectors();
    expect(out?.platforms.telegram).toEqual({ ok_key: '.bubbles-inner' });
  });

  it('merges remote selectors over defaults (whatsapp variants)', async () => {
    const url = 'https://raw.githubusercontent.com/tytsxai/social-copilot/main/selectors.json';
    mockedStorageLocalGet.mockImplementation(async (key) => {
      if (key === 'remoteSelectorsUrl') return { remoteSelectorsUrl: url };
      if (key === 'remote_selector_config') return {};
      return {};
    });

    mockFetchOnce(
      new Response(
        JSON.stringify({
          version: 1,
          platforms: {
            whatsapp: { legacy: { inputBox: '#remote' } },
          },
        }),
        { status: 200 }
      )
    );

    const merged = await getMergedSelectors('whatsapp', 'legacy', { inputBox: '#default', other: '#keep' });
    expect(merged).toEqual({ inputBox: '#remote', other: '#keep' });
  });
});
