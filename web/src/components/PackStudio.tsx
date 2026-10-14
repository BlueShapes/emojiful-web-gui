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
  Sprout,
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
import {
  detectRuntime,
  installPack,
  listInstalled,
  loadInstalled,
} from '../lib/runtime';
import type { InstalledPack, Runtime } from '../lib/runtime';
import { locales, localePath, translate, LocalizedError } from '../i18n';
import type { Locale, MessageKey, MessageArgs } from '../i18n';

const STORAGE_KEY = 'emojiful.pack-studio.v1';
const blankEntry = (): EmojiEntry => ({
  name: '',
  url: '',
  category: 'Custom',
});
type Panel = 'single' | 'bulk' | 'installed' | null;

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
  const [pack, setPack] = useState<EmojiPack>(emptyPack);
  const [runtime, setRuntime] = useState<Runtime>({ mode: 'static' });
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [entry, setEntry] = useState<EmojiEntry>(blankEntry);
  const [bulk, setBulk] = useState('');
  const [bulkCategory, setBulkCategory] = useState('Custom');
  const [bulkFormat, setBulkFormat] = useState<BulkFormat>('auto');
  const [panelError, setPanelError] = useState('');
  const [installed, setInstalled] = useState<InstalledPack[]>([]);
  const [busy, setBusy] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    message: string;
    action: () => void;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const packRef = useRef(pack);
  packRef.current = pack;
  const modalRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const categories = [
    ...new Set(pack.emojis.map((emoji) => emoji.category)),
  ].sort((a, b) =>
    a.localeCompare(b, locales.find((item) => item.code === locale)?.htmlLang),
  );
  const visible = pack.emojis.filter(
    (emoji) =>
      (!category || emoji.category === category) &&
      `${emoji.name} ${emoji.url} ${emoji.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setPack(validateDraft(JSON.parse(saved)));
    } catch {
      setNotice({
        message: t('storage.restoreFailed'),
        error: true,
      });
    }
    setReady(true);
    void detectRuntime().then(setRuntime);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pack));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [pack, ready]);
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
    if (category && !categories.includes(category)) setCategory('');
  }, [pack.emojis, category]);

  function notify(message: string, error = false) {
    setNotice({ message, error });
  }
  function changeLanguage(next: string) {
    // Save synchronously before navigation, including the latest unfinished metadata.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(packRef.current));
    } catch {
      notify(t('storage.failed'), true);
      return;
    }
    window.location.assign(localePath(next));
  }
  function openSingle(emoji?: EmojiEntry) {
    setEditing(emoji?.name ?? null);
    setEntry(emoji ?? { ...blankEntry(), category: category || 'Custom' });
    setPanelError('');
    setPanel('single');
  }
  function replacePack(next: EmojiPack) {
    const action = () => {
      setPack(next);
      setQuery('');
      setCategory('');
      setPanel(null);
      setOverwrite(false);
      notify(t('notice.loaded'));
    };
    // File and API reads may finish after the user has edited a newer draft.
    if (JSON.stringify(packRef.current) !== JSON.stringify(emptyPack()))
      setConfirmation({
        message: t('confirm.replace'),
        action,
      });
    else action();
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      replacePack(await readPackFile(file));
    } catch (error) {
      notify(errorMessage(error, locale), true);
    }
    if (fileInput.current) fileInput.current.value = '';
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
      setPack(validateDraft({ ...pack, emojis }));
      setPanel(null);
      notify(editing ? t('notice.updated') : t('notice.added'));
    } catch (error) {
      setPanelError(errorMessage(error, locale));
    }
  }
  function saveBulk(event: SubmitEvent) {
    event.preventDefault();
    try {
      const entries = importBulk(bulk, bulkCategory, bulkFormat);
      // Validate entries even while metadata is being edited.
      appendEntries({ ...emptyPack(), emojis: pack.emojis }, entries);
      setPack(validateDraft({ ...pack, emojis: [...pack.emojis, ...entries] }));
      setPanel(null);
      setBulk('');
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
      replacePack(validatePack(await loadInstalled(runtime, id)));
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
        >
          <span className="brand-mark">
            e<span>•</span>
          </span>
          <span>
            emojiful<span className="brand-sub">PACK STUDIO</span>
          </span>
        </a>
        <div className="topbar-right">
          <label className="language-picker">
            <span className="visually-hidden">{t('language')}</span>
            <select
              value={locale}
              disabled={!ready}
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
      <main className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span className="eyebrow">{t('workspace')}</span>
            <button
              className="icon-button"
              title={t('newPack')}
              aria-label={t('newPack')}
              onClick={() =>
                setConfirmation({
                  message: t('confirm.newPack'),
                  action: () => {
                    setPack(emptyPack());
                    setQuery('');
                    setCategory('');
                    setOverwrite(false);
                    notify(t('notice.newPack'));
                  },
                })
              }
            >
              <Plus size={18} />
            </button>
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
                  setPack({ ...pack, name: event.target.value })
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
                  setPack({ ...pack, id: event.target.value })
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
                  setPack({ ...pack, description: event.target.value })
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
              <span className="art-leaf">✳</span>
              <span className="art-face" dir="ltr">
                :)
              </span>
              <span className="art-spark">✦</span>
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
                onClick={() => fileInput.current?.click()}
              >
                <FolderOpen size={16} />
                {t('openPack')}
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
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
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
                  <article className="emoji-card" key={emoji.name}>
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
                          onClick={() =>
                            setConfirmation({
                              message: t('confirm.delete', {
                                name: emoji.name,
                              }),
                              action: () => {
                                setPack({
                                  ...pack,
                                  emojis: pack.emojis.filter(
                                    (item) => item.name !== emoji.name,
                                  ),
                                });
                                notify(t('notice.deleted'));
                              },
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </div>
                    <strong className="emoji-name" dir="ltr">
                      :{emoji.name}:
                    </strong>
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
                  }}
                >
                  {t('showAll')} <ArrowLeft size={14} />
                </button>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-illustration" aria-hidden="true">
                  <span className="empty-square">
                    <Sprout size={40} />
                  </span>
                  <span className="empty-small">+</span>
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
        className="editor-dialog"
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
            <p className="form-intro">{t('bulk.description')}</p>
            <div className="form-columns">
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
                    else if (/\.csv$/i.test(file.name)) setBulkFormat('csv');
                    else if (/\.json$/i.test(file.name)) setBulkFormat('json');
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
                {t('bulk.add')}
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
