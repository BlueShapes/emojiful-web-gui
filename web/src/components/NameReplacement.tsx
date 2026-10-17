import { useEffect, useRef, useState } from 'react';
import { translate } from '../i18n';
import type { Locale, MessageKey } from '../i18n';
import { errorMessage } from '../lib/pack';
import { getNameLengthWarning } from '../lib/name-tools';
import type {
  NameReplacementMode,
  NameReplacementPreview,
} from '../lib/name-tools';

export default function NameReplacement({
  locale,
  names,
  threshold,
  existingNames = [],
  expanded = false,
  scope,
  onApply,
  onCancel,
}: {
  locale: Locale;
  names: readonly string[];
  threshold: number;
  existingNames?: readonly string[];
  expanded?: boolean;
  scope: string;
  onApply: (names: string[], count: number) => void;
  onCancel?: () => void;
}) {
  const t = (key: MessageKey, args = {}) => translate(locale, key, args);
  const [open, setOpen] = useState(expanded);
  const [mode, setMode] = useState<NameReplacementMode>('literal');
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [preview, setPreview] = useState<NameReplacementPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = JSON.stringify({ names, existingNames });
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const previewSource = useRef('');

  function stop() {
    worker.current?.terminate();
    worker.current = null;
    if (timeout.current !== null) clearTimeout(timeout.current);
    timeout.current = null;
  }
  function invalidate() {
    stop();
    setBusy(false);
    setPreview(null);
    setError('');
  }
  useEffect(() => {
    invalidate();
    return stop;
  }, [source]);

  function runPreview() {
    invalidate();
    if (!search) {
      setError(t('replace.error.emptySearch'));
      return;
    }
    try {
      const current = new Worker(
        new URL('../workers/name-replacement.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.current = current;
      const snapshot = source;
      setBusy(true);
      current.onmessage = (
        event: MessageEvent<{
          ok: boolean;
          preview?: NameReplacementPreview;
          code?: string;
        }>,
      ) => {
        if (worker.current !== current || sourceRef.current !== snapshot)
          return;
        stop();
        setBusy(false);
        if (event.data.ok && event.data.preview) {
          previewSource.current = snapshot;
          setPreview(event.data.preview);
        } else {
          const key: MessageKey =
            event.data.code === 'invalidPattern'
              ? 'replace.error.invalidPattern'
              : event.data.code === 'emptySearch'
                ? 'replace.error.emptySearch'
                : event.data.code === 'tooLarge'
                  ? 'replace.error.tooLarge'
                  : 'replace.error.failed';
          setError(t(key));
        }
      };
      current.onerror = () => {
        if (worker.current !== current) return;
        stop();
        setBusy(false);
        setError(t('replace.error.failed'));
      };
      timeout.current = setTimeout(() => {
        if (worker.current !== current) return;
        stop();
        setBusy(false);
        setError(t('replace.error.timeout'));
      }, 1500);
      current.postMessage({
        names: [...names],
        existingNames: [...existingNames],
        search,
        replacement,
        mode,
      });
    } catch {
      stop();
      setBusy(false);
      setError(t('replace.error.failed'));
    }
  }
  const problemRows = new Set(
    preview?.problems.map((problem) => problem.index),
  );
  const previewRows = preview
    ? [
        ...new Set([
          ...preview.changes.map((change) => change.index),
          ...problemRows,
        ]),
      ].sort((a, b) => a - b)
    : [];

  if (!open)
    return (
      <button
        type="button"
        className="button secondary name-replacement-open"
        disabled={!names.some(Boolean)}
        onClick={() => setOpen(true)}
      >
        {t('replace.open')}
      </button>
    );

  return (
    <section
      className="name-replacement"
      aria-label={t('replace.title')}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          runPreview();
        }
      }}
    >
      {!expanded && <h3>{t('replace.title')}</h3>}
      <p className="form-intro">{scope}</p>
      <p className="form-intro">{t('replace.description')}</p>
      <label>
        {t('replace.mode')}
        <select
          aria-label={t('replace.mode')}
          value={mode}
          onChange={(event) => {
            invalidate();
            setMode(event.target.value as NameReplacementMode);
          }}
        >
          <option value="literal">{t('replace.literal')}</option>
          <option value="regex">{t('replace.regex')}</option>
        </select>
      </label>
      <div className="form-columns">
        <label>
          {t('replace.search')}
          <input
            aria-label={t('replace.search')}
            dir="ltr"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={256}
            value={search}
            onChange={(event) => {
              invalidate();
              setSearch(event.target.value);
            }}
          />
        </label>
        <label>
          {t('replace.replacement')}
          <input
            aria-label={t('replace.replacement')}
            dir="ltr"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={256}
            value={replacement}
            onChange={(event) => {
              invalidate();
              setReplacement(event.target.value);
            }}
          />
        </label>
      </div>
      <p className="form-intro">{t('replace.help')}</p>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={runPreview}
      >
        {busy ? t('busy') : t('replace.preview')}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p role="status">
            {preview.changes.length
              ? t('replace.changed', { count: preview.changes.length })
              : t('replace.noChanges')}
          </p>
          {problemRows.size > 0 && (
            <div className="name-replacement-problems" role="alert">
              <strong>
                {t('replace.invalid', { count: problemRows.size })}
              </strong>
              {[
                ...new Set(preview.problems.map((problem) => problem.kind)),
              ].map((kind) => (
                <p key={kind}>{t(`replace.problem.${kind}`)}</p>
              ))}
            </div>
          )}
          {previewRows.length > 0 && (
            <div className="name-replacement-scroll">
              <table className="name-replacement-preview">
                <thead>
                  <tr>
                    <th>{t('bulk.rowNumber')}</th>
                    <th>{t('replace.before')}</th>
                    <th>{t('replace.after')}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((index) => {
                    const warning = getNameLengthWarning(
                      preview.names[index],
                      threshold,
                    );
                    const problems = preview.problems.filter(
                      (problem) => problem.index === index,
                    );
                    return (
                      <tr
                        key={index}
                        className={
                          problems.length
                            ? 'replacement-row-error'
                            : warning
                              ? 'replacement-row-warning'
                              : undefined
                        }
                      >
                        <th scope="row">{index + 1}</th>
                        <td dir="ltr">{names[index]}</td>
                        <td>
                          <span dir="ltr">{preview.names[index]}</span>
                          {problems.map((problem) => (
                            <p
                              className="replacement-row-problem"
                              key={problem.kind}
                            >
                              {t(`replace.problem.${problem.kind}`)}
                            </p>
                          ))}
                          {warning && (
                            <p className="replacement-row-warning-text">
                              {t('name.longWarning', warning)}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            invalidate();
            if (onCancel) onCancel();
            else setOpen(false);
          }}
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || !preview?.changes.length || problemRows.size > 0}
          onClick={() => {
            if (!preview || previewSource.current !== sourceRef.current) {
              invalidate();
              return;
            }
            try {
              onApply(preview.names, preview.changes.length);
              invalidate();
              if (!expanded) setOpen(false);
            } catch (caught) {
              setError(errorMessage(caught, locale));
            }
          }}
        >
          {t('replace.apply')}
        </button>
      </div>
    </section>
  );
}
