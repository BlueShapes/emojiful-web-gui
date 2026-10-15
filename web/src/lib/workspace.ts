import { emptyPack, validateDraft } from './pack';
import type { EmojiPack } from './pack';

export const WORKSPACE_STORAGE_KEY = 'emojiful.pack-studio.workspace.v1';
export const LEGACY_STORAGE_KEY = 'emojiful.pack-studio.v1';

export interface WorkspacePack {
  key: string;
  pack: EmojiPack;
}

export interface Workspace {
  schemaVersion: 1;
  activeKey: string;
  packs: WorkspacePack[];
  sidebarCollapsed: boolean;
}

const WORKSPACE_KEYS = [
  'schemaVersion',
  'activeKey',
  'packs',
  'sidebarCollapsed',
];
const PACK_KEYS = ['schemaVersion', 'id', 'name', 'description', 'emojis'];
const ENTRY_KEYS = ['name', 'url', 'category'];
const WORKSPACE_PACK_KEYS = ['key', 'pack'];
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid saved pack workspace.');
  return value as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function assertPackShape(value: unknown) {
  const pack = record(value);
  if (!hasExactKeys(pack, PACK_KEYS) || !Array.isArray(pack.emojis))
    throw new TypeError('Invalid saved pack draft.');
  for (const emoji of pack.emojis) {
    if (!hasExactKeys(record(emoji), ENTRY_KEYS))
      throw new TypeError('Invalid saved emoji entry.');
  }
}

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

export function createWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    activeKey: 'initial',
    packs: [{ key: 'initial', pack: emptyPack() }],
    sidebarCollapsed: false,
  };
}

export function validateWorkspace(value: unknown): Workspace {
  const input = record(value);
  if (
    !hasExactKeys(input, WORKSPACE_KEYS) ||
    input.schemaVersion !== 1 ||
    !Array.isArray(input.packs) ||
    input.packs.length === 0 ||
    typeof input.activeKey !== 'string' ||
    typeof input.sidebarCollapsed !== 'boolean'
  ) {
    throw new TypeError('Invalid saved pack workspace.');
  }

  const keys = new Set<string>();
  const packs = input.packs.map((value) => {
    const item = record(value);
    if (
      !hasExactKeys(item, WORKSPACE_PACK_KEYS) ||
      typeof item.key !== 'string' ||
      !KEY_PATTERN.test(item.key) ||
      keys.has(item.key)
    ) {
      throw new TypeError('Invalid or duplicate pack key.');
    }
    keys.add(item.key);
    assertPackShape(item.pack);
    return { key: item.key, pack: validateDraft(item.pack) };
  });

  if (!keys.has(input.activeKey))
    throw new TypeError('Active pack does not exist.');

  return {
    schemaVersion: 1,
    activeKey: input.activeKey,
    packs,
    sidebarCollapsed: input.sidebarCollapsed,
  };
}

export function loadWorkspace(storage: {
  getItem(key: string): string | null;
}): Workspace {
  const savedWorkspace = storage.getItem(WORKSPACE_STORAGE_KEY);
  if (savedWorkspace !== null)
    return validateWorkspace(JSON.parse(savedWorkspace) as unknown);

  const legacyDraft = storage.getItem(LEGACY_STORAGE_KEY);
  if (legacyDraft === null) return createWorkspace();

  const pack = validateDraft(JSON.parse(legacyDraft) as unknown);
  return {
    ...createWorkspace(),
    packs: [{ key: 'initial', pack }],
  };
}

export function getActivePack(workspace: Workspace): EmojiPack {
  return workspace.packs.find((item) => item.key === workspace.activeKey)!.pack;
}

export function updatePack(
  workspace: Workspace,
  key: string,
  pack: EmojiPack,
): Workspace {
  if (!workspace.packs.some((item) => item.key === key)) return workspace;
  const validated = validateDraft(pack);
  return {
    ...workspace,
    packs: workspace.packs.map((item) =>
      item.key === key ? { ...item, pack: validated } : item,
    ),
  };
}

export function selectPack(workspace: Workspace, key: string): Workspace {
  if (!workspace.packs.some((item) => item.key === key)) return workspace;
  return { ...workspace, activeKey: key };
}

export function addPack(
  workspace: Workspace,
  optionalImportedPack?: EmojiPack,
): Workspace {
  let pack: EmojiPack;
  if (optionalImportedPack) {
    pack = validateDraft(optionalImportedPack);
  } else {
    const usedIds = new Set(workspace.packs.map((item) => item.pack.id));
    let ordinal = 2;
    let id = `my_emojis_${ordinal}`;
    while (usedIds.has(id)) {
      ordinal += 1;
      id = `my_emojis_${ordinal}`;
    }
    pack = {
      ...emptyPack(),
      id,
      name: `My Emoji Pack ${ordinal}`,
    };
  }

  const key = newKey();
  return {
    ...workspace,
    activeKey: key,
    packs: [...workspace.packs, { key, pack }],
  };
}

export function removePack(workspace: Workspace, key: string): Workspace {
  const index = workspace.packs.findIndex((item) => item.key === key);
  if (index < 0 || workspace.packs.length === 1) return workspace;

  const packs = workspace.packs.filter((item) => item.key !== key);
  let activeKey = workspace.activeKey;
  if (activeKey === key)
    activeKey = packs[Math.min(index, packs.length - 1)].key;
  return { ...workspace, activeKey, packs };
}
