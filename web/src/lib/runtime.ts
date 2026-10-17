import { validateRegistrationPack } from './pack';
import type { EmojiPack } from './pack';
import { LocalizedError } from '../i18n';
import type { MessageKey } from '../i18n';

export type Runtime =
  | { mode: 'static' }
  | {
      mode: 'mod';
      token: string;
      gameVersion: string;
      loader: string;
      port: number;
    };
export interface InstalledPack {
  id: string;
  name: string;
  emojiCount: number;
  filename: string;
}

export async function detectRuntime(): Promise<Runtime> {
  try {
    const response = await fetch('/__emojiful__/session.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { mode: 'static' };
    const value = await response.json();
    if (
      value.mode === 'mod' &&
      typeof value.token === 'string' &&
      value.token.length >= 32
    )
      return value;
  } catch {
    /* Static hosting needs no backend. */
  }
  return { mode: 'static' };
}

async function api<T>(
  runtime: Runtime,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (runtime.mode !== 'mod') throw new LocalizedError('error.directInstall');
  let response: Response;
  let data: T;
  try {
    response = await fetch(`/api/packs${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-EWG-Token': runtime.token,
        ...init.headers,
      },
      signal: AbortSignal.timeout(15000),
    });
    data = await response.json();
  } catch {
    throw new LocalizedError('error.network');
  }
  if (!response.ok) {
    const errors: Record<number, MessageKey> = {
      400: 'error.request',
      401: 'error.session',
      403: 'error.session',
      404: 'error.notFound',
      409: 'error.conflict',
      413: 'error.request',
    };
    throw new LocalizedError(errors[response.status] ?? 'error.server');
  }
  return data;
}
export const listInstalled = (runtime: Runtime) =>
  api<{ packs: InstalledPack[] }>(runtime, '');
export const loadInstalled = (runtime: Runtime, id: string) =>
  api<EmojiPack>(runtime, `/${encodeURIComponent(id)}`);
export const installPack = async (
  runtime: Runtime,
  pack: EmojiPack,
  overwrite: boolean,
) => {
  const validPack = validateRegistrationPack(pack);
  return api<{ filename: string; message: string }>(runtime, '', {
    method: 'POST',
    body: JSON.stringify({ pack: validPack, overwrite }),
  });
};
