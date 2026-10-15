import { useEffect, useRef, useState } from 'react';
import { Download, FileArchive, FileVideo, Upload, X } from 'lucide-react';
import { zipSync } from 'fflate';
import { createLegacyConverter } from '../lib/legacy-client';
import { errorMessage } from '../lib/pack';
import { LocalizedError, translate } from '../i18n';
import type { Locale } from '../i18n';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const ALLOWED_EXTENSION = /\.(?:gif|webm|webp|apng|png)$/i;

type ConversionResult = Awaited<
  ReturnType<ReturnType<typeof createLegacyConverter>['convert']>
>;
type ConversionRow = {
  id: number;
  file: File;
  status: 'queued' | 'converting' | 'done' | 'failed';
  stage?: 'loading' | 'converting';
  result?: ConversionResult & { previewUrl: string };
  error?: unknown;
};

function formatBytes(bytes: number, locale: Locale): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

function safeGifFilename(filename: string): string | null {
  const basename = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const safe = basename.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim();
  return safe && /\.gif$/i.test(safe) ? safe : null;
}

function uniqueFilename(filename: string, used: Set<string>): string {
  const dot = filename.toLowerCase().lastIndexOf('.gif');
  const stem = filename.slice(0, dot) || 'emoji';
  let candidate = filename;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem}-${suffix}.gif`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function triggerDownload(bytes: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LegacyConversion({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<ConversionRow[]>([]);
  const [maxEdge, setMaxEdge] = useState(128);
  const [busy, setBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<unknown>();
  const [operationError, setOperationError] = useState<unknown>();
  const [completed, setCompleted] = useState(false);
  const nextIdRef = useRef(1);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const runIdRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const converterRef = useRef<ReturnType<typeof createLegacyConverter> | null>(
    null,
  );
  const previewUrlsRef = useRef(new Set<string>());
  const t = (
    key: Parameters<typeof translate>[1],
    args?: Parameters<typeof translate>[2],
  ) => translate(locale, key, args);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      converterRef.current?.close();
      converterRef.current = null;
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current.clear();
    };
  }, []);

  function revokePreviews() {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
  }

  function updateRow(
    id: number,
    update: (row: ConversionRow) => ConversionRow,
  ) {
    if (!mountedRef.current) return;
    setRows((current) =>
      current.map((row) => (row.id === id ? update(row) : row)),
    );
  }

  function selectFiles(files: File[]) {
    if (busyRef.current || files.length === 0) return;
    let totalBytes = 0;
    let invalid = files.length > MAX_FILES;
    let overLimit = files.length > MAX_FILES;
    for (const file of files) {
      totalBytes += file.size;
      if (!ALLOWED_EXTENSION.test(file.name) || file.size === 0) invalid = true;
      if (file.size > MAX_FILE_BYTES) overLimit = true;
    }
    if (totalBytes > MAX_INPUT_BYTES) overLimit = true;
    if (invalid || overLimit) {
      setSelectionError(
        overLimit
          ? new LocalizedError('legacy.limits')
          : new LocalizedError('legacy.invalid'),
      );
      return;
    }

    revokePreviews();
    setSelectionError(undefined);
    setOperationError(undefined);
    setCompleted(false);
    setRows(
      files.map((file) => ({
        id: nextIdRef.current++,
        file,
        status: 'queued',
      })),
    );
  }

  async function startConversion() {
    if (busyRef.current || !rows.some((row) => row.status !== 'done')) return;
    const pending = rows.filter((row) => row.status !== 'done');
    const runId = ++runIdRef.current;
    stopRequestedRef.current = false;
    busyRef.current = true;
    setBusy(true);
    setCompleted(false);
    setOperationError(undefined);
    let converter: ReturnType<typeof createLegacyConverter>;
    try {
      converter = converterRef.current ?? createLegacyConverter();
      converterRef.current = converter;
    } catch (error) {
      for (const row of pending) {
        updateRow(row.id, (current) => ({
          ...current,
          status: 'failed',
          stage: undefined,
          error,
        }));
      }
      busyRef.current = false;
      setBusy(false);
      setOperationError(error);
      return;
    }

    const isCurrentRun = () =>
      mountedRef.current &&
      runIdRef.current === runId &&
      !stopRequestedRef.current;
    let outputBytes = rows.reduce(
      (total, row) => total + (row.result?.bytes.byteLength ?? 0),
      0,
    );
    const usedNames = new Set(
      rows
        .filter((row) => row.status === 'done' && row.result)
        .map((row) => row.result!.filename.toLowerCase()),
    );

    for (const row of pending) {
      if (!isCurrentRun()) break;
      updateRow(row.id, (current) => ({
        ...current,
        status: 'converting',
        stage: 'loading',
        error: undefined,
      }));
      try {
        const result = await converter.convert(
          row.file,
          { maxEdge },
          (stage) => {
            if (!isCurrentRun()) return;
            updateRow(row.id, (current) => ({ ...current, stage }));
          },
        );
        if (!isCurrentRun()) break;

        const filename = safeGifFilename(result.filename);
        if (
          !filename ||
          result.bytes.byteLength === 0 ||
          result.width <= 0 ||
          result.height <= 0 ||
          result.frames <= 0 ||
          result.width > maxEdge ||
          result.height > maxEdge
        ) {
          throw new LocalizedError('legacy.outputInvalid');
        }
        if (outputBytes + result.bytes.byteLength > MAX_OUTPUT_BYTES) {
          throw new LocalizedError('legacy.limits');
        }

        const unique = uniqueFilename(filename, usedNames);
        const previewUrl = URL.createObjectURL(
          new Blob([result.bytes], { type: 'image/gif' }),
        );
        previewUrlsRef.current.add(previewUrl);
        outputBytes += result.bytes.byteLength;
        updateRow(row.id, (current) => ({
          ...current,
          status: 'done',
          stage: undefined,
          result: { ...result, filename: unique, previewUrl },
          error: undefined,
        }));
      } catch (error) {
        if (!isCurrentRun()) break;
        updateRow(row.id, (current) => ({
          ...current,
          status: 'failed',
          stage: undefined,
          error,
        }));
      }
    }

    if (!isCurrentRun()) return;
    setCompleted(true);
    busyRef.current = false;
    setBusy(false);
    converter.close();
    if (converterRef.current === converter) converterRef.current = null;
  }

  function stopConversion() {
    if (!busyRef.current) return;
    stopRequestedRef.current = true;
    runIdRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setRows((current) =>
      current.map((row) =>
        row.status === 'converting'
          ? { ...row, status: 'queued', stage: undefined, error: undefined }
          : row,
      ),
    );
    converterRef.current?.close();
    converterRef.current = null;
  }

  function downloadAll() {
    const converted = rows.filter(
      (row) => row.status === 'done' && row.result !== undefined,
    );
    if (converted.length === 0) return;
    try {
      const files: Record<string, Uint8Array> = Object.create(null);
      for (const row of converted) {
        if (row.result) files[row.result.filename] = row.result.bytes;
      }
      triggerDownload(
        zipSync(files, { level: 0 }),
        'legacy-conversion.zip',
        'application/zip',
      );
      setOperationError(undefined);
    } catch (error) {
      setOperationError(error);
    }
  }

  function renderStatus(row: ConversionRow, index: number): string {
    if (row.status === 'done') return t('legacy.done');
    if (row.status === 'failed') return t('legacy.failed');
    if (row.status === 'queued') return t('legacy.queued');
    if (row.stage === 'loading') return t('legacy.loading');
    return t('legacy.converting', {
      name: row.file.name,
      index: index + 1,
      count: rows.length,
    });
  }

  const convertedCount = rows.filter((row) => row.status === 'done').length;
  const hasPending = rows.some((row) => row.status !== 'done');

  return (
    <section
      className="legacy-conversion"
      aria-labelledby="legacy-conversion-title"
    >
      <header className="legacy-heading">
        <div className="legacy-heading-icon" aria-hidden="true">
          <FileVideo size={21} />
        </div>
        <div>
          <h3 id="legacy-conversion-title">{t('legacy.title')}</h3>
          <p>{t('legacy.description')}</p>
        </div>
      </header>

      <div className="legacy-settings">
        <label className="legacy-size-setting">
          <span>{t('legacy.size')}</span>
          <select
            value={maxEdge}
            disabled={busy}
            aria-label={t('legacy.size')}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if ([64, 128, 256, 512].includes(value)) {
                if (value === maxEdge) return;
                revokePreviews();
                setMaxEdge(value);
                setRows((current) =>
                  current.map((row) => ({
                    ...row,
                    status: 'queued',
                    stage: undefined,
                    result: undefined,
                    error: undefined,
                  })),
                );
                setCompleted(false);
                setOperationError(undefined);
              } else {
                setSelectionError(new LocalizedError('legacy.settingsInvalid'));
              }
            }}
          >
            {[64, 128, 256, 512].map((edge) => (
              <option key={edge} value={edge}>
                {edge} × {edge}
              </option>
            ))}
          </select>
        </label>
        <p>{t('legacy.sizeHelp')}</p>
      </div>

      <label
        className={`file-label legacy-file-label${busy ? ' is-disabled' : ''}`}
      >
        <Upload size={16} aria-hidden="true" />
        <span>{t('legacy.files')}</span>
        <input
          type="file"
          accept=".gif,.webm,.webp,.apng,.png"
          multiple
          disabled={busy}
          onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            selectFiles(selected);
          }}
        />
      </label>
      <p className="legacy-limits-help">{t('legacy.limitsHelp')}</p>

      {selectionError !== undefined && (
        <p className="form-error legacy-message" role="alert">
          {errorMessage(selectionError, locale)}
        </p>
      )}
      {operationError !== undefined && (
        <p className="form-error legacy-message" role="alert">
          {errorMessage(operationError, locale)}
        </p>
      )}

      <div className="legacy-actions">
        {!busy ? (
          <button
            className="button primary"
            type="button"
            onClick={() => void startConversion()}
            disabled={!hasPending}
          >
            <FileVideo size={15} aria-hidden="true" />
            {t('legacy.convert')}
          </button>
        ) : (
          <button
            className="button secondary"
            type="button"
            onClick={stopConversion}
          >
            <X size={15} aria-hidden="true" />
            {t('legacy.stop')}
          </button>
        )}
        <button
          className="button secondary"
          type="button"
          onClick={downloadAll}
          disabled={convertedCount === 0}
        >
          <FileArchive size={15} aria-hidden="true" />
          {t('legacy.downloadAll')}
        </button>
        {completed &&
          convertedCount > 0 &&
          rows.every((row) => row.status === 'done') && (
            <span className="legacy-completion" role="status">
              {t('legacy.done')}
            </span>
          )}
      </div>

      {rows.length > 0 && (
        <div
          className="legacy-results"
          role="list"
          aria-label={t('legacy.files')}
        >
          {rows.map((row, index) => (
            <article className="legacy-result" role="listitem" key={row.id}>
              <div className="legacy-result-preview">
                {row.result ? (
                  <img src={row.result.previewUrl} alt="" />
                ) : (
                  <FileVideo size={21} aria-hidden="true" />
                )}
              </div>
              <div className="legacy-result-info">
                <h4>{row.file.name}</h4>
                <p className="legacy-result-status" aria-live="polite">
                  {renderStatus(row, index)}
                </p>
                {row.result && (
                  <p className="legacy-result-details">
                    {t('legacy.details', {
                      width: row.result.width,
                      height: row.result.height,
                      frames: row.result.frames,
                      size: formatBytes(row.result.bytes.byteLength, locale),
                    })}
                  </p>
                )}
                {row.error !== undefined && (
                  <p className="legacy-result-error">
                    {errorMessage(row.error, locale)}
                  </p>
                )}
              </div>
              {row.result && (
                <button
                  className="button secondary legacy-download"
                  type="button"
                  onClick={() =>
                    triggerDownload(
                      row.result!.bytes,
                      row.result!.filename,
                      'image/gif',
                    )
                  }
                >
                  <Download size={14} aria-hidden="true" />
                  {t('legacy.download')}
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      <aside className="format-help legacy-help">
        <p>{t('legacy.publishHelp')}</p>
        <p>{t('legacy.engineHelp')}</p>
        <p>
          <a href="/legacy-engine/SOURCES.md" target="_blank" rel="noreferrer">
            {t('legacy.licenses')}
          </a>
        </p>
      </aside>
    </section>
  );
}
