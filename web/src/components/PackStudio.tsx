import { useEffect, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  FileArchive,
  FolderOpen,
  Image,
  Layers3,
  Monitor,
  Pencil,
  Plus,
  Search,
  Sparkle,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  appendEntries,
  emptyPack,
  errorMessage,
  exportPack,
  importBulk,
  MAX_IMPORT_BYTES,
  normalizeName,
  readPackFile,
  validateDraft,
  validateEmoji,
  validatePack,
} from '../lib/pack';
import type { BulkFormat, EmojiEntry, EmojiPack } from '../lib/pack';
import { importBulkTable } from '../lib/bulk-table';
import BulkTable, { createBulkTableRows } from './BulkTable';
import NameWarningSettings from './NameWarningSettings';
import NameReplacement from './NameReplacement';
import {
  DEFAULT_NAME_WARNING_LENGTH,
  getNameLengthWarning,
} from '../lib/name-tools';
import NextcloudInput, { emptyNextcloudDraft } from './NextcloudInput';
import LegacyConversion from './LegacyConversion';
import { importNextcloudListing, parseNextcloudFolder } from '../lib/nextcloud';
import {
  addPack,
  createWorkspace,
  getActivePack,
  loadWorkspace,
  removePack,
  selectPack,
  updatePack,
  WORKSPACE_STORAGE_KEY,
} from '../lib/workspace';
import type { Workspace } from '../lib/workspace';
import {
  readDirectoryFiles,
  readDirectoryPack,
  saveDirectoryPack,
} from '../lib/folder';
import type { DirectoryHandle, DirectorySource } from '../lib/folder';
import {
  deleteFolderBinding,
  loadFolderBindings,
  putFolderBinding,
} from '../lib/folder-bindings';
import {
  detectRuntime,
  installPack,
  listInstalled,
  loadInstalled,
} from '../lib/runtime';
import type { InstalledPack, Runtime } from '../lib/runtime';
import { locales, localePath, translate, LocalizedError } from '../i18n';
import type { Locale, MessageKey, MessageArgs } from '../i18n';

