import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_BYTES, parseAndValidateUserDataBackup, validateImportFileSize } from './importUserData';

function buildValidBackup(overrides?: Partial<Record<string, unknown>>) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    extensionVersion: '0.0.0-test',
    data: {
      profiles: [],
      stylePreferences: [],
      contactMemories: [],
      profileUpdateCounts: {},
      memoryUpdateCounts: {},
    },
    ...overrides,
  };
}

describe('import user data validation', () => {
  it('rejects oversized files', () => {
    expect(() => validateImportFileSize(MAX_IMPORT_BYTES + 1)).toThrow(/文件过大/);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseAndValidateUserDataBackup('{oops')).toThrow(/JSON 解析失败/);
  });

  it('rejects invalid schema', () => {
    const invalid = buildValidBackup({ schemaVersion: 2 });
    expect(() => parseAndValidateUserDataBackup(JSON.stringify(invalid))).toThrow(/格式验证失败/);
  });

  it('strips unknown fields and returns validated data', () => {
    const input = buildValidBackup({
      unexpectedRoot: 'x',
      data: {
        profiles: [],
        stylePreferences: [],
        contactMemories: [],
        profileUpdateCounts: {},
        memoryUpdateCounts: {},
        extra: 123,
      },
    });
    const out = parseAndValidateUserDataBackup(JSON.stringify(input));
    expect((out as any).unexpectedRoot).toBeUndefined();
    expect((out as any).data.extra).toBeUndefined();
    expect(out.schemaVersion).toBe(1);
  });
});

