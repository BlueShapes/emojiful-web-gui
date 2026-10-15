import { describe, expect, it } from 'vitest';
import { emptyPack } from '../../web/src/lib/pack';
import {
  WORKSPACE_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  createWorkspace,
  loadWorkspace,
  validateWorkspace,
  getActivePack,
  updatePack,
  selectPack,
  addPack,
  removePack,
} from '../../web/src/lib/workspace';

describe('saved pack workspace', () => {
  it('starts with one pack and an expanded sidebar', () => {
    const workspace = loadWorkspace({ getItem: () => null });
    expect(workspace.packs).toHaveLength(1);
    expect(getActivePack(workspace)).toEqual(emptyPack());
    expect(workspace.sidebarCollapsed).toBe(false);
    expect(createWorkspace()).toEqual(workspace);
  });

  it('migrates the previous draft including unfinished metadata without modifying storage', () => {
    const legacy = {
      ...emptyPack(),
      id: '',
      name: '編集中',
      description: ' unfinished ',
      emojis: [
        { name: 'wave', url: 'https://example.com/wave.png', category: '反応' },
      ],
    };
    const values = new Map([[LEGACY_STORAGE_KEY, JSON.stringify(legacy)]]);
    const workspace = loadWorkspace({
      getItem: (key) => values.get(key) ?? null,
    });
    expect(getActivePack(workspace)).toEqual(legacy);
    expect(values.size).toBe(1);
    expect(values.has(WORKSPACE_STORAGE_KEY)).toBe(false);
  });

  it('restores all packs, the selected pack and sidebar setting before considering legacy data', () => {
    const workspace = { ...addPack(createWorkspace()), sidebarCollapsed: true };
    const values = new Map([
      [WORKSPACE_STORAGE_KEY, JSON.stringify(workspace)],
      [LEGACY_STORAGE_KEY, JSON.stringify(emptyPack())],
    ]);
    expect(
      loadWorkspace({ getItem: (key) => values.get(key) ?? null }),
    ).toEqual(workspace);
  });

  it('does not replace a damaged workspace with the old single-pack draft', () => {
    const values = new Map([
      [WORKSPACE_STORAGE_KEY, '{broken'],
      [LEGACY_STORAGE_KEY, JSON.stringify(emptyPack())],
    ]);
    expect(() =>
      loadWorkspace({ getItem: (key) => values.get(key) ?? null }),
    ).toThrow();
    expect(values.get(WORKSPACE_STORAGE_KEY)).toBe('{broken');
  });

  it.each([
    null,
    { ...createWorkspace(), schemaVersion: 2 },
    { ...createWorkspace(), packs: [] },
    { ...createWorkspace(), activeKey: 'missing' },
    { ...createWorkspace(), sidebarCollapsed: 'yes' },
    {
      ...createWorkspace(),
      packs: [createWorkspace().packs[0], createWorkspace().packs[0]],
    },
    {
      ...createWorkspace(),
      packs: [{ key: 'initial', pack: { ...emptyPack(), emojis: [{}] } }],
    },
  ])(
    'rejects invalid saved workspaces without silently dropping data (%#)',
    (value) => {
      expect(() => validateWorkspace(value)).toThrow();
    },
  );

  it('keeps drafts independent of editable pack IDs, including duplicate IDs', () => {
    const first = createWorkspace();
    const firstKey = first.activeKey;
    const second = addPack(first);
    const secondKey = second.activeKey;
    expect(getActivePack(second).id).toBe('my_emojis_2');
    const edited = updatePack(second, secondKey, {
      ...getActivePack(second),
      id: 'my_emojis',
      name: 'Second',
      emojis: [
        {
          name: 'cat',
          url: 'https://example.com/cat.png',
          category: 'Animals',
        },
      ],
    });
    expect(getActivePack(selectPack(edited, firstKey))).toEqual(emptyPack());
    expect(getActivePack(selectPack(edited, secondKey)).name).toBe('Second');
    expect(first.packs).toHaveLength(1);
    expect(getActivePack(second).name).not.toBe('Second');
  });

  it('imports matching pack IDs as separate drafts and keeps the current data', () => {
    const workspace = updatePack(createWorkspace(), 'initial', {
      ...emptyPack(),
      name: 'Original',
    });
    const imported = addPack(workspace, { ...emptyPack(), name: 'Imported' });
    expect(imported.packs).toHaveLength(2);
    expect(new Set(imported.packs.map((item) => item.key)).size).toBe(2);
    expect(getActivePack(imported).name).toBe('Imported');
    expect(getActivePack(selectPack(imported, workspace.activeKey)).name).toBe(
      'Original',
    );
  });

  it('selects a remaining pack on deletion and retains at least one draft', () => {
    const first = createWorkspace();
    const second = addPack(first);
    const third = addPack(second);
    const removedInactive = removePack(third, first.activeKey);
    expect(removedInactive.activeKey).toBe(third.activeKey);
    const removedActive = removePack(removedInactive, third.activeKey);
    expect(removedActive.packs).toHaveLength(1);
    expect(removedActive.activeKey).toBe(second.activeKey);
    expect(removePack(removedActive, second.activeKey)).toEqual(removedActive);
  });

  it('does not apply a delayed update to a different pack after a switch', () => {
    const first = createWorkspace();
    const second = addPack(first);
    const updated = updatePack(second, first.activeKey, {
      ...emptyPack(),
      name: 'First updated',
    });
    expect(updated.activeKey).toBe(second.activeKey);
    expect(getActivePack(updated)).toEqual(getActivePack(second));
    expect(getActivePack(selectPack(updated, first.activeKey)).name).toBe(
      'First updated',
    );
  });
});