const blankEntry = (): EmojiEntry => ({
  name: '',
  url: '',
  category: 'Custom',
});
type Panel = 'single' | 'bulk' | 'installed' | 'legacy' | 'replace' | null;
type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options: {
    id: string;
    mode: 'read';
  }) => Promise<DirectoryHandle>;
};

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function download(bytes: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EmojiPreview({
  emoji,
  locale,
}: {
  emoji: EmojiEntry;
  locale: Locale;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [emoji.url]);
  return (
    <span className={`emoji-preview ${failed ? 'failed' : ''}`}>
      {failed ? (
        <Image size={23} aria-label={translate(locale, 'previewFailed')} />
      ) : (
        <img
          src={emoji.url}
          alt={emoji.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export default function PackStudio({ locale = 'en' }: { locale?: Locale }) {
  const t = (key: MessageKey, args?: MessageArgs) =>
    translate(locale, key, args);
  const [workspace, setWorkspace] = useState<Workspace>(createWorkspace);
  const [runtime, setRuntime] = useState<Runtime>({ mode: 'static' });
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [nameWarningLength, setNameWarningLength] = useState(
    DEFAULT_NAME_WARNING_LENGTH,
  );
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [category, setCategory] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [entry, setEntry] = useState<EmojiEntry>(blankEntry);
  const [bulk, setBulk] = useState('');
  const [bulkCategory, setBulkCategory] = useState('Custom');
  const [bulkFormat, setBulkFormat] = useState<BulkFormat>('auto');
  const [bulkMode, setBulkMode] = useState<'text' | 'table' | 'nextcloud'>(
    'text',
  );
  const [bulkRows, setBulkRows] = useState(createBulkTableRows);
  const [bulkUrlPrefix, setBulkUrlPrefix] = useState('');
  const [nextcloudDraft, setNextcloudDraft] = useState(emptyNextcloudDraft);
  const [panelError, setPanelError] = useState('');
  const [installed, setInstalled] = useState<InstalledPack[]>([]);
  const [busy, setBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderWriting, setFolderWriting] = useState(false);
  const [folderSources, setFolderSources] = useState<
    Record<string, DirectorySource>
  >({});
  const [readOnlyFolderSources, setReadOnlyFolderSources] = useState<
    Record<string, { name: string; savedPack: EmojiPack }>
  >({});
  const [sessionOnlyFolders, setSessionOnlyFolders] = useState<
    Record<string, boolean>
  >({});
  const [overwrite, setOverwrite] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    message: string;
    action: () => void;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const folderSourcesRef = useRef(folderSources);
  folderSourcesRef.current = folderSources;
  const folderOperationRef = useRef(false);
  const folderWritingRef = useRef(false);
  const folderBindingVersionsRef = useRef<Record<string, number>>({});
  const deletedDraftKeysRef = useRef(new Set<string>());
  const pendingFolderDraftKeysRef = useRef(new Set<string>());
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const modalRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const pack = getActivePack(workspace);
  const activeFolderSource = folderSources[workspace.activeKey];
  const activeReadOnlyFolder = readOnlyFolderSources[workspace.activeKey];
  const folderDirty = activeFolderSource
    ? JSON.stringify(pack) !== JSON.stringify(activeFolderSource.savedPack)
    : activeReadOnlyFolder
      ? JSON.stringify(pack) !== JSON.stringify(activeReadOnlyFolder.savedPack)
      : false;
  const categories = [
    ...new Set(pack.emojis.map((emoji) => emoji.category)),
  ].sort((a, b) =>
    a.localeCompare(b, locales.find((item) => item.code === locale)?.htmlLang),
  );
  const visible = pack.emojis.filter(
    (emoji) =>
      (!category || emoji.category === category) &&
      (!attentionOnly || getNameLengthWarning(emoji.name, nameWarningLength)) &&
      `${emoji.name} ${emoji.url} ${emoji.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const longNameCount = pack.emojis.filter((emoji) =>
    getNameLengthWarning(emoji.name, nameWarningLength),
  ).length;
  const entryNameWarning = getNameLengthWarning(entry.name, nameWarningLength);

  useEffect(() => {
    try {
      const value = Number(
        localStorage.getItem('emojiful.pack-studio.name-warning-length'),
      );
      if (Number.isInteger(value) && value >= 1 && value <= 64)
        setNameWarningLength(value);
    } catch {
      /* Preferences remain usable when browser storage is unavailable. */
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        'emojiful.pack-studio.name-warning-length',
        String(nameWarningLength),
      );
    } catch {
      /* Optional preference. */
    }
  }, [nameWarningLength, ready]);

  useEffect(() => {
    try {
      const restored = loadWorkspace(localStorage);
      workspaceRef.current = restored;
      setWorkspace(restored);
    } catch {
      setRestoreFailed(true);
      setStorageFailed(true);
      setNotice({
        message: t('storage.restoreFailed'),
        error: true,
      });
    }
    setReady(true);
    void detectRuntime().then(setRuntime);
  }, []);
  useEffect(() => {
    if (folderInput.current) folderInput.current.webkitdirectory = true;
  }, []);
  useEffect(() => {
    let current = true;
    const versionsAtStart = { ...folderBindingVersionsRef.current };
    void loadFolderBindings()
      .then((bindings) => {
        if (!current) return;
        const drafts = new Set(
          workspaceRef.current.packs.map((item) => item.key),
        );
        const next = { ...folderSourcesRef.current };
        let changed = false;
        for (const [key, source] of Object.entries(bindings)) {
          if (
            !drafts.has(key) ||
            deletedDraftKeysRef.current.has(key) ||
            (folderBindingVersionsRef.current[key] ?? 0) !==
              (versionsAtStart[key] ?? 0)
          )
            continue;
          next[key] = source;
          changed = true;
        }
        if (changed) {
          folderSourcesRef.current = next;
          setFolderSources(next);
        }
      })
      .catch(() => {
        // IndexedDB can be unavailable in private browsing or embedded views.
        // The current tab's folder handles remain usable in memory.
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || restoreFailed) return;
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [workspace, ready, restoreFailed]);
  useEffect(() => {
    if (panel && !modalRef.current?.open) modalRef.current?.showModal();
    if (!panel) modalRef.current?.close();
  }, [panel]);
  useEffect(() => {
    if (confirmation && !confirmRef.current?.open)
      confirmRef.current?.showModal();
    if (!confirmation) confirmRef.current?.close();
  }, [confirmation]);
  useEffect(() => {
    if (!folderWriting) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [folderWriting]);
  useEffect(() => {
    if (category && !categories.includes(category)) setCategory('');
  }, [pack.emojis, category]);

  function notify(message: string, error = false) {
    setNotice({ message, error });
  }
  function changeFolderSource(key: string, source?: DirectorySource) {
    const next = { ...folderSourcesRef.current };
    if (source) next[key] = source;
    else delete next[key];
    folderSourcesRef.current = next;
    setFolderSources(next);
  }
  function bumpFolderBindingVersion(key: string) {
    folderBindingVersionsRef.current[key] =
      (folderBindingVersionsRef.current[key] ?? 0) + 1;
  }
  function beginFolderOperation(write = false) {
    if (folderOperationRef.current) return false;
    folderOperationRef.current = true;
    setFolderBusy(true);
    if (write) {
      folderWritingRef.current = true;
      setFolderWriting(true);
    }
    return true;
  }
  function endFolderOperation() {
    folderOperationRef.current = false;
    folderWritingRef.current = false;
    setFolderBusy(false);
    setFolderWriting(false);
  }
  function addFolderDraft(imported: EmojiPack, key = crypto.randomUUID()) {
    pendingFolderDraftKeysRef.current.add(key);
    setWorkspace((current) => addPack(current, imported, key));
    resetPackView();
    return key;
  }
  async function persistFolderBinding(
    key: string,
    source: DirectorySource,
  ): Promise<boolean> {
    bumpFolderBindingVersion(key);
    let sessionOnly = false;
    try {
      await putFolderBinding(key, source);
      setSessionOnlyFolders((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch {
      if (
        !deletedDraftKeysRef.current.has(key) &&
        (pendingFolderDraftKeysRef.current.has(key) ||
          workspaceRef.current.packs.some((item) => item.key === key))
      ) {
        sessionOnly = true;
        setSessionOnlyFolders((current) => ({ ...current, [key]: true }));
      }
    }
    if (
      deletedDraftKeysRef.current.has(key) ||
      (!pendingFolderDraftKeysRef.current.has(key) &&
        !workspaceRef.current.packs.some((item) => item.key === key))
    ) {
      try {
        await deleteFolderBinding(key);
      } catch {
        // Orphaned records are filtered against workspace drafts on restore.
      }
    }
    pendingFolderDraftKeysRef.current.delete(key);
    return sessionOnly;
  }
  function forgetFolderDraft(key: string) {
    deletedDraftKeysRef.current.add(key);
    pendingFolderDraftKeysRef.current.delete(key);
    bumpFolderBindingVersion(key);
    changeFolderSource(key);
    setReadOnlyFolderSources((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSessionOnlyFolders((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    void deleteFolderBinding(key).catch(() => {
      // A stale binding cannot be reused because draft keys are unique.
    });
  }
  function changeLanguage(next: string) {
    if (folderOperationRef.current) return;
    if (restoreFailed) {
      notify(t('storage.failed'), true);
      return;
    }
    // Save synchronously before navigation, including every unfinished draft.
    try {
      localStorage.setItem(
        WORKSPACE_STORAGE_KEY,
        JSON.stringify(workspaceRef.current),
      );
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
      notify(t('storage.failed'), true);
      return;
    }
    window.location.assign(localePath(next));
  }
  function resetPackView() {
    setQuery('');
    setAttentionOnly(false);
    setCategory('');
    setOverwrite(false);
    setNotice(null);
    setPanel(null);
    setEditing(null);
    setEntry(blankEntry());
    setBulk('');
    setBulkCategory('Custom');
    setBulkFormat('auto');
    setBulkMode('text');
    setBulkRows(createBulkTableRows());
    setBulkUrlPrefix('');
    setNextcloudDraft(emptyNextcloudDraft());
    setPanelError('');
    setConfirmation(null);
  }
  function editActivePack(update: (current: EmojiPack) => EmojiPack) {
    // Capture the draft key from this render, so deferred updates stay attached
    // to the draft where editing began even if another draft becomes active.
    const key = workspace.activeKey;
    const draft = workspace.packs.find((item) => item.key === key);
    if (!draft) return;
    // Validate before scheduling React state so a size/schema error can be
    // handled by the calling form instead of escaping from a state updater.
    const next = validateDraft(update(draft.pack));
    setWorkspace((current) => {
      return updatePack(current, key, next);
    });
  }
  function editMetadata(update: (current: EmojiPack) => EmojiPack) {
    try {
      editActivePack(update);
    } catch (error) {
      notify(errorMessage(error, locale), true);
    }
  }
  function createPack() {
    setWorkspace((current) => addPack(current));
    resetPackView();
    notify(t('packs.created'));
  }
  function switchPack(key: string) {
    setWorkspace((current) => selectPack(current, key));
    resetPackView();
  }
  function openSingle(emoji?: EmojiEntry) {
    setEditing(emoji?.name ?? null);
    setEntry(emoji ?? { ...blankEntry(), category: category || 'Custom' });
    setPanelError('');
    setPanel('single');
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      const imported = await readPackFile(file);
      setWorkspace((current) => addPack(current, imported));
      resetPackView();
      notify(t('notice.loaded'));
    } catch (error) {
      notify(errorMessage(error, locale), true);
    }
    if (fileInput.current) fileInput.current.value = '';
  }
  function openFolderPicker() {
    if (folderOperationRef.current || folderWritingRef.current) return;
    const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
    if (typeof picker !== 'function') {
      folderInput.current?.click();
      return;
    }

    // Invoke the native picker directly from the button's click stack so the
    // browser keeps the required user activation.
    let selection: Promise<DirectoryHandle>;
    try {
      selection = picker.call(window, { id: 'emojiful-pack', mode: 'read' });
    } catch (error) {
      if (!isAbortError(error)) notify(errorMessage(error, locale), true);
      return;
    }
    if (!beginFolderOperation()) return;
    void (async () => {
      try {
        const handle = await selection;
        const { pack: imported, source } = await readDirectoryPack(handle);
        const key = addFolderDraft(imported);
        changeFolderSource(key, source);
        setReadOnlyFolderSources((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        const sessionOnly = await persistFolderBinding(key, source);
        if (!deletedDraftKeysRef.current.has(key))
          notify(
            sessionOnly
              ? `${t('notice.loaded')} ${t('folder.sessionOnly')}`
              : t('notice.loaded'),
          );
      } catch (error) {
        if (!isAbortError(error)) notify(errorMessage(error, locale), true);
      } finally {
        endFolderOperation();
      }
    })();
  }
  async function importFolderFiles(files?: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) {
      if (folderInput.current) folderInput.current.value = '';
      return;
    }
    if (!beginFolderOperation()) return;
    try {
      const imported = await readDirectoryFiles(selected);
      const key = addFolderDraft(imported);
      const firstPath = (selected[0] as File & { webkitRelativePath?: string })
        .webkitRelativePath;
      const name = firstPath?.split('/')[0] || t('folder.input');
      setReadOnlyFolderSources((current) => ({
        ...current,
        [key]: { name, savedPack: imported },
      }));
      notify(t('notice.loaded'));
    } catch (error) {
      notify(errorMessage(error, locale), true);
    } finally {
      if (folderInput.current) folderInput.current.value = '';
      endFolderOperation();
    }
  }
  async function saveActiveFolder() {
    if (folderOperationRef.current || folderWritingRef.current) return;
    const key = workspaceRef.current.activeKey;
    const source = folderSourcesRef.current[key];
    const draft = workspaceRef.current.packs.find((item) => item.key === key);
    if (!source || !draft) return;
    const snapshot: EmojiPack = {
      ...draft.pack,
      emojis: draft.pack.emojis.map((emoji) => ({ ...emoji })),
    };
    if (!beginFolderOperation(true)) return;
    try {
      const updated = await saveDirectoryPack(source, snapshot);
      if (
        deletedDraftKeysRef.current.has(key) ||
        !workspaceRef.current.packs.some((item) => item.key === key)
      ) {
        await deleteFolderBinding(key).catch(() => undefined);
        return;
      }
      changeFolderSource(key, updated);
      const sessionOnly = await persistFolderBinding(key, updated);
      if (!deletedDraftKeysRef.current.has(key))
        notify(
          sessionOnly
            ? `${t('folder.saved', { name: source.name })} ${t('folder.sessionOnly')}`
            : t('folder.saved', { name: source.name }),
        );
    } catch (error) {
      if (!deletedDraftKeysRef.current.has(key))
        notify(errorMessage(error, locale), true);
    } finally {
      endFolderOperation();
    }
  }
  function saveEntry(event: SubmitEvent) {
    event.preventDefault();
    try {
      const next = validateEmoji({ ...entry, name: normalizeName(entry.name) });
      if (
        pack.emojis.some(
          (emoji) => emoji.name === next.name && emoji.name !== editing,
        )
      )
        throw new LocalizedError('error.nameUsed', { name: next.name });
      const emojis = editing
        ? pack.emojis.map((emoji) => (emoji.name === editing ? next : emoji))
        : [...pack.emojis, next];
      // A draft can have unfinished metadata; entries are independently valid.
      editActivePack((current) => validateDraft({ ...current, emojis }));
      setPanel(null);
      notify(editing ? t('notice.updated') : t('notice.added'));
    } catch (error) {
      setPanelError(errorMessage(error, locale));
    }
  }
  function saveBulk(event: SubmitEvent) {
    event.preventDefault();
    try {
      if (bulkMode === 'nextcloud') {
        const folder = parseNextcloudFolder(
          nextcloudDraft.shareUrl,
          nextcloudDraft.folderPath,
        );
        const entries = importNextcloudListing(
          nextcloudDraft.listing,
          folder,
          bulkCategory,
        );
        setBulkRows(
          entries.map((emoji, index) => ({
            ...emoji,
            id: `nextcloud-${index}`,
          })),
        );
        setBulkUrlPrefix(folder.davUrl);
        setBulkMode('table');
        setPanelError('');
        return;
      }
      const entries =
        bulkMode === 'table'
          ? importBulkTable(bulkRows, bulkCategory)
          : importBulk(bulk, bulkCategory, bulkFormat);
      // Validate entries even while metadata is being edited.
      appendEntries({ ...emptyPack(), emojis: pack.emojis }, entries);
      editActivePack((current) =>
        validateDraft({ ...current, emojis: [...current.emojis, ...entries] }),
      );
      setPanel(null);
      if (bulkMode === 'table') {
        setBulkRows(createBulkTableRows());
        setBulkUrlPrefix('');
      } else setBulk('');
      notify(t('notice.bulkAdded', { count: entries.length }));
    } catch (error) {
      setPanelError(errorMessage(error, locale));
    }
  }
  function exportZip() {
    try {
      const bytes = exportPack(pack);
      download(
        bytes as Uint8Array<ArrayBuffer>,
        `${pack.id}.zip`,
        'application/zip',
      );
      notify(t('notice.exported'));
    } catch (error) {
      notify(errorMessage(error, locale), true);
    }
  }
  async function deploy() {
    setBusy(true);
    try {
      const result = await installPack(runtime, validatePack(pack), overwrite);
      notify(t('notice.deployed', { filename: result.filename }));
      setOverwrite(false);
    } catch (error) {
      notify(errorMessage(error, locale), true);
    } finally {
      setBusy(false);
    }
  }
  async function showInstalled() {
    setPanelError('');
    setPanel('installed');
    setBusy(true);
    try {
      setInstalled((await listInstalled(runtime)).packs);
    } catch (error) {
      setPanelError(errorMessage(error, locale));
    } finally {
      setBusy(false);
    }
  }
  async function openInstalled(id: string) {
    setBusy(true);
    try {
      const loaded = validatePack(await loadInstalled(runtime, id));
      setWorkspace((current) => addPack(current, loaded));
      resetPackView();
      notify(t('notice.loaded'));
    } catch (error) {
      setPanelError(errorMessage(error, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <a
          className="brand"
          href={localePath(locale)}
          aria-label={t('home')}
          dir="ltr"
          onClick={(event) => {
            if (folderOperationRef.current) {
              event.preventDefault();
              notify(t('busy'));
            }
          }}
        >
          <img
            className="brand-mark"
            src="/favicon.svg"
            width={42}
            height={42}
            alt=""
            aria-hidden="true"
          />
          <span>
            emojiful<span className="brand-sub">PACK STUDIO</span>
          </span>
        </a>
        <div className="topbar-right">
          <label className="language-picker">
            <span className="visually-hidden">{t('language')}</span>
            <select
              value={locale}
              disabled={!ready || folderBusy}
              onChange={(event) => changeLanguage(event.target.value)}
            >
              {locales.map((item) => (
                <option
                  key={item.code}
                  value={item.code}
                  lang={item.htmlLang}
                  dir={item.code === 'ar' ? 'rtl' : 'ltr'}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <span className="edition">
            <span className="status-dot" />
            {runtime.mode === 'mod' ? t('edition.local') : t('edition.web')}
          </span>
          <a
            className="source-link"
            href="https://github.com/InnovativeOnlineIndustries/Emojiful"
            target="_blank"
            rel="noreferrer"
          >
            Emojiful <ArrowUpRight size={15} />
          </a>
        </div>
      </header>
      <main
        className={`workspace ${workspace.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      >
        <div className="workspace-toolbar">
          <button
            className="icon-button sidebar-toggle"
            aria-controls="pack-sidebar"
            aria-expanded={!workspace.sidebarCollapsed}
            title={t(
              workspace.sidebarCollapsed ? 'sidebar.show' : 'sidebar.hide',
            )}
            aria-label={t(
              workspace.sidebarCollapsed ? 'sidebar.show' : 'sidebar.hide',
            )}
            onClick={() =>
              setWorkspace((current) => ({
                ...current,
                sidebarCollapsed: !current.sidebarCollapsed,
              }))
            }
          >
            {workspace.sidebarCollapsed ? (
              <ChevronRight size={19} />
            ) : (
              <ArrowLeft size={19} />
            )}
          </button>
          <label className="workspace-pack-picker">
            <span className="visually-hidden">{t('packs.switch')}</span>
            <select
              aria-label={t('packs.switch')}
              value={workspace.activeKey}
              disabled={!ready || folderBusy}
              onChange={(event) => switchPack(event.target.value)}
            >
              {workspace.packs.map((item, index) => (
                <option key={item.key} value={item.key}>
                  {`${item.pack.name || t('unnamed')} · ${item.pack.id || t('field.packId')} · ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary workspace-create"
            disabled={!ready || folderBusy}
            onClick={createPack}
          >
            <Plus size={17} />
            {t('newPack')}
          </button>
          <button
            className="button secondary workspace-delete"
            disabled={!ready || folderBusy || workspace.packs.length <= 1}
            onClick={() => {
              const key = workspace.activeKey;
              setConfirmation({
                message: t('packs.deleteConfirm', {
                  name: pack.name || t('unnamed'),
                }),
                action: () => {
                  forgetFolderDraft(key);
                  setWorkspace((current) => removePack(current, key));
                  resetPackView();
                  notify(t('packs.deleted'));
                },
              });
            }}
          >
            <Trash2 size={16} />
            {t('packs.delete')}
          </button>
          {storageFailed && (
            <span className="workspace-storage-alert" role="alert">
              {t('storage.failed')}
            </span>
          )}
        </div>
        <aside
          id="pack-sidebar"
          className="sidebar"
          aria-label={t('packs.details')}
          hidden={workspace.sidebarCollapsed}
        >
          <div className="sidebar-heading">
            <span className="eyebrow">{t('packs.details')}</span>
          </div>
          <div className="pack-identity">
            <span className="pack-icon">
              <FileArchive size={25} />
            </span>
            <div>
              <strong dir="auto">{pack.name || t('unnamed')}</strong>
              <small>
                {t('counts', {
                  emojis: pack.emojis.length,
                  categories: categories.length,
                })}
              </small>
            </div>
          </div>
          <div className="metadata">
            <label>
              {t('field.packName')}
              <input
                value={pack.name}
                dir="auto"
                maxLength={100}
                onChange={(event) =>
                  editMetadata((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              {t('field.packId')}
              <input
                aria-label={t('field.packId')}
                dir="ltr"
                value={pack.id}
                maxLength={64}
                spellCheck={false}
                onChange={(event) =>
                  editMetadata((current) => ({
                    ...current,
                    id: event.target.value,
                  }))
                }
              />
              <small>{t('packIdHelp')}</small>
            </label>
            <label>
              {t('field.description')}
              <textarea
                rows={2}
                value={pack.description}
                dir="auto"
                maxLength={1000}
                placeholder={t('descriptionPlaceholder')}
                onChange={(event) =>
                  editMetadata((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <nav className="category-nav" aria-label={t('field.category')}>
            <span className="eyebrow">{t('collection')}</span>
            <button
              className={!category ? 'category-item active' : 'category-item'}
              onClick={() => setCategory('')}
            >
              <Layers3 size={17} />
              <span>{t('allEmojis')}</span>
              <b>{pack.emojis.length}</b>
            </button>
            {categories.map((item) => (
              <button
                key={item}
                className={
                  category === item ? 'category-item active' : 'category-item'
                }
                onClick={() => setCategory(item)}
              >
                <span className="category-glyph">#</span>
                <span dir="auto">{item}</span>
                <b>
                  {
                    pack.emojis.filter((emoji) => emoji.category === item)
                      .length
                  }
                </b>
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="save-status">
              {storageFailed ? (
                t('storage.failed')
              ) : ready ? (
                <>
                  <Check size={13} />
                  {t('storage.saved')}
                </>
              ) : (
                t('storage.loading')
              )}
            </span>
            <button
              className="text-button"
              onClick={() =>
                download(
                  JSON.stringify(pack, null, 2),
                  `${pack.id || 'draft'}.json`,
                  'application/json',
                )
              }
            >
              <Copy size={14} />
              {t('saveDraft')}
            </button>
          </div>
        </aside>

        <section className="studio-main" aria-label={t('editorLabel')}>
          <div className="intro">
            <div>
              <span className="eyebrow">{t('intro.eyebrow')}</span>
              <h1>{t('intro.title')}</h1>
              <p>{t('intro.description')}</p>
            </div>
            <div className="intro-art" aria-hidden="true">
              <Sparkles className="art-leaf" size={60} strokeWidth={1.5} />
              <img
                className="art-face"
                src="/favicon.svg"
                width={88}
                height={88}
                alt=""
              />
              <Sparkle className="art-spark" size={28} fill="currentColor" />
              <span className="art-label">{t('intro.art')}</span>
            </div>
          </div>
          <div className="collection-toolbar">
            <div className="collection-title">
              <h2>{category || t('collectionTitle')}</h2>
              <span className="count-pill">{visible.length}</span>
            </div>
            <div className="toolbar-actions">
              <button
                className="button secondary"
                disabled={!pack.emojis.length}
                onClick={() => {
                  setPanelError('');
                  setPanel('replace');
                }}
              >
                {t('replace.open')}
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setPanelError('');
                  setPanel('legacy');
                }}
              >
                <Sparkles size={16} />
                {t('legacy.title')}
              </button>
              <button
                className="button secondary"
                disabled={folderBusy}
                onClick={() => fileInput.current?.click()}
              >
                <FolderOpen size={16} />
                {t('openPack')}
              </button>
              <button
                className="button secondary"
                disabled={folderBusy}
                onClick={openFolderPicker}
              >
                <FolderOpen size={16} />
                {t('folder.open')}
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setPanelError('');
                  setPanel('bulk');
                }}
              >
                <Upload size={16} />
                {t('bulkInput')}
              </button>
              <button className="button primary" onClick={() => openSingle()}>
                <Plus size={17} />
                {t('addEmoji')}
              </button>
            </div>
          </div>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".zip,.json,application/zip,application/json"
            aria-label={t('packFile')}
            disabled={folderBusy}
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
          <input
            ref={folderInput}
            className="visually-hidden"
            type="file"
            multiple
            aria-label={t('folder.input')}
            disabled={folderBusy}
            onChange={(event) => void importFolderFiles(event.target.files)}
          />
          {(activeFolderSource || activeReadOnlyFolder) && (
            <div className="folder-source" aria-live="polite">
              {activeFolderSource ? (
                <>
                  <p className="folder-source-name">
                    <FolderOpen size={15} />
                    <strong>
                      {t('folder.linked', { name: activeFolderSource.name })}
                    </strong>
                  </p>
                  <p>{t('folder.directHelp')}</p>
                  <p
                    className={`folder-source-status ${folderDirty ? 'dirty' : ''}`}
                  >
                    {folderDirty ? t('folder.unsaved') : t('folder.upToDate')}
                    {sessionOnlyFolders[workspace.activeKey]
                      ? ` · ${t('folder.sessionOnly')}`
                      : ''}
                  </p>
                </>
              ) : activeReadOnlyFolder ? (
                <>
                  <p className="folder-source-name">
                    <FolderOpen size={15} />
                    <strong>
                      {t('folder.linked', { name: activeReadOnlyFolder.name })}
                    </strong>
                  </p>
                  <p>{t('folder.readOnly')}</p>
                  <p
                    className={`folder-source-status ${folderDirty ? 'dirty' : ''}`}
                  >
                    {folderDirty ? t('folder.unsaved') : t('folder.upToDate')}
                  </p>
                </>
              ) : null}
            </div>
          )}
          <div className="search-row">
            <Search size={17} />
            <input
              aria-label={t('search')}
              type="search"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span>PNG / GIF / JPG</span>
          </div>
          <div className="name-attention-toolbar">
            <NameWarningSettings
              locale={locale}
              threshold={nameWarningLength}
              onChange={setNameWarningLength}
            />
            <label className="name-attention-filter">
              <input
                type="checkbox"
                checked={attentionOnly}
                onChange={(event) => setAttentionOnly(event.target.checked)}
              />
              {t('name.attentionOnly')}
            </label>
            <span className="name-attention-count">
              {t('name.attentionCount', { count: longNameCount })}
            </span>
          </div>
          {notice && (
            <div
              className={`notice ${notice.error ? 'error' : ''}`}
              role={notice.error ? 'alert' : 'status'}
            >
              <span>{notice.message}</span>
              <button
                className="icon-button"
                onClick={() => setNotice(null)}
                aria-label={t('closeNotice')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="collection-body">
            {visible.length ? (
              <div className="emoji-grid">
                {visible.map((emoji) => (
                  <article
                    className={`emoji-card${getNameLengthWarning(emoji.name, nameWarningLength) ? ' emoji-card-warning' : ''}`}
                    key={emoji.name}
                  >
                    <div className="emoji-card-top">
                      <EmojiPreview emoji={emoji} locale={locale} />
                      <span className="emoji-card-actions">
                        <button
                          className="icon-button"
                          aria-label={t('editNamed', { name: emoji.name })}
                          onClick={() => openSingle(emoji)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label={t('deleteNamed', { name: emoji.name })}
                          onClick={() => {
                            const key = workspace.activeKey;
                            setConfirmation({
                              message: t('confirm.delete', {
                                name: emoji.name,
                              }),
                              action: () => {
                                setWorkspace((current) => {
                                  const draft = current.packs.find(
                                    (item) => item.key === key,
                                  );
                                  return draft
                                    ? updatePack(current, key, {
                                        ...draft.pack,
                                        emojis: draft.pack.emojis.filter(
                                          (item) => item.name !== emoji.name,
                                        ),
                                      })
                                    : current;
                                });
                                notify(t('notice.deleted'));
                              },
                            });
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </div>
                    <strong className="emoji-name" dir="ltr">
                      :{emoji.name}:
                    </strong>
                    {getNameLengthWarning(emoji.name, nameWarningLength) && (
                      <p className="emoji-name-warning">
                        {t(
                          'name.longWarning',
                          getNameLengthWarning(emoji.name, nameWarningLength)!,
                        )}
                      </p>
                    )}
                    <span className="emoji-category" dir="auto">
                      {emoji.category}
                    </span>
                    <a
                      className="emoji-url"
                      dir="ltr"
                      href={emoji.url}
                      target="_blank"
                      rel="noreferrer"
                      title={emoji.url}
                    >
                      {emoji.url}
                      <ArrowUpRight size={12} />
                    </a>
                  </article>
                ))}
              </div>
            ) : pack.emojis.length ? (
              <div className="empty-state compact">
                <Search size={32} />
                <h3>{t('empty.searchTitle')}</h3>
                <p>{t('empty.searchHelp')}</p>
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery('');
                    setCategory('');
                    setAttentionOnly(false);
                  }}
                >
                  {t('showAll')} <ArrowLeft size={14} />
                </button>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-illustration" aria-hidden="true">
                  <img
                    className="empty-face"
                    src="/favicon.svg"
                    width={75}
                    height={75}
                    alt=""
                  />
                  <span className="empty-small">
                    <Plus size={18} />
                  </span>
                </div>
                <span className="eyebrow">{t('empty.eyebrow')}</span>
                <h3>{t('empty.title')}</h3>
                <p>
                  {t('empty.description')}
                  <br />
                  {t('empty.bulkHelp')}
                </p>
                <button className="button primary" onClick={() => openSingle()}>
                  <Plus size={17} />
                  {t('empty.add')}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setPanelError('');
                    setPanel('bulk');
                  }}
                >
                  {t('empty.bulk')} <ChevronRight size={15} />
                </button>
              </div>
            )}
          </div>
          <footer className="export-bar">
            <div className="export-description">
              <span className="export-icon">
                <FileArchive size={22} />
              </span>
              <div>
                <strong>{t('export.title')}</strong>
                <p>{t('export.description')}</p>
              </div>
            </div>
            <div className="export-actions">
              {activeFolderSource && (
                <button
                  className="button primary"
                  disabled={folderBusy || folderWriting}
                  onClick={() => void saveActiveFolder()}
                >
                  <Check size={16} />
                  {folderWriting ? t('busy') : t('folder.save')}
                </button>
              )}
              <button
                className="button secondary"
                disabled={!pack.emojis.length}
                onClick={exportZip}
              >
                <ArrowDownToLine size={16} />
                {t('export.zip')}
              </button>
              {runtime.mode === 'mod' && (
                <button
                  className="button primary"
                  disabled={busy || !pack.emojis.length}
                  onClick={() => void deploy()}
                >
                  <Monitor size={16} />
                  {busy ? t('busy') : t('deploy')}
                </button>
              )}
            </div>
          </footer>
          {runtime.mode === 'mod' ? (
            <div className="runtime-note">
              <button
                className="text-button"
                disabled={folderBusy}
                onClick={() => void showInstalled()}
              >
                <FolderOpen size={14} />
                {t('installed.open')}
              </button>
              <label className="overwrite">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(event) => setOverwrite(event.target.checked)}
                />
                {t('overwrite')}
              </label>
              <p>{t('runtime.modHelp')}</p>
            </div>
          ) : (
            <div className="runtime-note">
              <p>{t('runtime.staticHelp')}</p>
              <p>{t('runtime.imagesHelp')}</p>
            </div>
          )}
        </section>
      </main>
      <div className="page-footer">
        <span>Emojiful Pack Studio</span>
        <span>{t('footer')}</span>
      </div>

      <dialog
        ref={modalRef}
        className={`editor-dialog${panel === 'legacy' || panel === 'replace' || (panel === 'bulk' && bulkMode !== 'text') ? ' bulk-table-dialog' : ''}`}
        onCancel={() => setPanel(null)}
        onClose={() => setPanel(null)}
      >
        <div className="dialog-header">
          <div>
            <span className="eyebrow">PACK STUDIO</span>
            <h2>
              {panel === 'single'
                ? editing
                  ? t('editEmoji')
                  : t('addEmoji')
                : panel === 'replace'
                  ? t('replace.title')
                  : panel === 'legacy'
                    ? t('legacy.title')
                    : panel === 'bulk'
                      ? t('bulkTitle')
                      : t('installed.title')}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label={t('closeEditor')}
            onClick={() => setPanel(null)}
          >
            <X size={20} />
          </button>
        </div>
        {panelError && (
          <p className="form-error" role="alert">
            {panelError}
          </p>
        )}
        {panel === 'legacy' && <LegacyConversion locale={locale} />}
        {panel === 'replace' && (
          <NameReplacement
            locale={locale}
            names={pack.emojis.map((emoji) => emoji.name)}
            threshold={nameWarningLength}
            expanded
            scope={t('replace.scopePack', { count: pack.emojis.length })}
            onCancel={() => setPanel(null)}
            onApply={(names, count) => {
              editActivePack((current) =>
                validateDraft({
                  ...current,
                  emojis: current.emojis.map((emoji, index) => ({
                    ...emoji,
                    name: names[index],
                  })),
                }),
              );
              setPanel(null);
              notify(t('replace.applied', { count }));
            }}
          />
        )}
        {panel === 'single' && (
          <form onSubmit={saveEntry} className="editor-form">
            <label>
              {t('field.imageUrl')}
              <input
                aria-label={t('field.imageUrl')}
                type="url"
                dir="ltr"
                autoFocus
                required
                maxLength={2048}
                value={entry.url}
                placeholder="https://example.com/emoji.png"
                onChange={(event) =>
                  setEntry({ ...entry, url: event.target.value })
                }
              />
              <small>{t('imageUrlHelp')}</small>
            </label>
            <div className="form-columns">
              <label>
                {t('field.emojiName')}
                <input
                  aria-label={t('field.emojiName')}
                  dir="ltr"
                  required
                  maxLength={64}
                  value={entry.name}
                  aria-describedby={`single-name-length${entryNameWarning ? ' single-name-warning' : ''}`}
                  placeholder="happy_cat"
                  spellCheck={false}
                  onChange={(event) =>
                    setEntry({ ...entry, name: event.target.value })
                  }
                />
                <small>
                  {t('emojiNameHelp', {
                    name: normalizeName(entry.name) || 'happy_cat',
                  })}
                </small>
                <small id="single-name-length">
                  {t('name.length', {
                    length: Array.from(normalizeName(entry.name)).length,
                  })}
                </small>
                {entryNameWarning && (
                  <small
                    className="name-length-warning"
                    id="single-name-warning"
                    role="status"
                  >
                    {t('name.longWarning', entryNameWarning)}
                  </small>
                )}
              </label>
              <label>
                {t('field.category')}
                <input
                  required
                  maxLength={80}
                  list="categories"
                  dir="auto"
                  value={entry.category}
                  onChange={(event) =>
                    setEntry({ ...entry, category: event.target.value })
                  }
                />
              </label>
            </div>
            <datalist id="categories">
              {categories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setPanel(null)}
              >
                {t('cancel')}
              </button>
              <button className="button primary" type="submit">
                <Check size={16} />
                {editing ? t('saveChanges') : t('add')}
              </button>
            </div>
          </form>
        )}
        {panel === 'bulk' && (
          <form className="editor-form" onSubmit={saveBulk}>
            <label>
              {t('bulk.mode')}
              <select
                aria-label={t('bulk.mode')}
                value={bulkMode}
                onChange={(event) => {
                  setBulkMode(
                    event.target.value as 'text' | 'table' | 'nextcloud',
                  );
                  setPanelError('');
                }}
              >
                <option value="text">{t('bulk.textMode')}</option>
                <option value="table">{t('bulk.tableMode')}</option>
                <option value="nextcloud">{t('nextcloud.mode')}</option>
              </select>
            </label>
            <div className="form-columns">
              {bulkMode === 'text' && (
                <label>
                  {t('bulk.format')}
                  <select
                    value={bulkFormat}
                    onChange={(event) =>
                      setBulkFormat(event.target.value as BulkFormat)
                    }
                  >
                    <option value="auto">{t('bulk.auto')}</option>
                    <option value="csv">CSV</option>
                    <option value="tsv">TSV</option>
                    <option value="json">JSON</option>
                    <option value="urls">{t('bulk.urls')}</option>
                  </select>
                </label>
              )}
              <label>
                {t('bulk.defaultCategory')}
                <input
                  required
                  maxLength={80}
                  value={bulkCategory}
                  dir="auto"
                  onChange={(event) => setBulkCategory(event.target.value)}
                />
              </label>
            </div>
            {bulkMode === 'nextcloud' ? (
              <NextcloudInput
                locale={locale}
                draft={nextcloudDraft}
                onChange={(draft) => {
                  setNextcloudDraft(draft);
                  setPanelError('');
                }}
                onError={(error) => setPanelError(errorMessage(error, locale))}
              />
            ) : bulkMode === 'table' ? (
              <BulkTable
                locale={locale}
                rows={bulkRows}
                defaultCategory={bulkCategory}
                urlPrefix={bulkUrlPrefix}
                existingNames={pack.emojis.map((emoji) => emoji.name)}
                warningThreshold={nameWarningLength}
                onWarningThresholdChange={setNameWarningLength}
                onChange={(rows) => {
                  setBulkRows(rows);
                  setPanelError('');
                }}
              />
            ) : (
              <>
                <p className="form-intro">{t('bulk.description')}</p>
                <label>
                  {t('bulk.data')}
                  <textarea
                    autoFocus
                    required
                    rows={8}
                    className="bulk-input"
                    dir="ltr"
                    value={bulk}
                    placeholder={
                      'name,url,category\nhappy_cat,https://example.com/cat.png,Animals\nwave,https://example.com/wave.gif,Reactions'
                    }
                    onChange={(event) => setBulk(event.target.value)}
                  />
                </label>
                <label className="file-label">
                  <Upload size={15} />
                  {t('bulk.file')}
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,.json"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      try {
                        if (file.size > MAX_IMPORT_BYTES)
                          throw new LocalizedError('error.fileSize');
                        setBulk(await file.text());
                        if (/\.tsv$/i.test(file.name)) setBulkFormat('tsv');
                        else if (/\.csv$/i.test(file.name))
                          setBulkFormat('csv');
                        else if (/\.json$/i.test(file.name))
                          setBulkFormat('json');
                        else setBulkFormat('urls');
                      } catch (error) {
                        setPanelError(errorMessage(error, locale));
                      }
                      event.target.value = '';
                    }}
                  />
                </label>
                <div className="format-help">
                  <strong>{t('bulk.hints')}</strong>
                  <p>{t('bulk.csvHelp')}</p>
                  <p>{t('bulk.urlHelp')}</p>
                </div>
              </>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setPanel(null)}
              >
                {t('cancel')}
              </button>
              <button className="button primary" type="submit">
                <Plus size={16} />
                {bulkMode === 'nextcloud'
                  ? t('nextcloud.review')
                  : t('bulk.add')}
              </button>
            </div>
          </form>
        )}
        {panel === 'installed' && (
          <div className="installed-list">
            {busy ? (
              <p role="status">{t('loading')}</p>
            ) : installed.length ? (
              installed.map((item) => (
                <button
                  className="installed-item"
                  key={item.id}
                  onClick={() => void openInstalled(item.id)}
                >
                  <FileArchive size={22} />
                  <span>
                    <strong dir="auto">{item.name}</strong>
                    <small>
                      {t('installed.count', {
                        filename: item.filename,
                        count: item.emojiCount,
                      })}
                    </small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))
            ) : (
              <p>{t('installed.empty')}</p>
            )}
          </div>
        )}
      </dialog>
      <dialog
        ref={confirmRef}
        className="confirm-dialog"
        onCancel={() => setConfirmation(null)}
        onClose={() => setConfirmation(null)}
      >
        <h2>{t('confirm.title')}</h2>
        <p>{confirmation?.message}</p>
        <div className="dialog-actions">
          <button
            className="button secondary"
            onClick={() => setConfirmation(null)}
          >
            {t('cancel')}
          </button>
          <button
            className="button primary"
            onClick={() => {
              confirmation?.action();
              setConfirmation(null);
            }}
          >
            {t('confirm.apply')}
          </button>
        </div>
      </dialog>
    </>
  );
}
