import { UserDataBackupSchema, formatZodError } from '@social-copilot/core';

export const MAX_IMPORT_BYTES = 1 * 1024 * 1024; // 1MB

export function validateImportFileSize(bytes: number, maxBytes: number = MAX_IMPORT_BYTES): void {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error('文件大小无效');
  }
  if (bytes > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    throw new Error(`文件过大：请导入不超过 ${mb}MB 的备份文件`);
  }
}

export function parseAndValidateUserDataBackup(text: string) {
  if (typeof text !== 'string') {
    throw new Error('备份内容必须是文本');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 解析失败：请确认文件内容是有效的 JSON');
  }

  const res = UserDataBackupSchema.safeParse(parsed);
  if (!res.success) {
    throw new Error(`备份文件格式验证失败：${formatZodError(res.error)}`);
  }

  // Zod strips unknown keys by default (unless .passthrough() is used).
  return res.data;
}

