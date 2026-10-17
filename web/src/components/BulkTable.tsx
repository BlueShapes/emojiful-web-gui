import { useEffect, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { translate } from '../i18n';
import type { Locale, MessageArgs, MessageKey } from '../i18n';
import { MAX_EMOJIS } from '../lib/pack';
import type { EmojiEntry } from '../lib/pack';
import { getBulkTableIssues } from '../lib/bulk-table';
import { DEFAULT_NAME_WARNING_LENGTH } from '../lib/name-tools';
import NameWarningSettings from './NameWarningSettings';
import NameReplacement from './NameReplacement';

export interface BulkTableRow extends EmojiEntry {
  id: string;
  /** Original import filename; kept while names are edited or replaced. */
  sourceFilename?: string;
}

export function createBulkTableRows(): BulkTableRow[] {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `initial-${index}`,
    name: '',
    url: '',
    category: '',
  }));
}

export default function BulkTable({
  locale,
  rows,
  defaultCategory,
  urlPrefix = '',
  existingNames = [],
  warningThreshold = DEFAULT_NAME_WARNING_LENGTH,
  onWarningThresholdChange,
  onChange,
}: {
  locale: Locale;
  rows: BulkTableRow[];
  defaultCategory: string;
  urlPrefix?: string;
  existingNames?: readonly string[];
  warningThreshold?: number;
  onWarningThresholdChange?: (threshold: number) => void;
  onChange: (rows: BulkTableRow[]) => void;
}) {
  const t = (key: MessageKey, args?: MessageArgs) =>
    translate(locale, key, args);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<string | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const lastIssueRow = useRef<string | null>(null);
  const issues = getBulkTableIssues(
    rows,
    defaultCategory,
    existingNames,
    warningThreshold,
  );
  const hasError = (index: number, field?: keyof EmojiEntry) =>
    issues[index].some(
      (issue) =>
        issue.severity !== 'warning' && (!field || issue.field === field),
    );
  const issueRows = issues.flatMap((rowIssues, index) =>
    rowIssues.length ? [index] : [],
  );
  const hasIssue = (index: number, field: keyof EmojiEntry) =>
    issues[index].some((issue) => issue.field === field);
  function describedBy(index: number, field: keyof EmojiEntry) {
    return (
      [
        field === 'url' && urlPrefix ? 'bulk-url-help' : '',
        field === 'name' && rows[index].sourceFilename
          ? `bulk-source-${rows[index].id}`
          : '',
        hasIssue(index, field) ? `bulk-issue-${rows[index].id}-${field}` : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined
    );
  }
  function renderIssues(index: number, field: keyof EmojiEntry) {
    const fieldIssues = issues[index].filter((issue) => issue.field === field);
    if (!fieldIssues.length) return null;
    return (
      <div
        className={`bulk-cell-issue${fieldIssues.every((issue) => issue.severity === 'warning') ? ' bulk-cell-warning' : ''}`}
        id={`bulk-issue-${rows[index].id}-${field}`}
      >
        {fieldIssues.map((issue, issueIndex) => (
          <p key={issueIndex}>
            {t(
              issue.error.key === 'error.duplicate'
                ? 'bulk.duplicateName'
                : issue.error.key,
              issue.error.args,
            )}
          </p>
        ))}
      </div>
    );
  }
  useEffect(() => {
    if (pendingFocus.current) {
      nameInputs.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [rows]);

  function edit(id: string, field: keyof EmojiEntry, value: string) {
    onChange(
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  }

  return (
    <div className="bulk-table-editor">
      <p className="form-intro" id="bulk-table-help">
        {t('bulk.tableHelp')}
      </p>
      {onWarningThresholdChange && (
        <NameWarningSettings
          locale={locale}
          threshold={warningThreshold}
          onChange={onWarningThresholdChange}
        />
      )}
      {urlPrefix && (
        <div className="bulk-common-url">
          <span>{t('bulk.commonUrl')}</span>
          <code dir="ltr">{urlPrefix}</code>
          <p className="form-intro" id="bulk-url-help">
            {t('bulk.compactUrlHelp')}
          </p>
        </div>
      )}
      <NameReplacement
        locale={locale}
        names={rows.map((row) => row.name)}
        threshold={warningThreshold}
        existingNames={existingNames}
        scope={t('replace.scopeTable', { count: rows.length })}
        onApply={(names) =>
          onChange(rows.map((row, index) => ({ ...row, name: names[index] })))
        }
      />
      {issueRows.length > 0 && (
        <div
          className={`bulk-issue-summary${issueRows.every((index) => !hasError(index)) ? ' bulk-warning-summary' : ''}`}
          role="status"
        >
          <strong>{t('bulk.issueSummary', { count: issueRows.length })}</strong>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              const previous = issueRows.findIndex(
                (index) => rows[index].id === lastIssueRow.current,
              );
              const index = issueRows[(previous + 1) % issueRows.length];
              lastIssueRow.current = rows[index].id;
              const input = table.current?.tBodies[0].rows[
                index
              ]?.querySelector<HTMLInputElement>(
                'input[data-attention="true"]',
              );
              input?.focus();
              input?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
          >
            {t('bulk.nextIssue')}
          </button>
        </div>
      )}
      <div
        className="bulk-table-scroll"
        role="region"
        aria-label={t('bulk.tableMode')}
        aria-describedby="bulk-table-help"
        tabIndex={0}
      >
        <table className="bulk-table" ref={table}>
          <thead>
            <tr>
              <th scope="col" className="bulk-row-number">
                {t('bulk.rowNumber')}
              </th>
              <th scope="col">{t('field.emojiName')}</th>
              <th scope="col" className="bulk-url-column">
                {t('field.imageUrl')}
              </th>
              <th scope="col">{t('field.category')}</th>
              <th scope="col" className="bulk-row-actions">
                <span className="visually-hidden">{t('bulk.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.id}
                className={
                  hasError(index)
                    ? 'bulk-row-issue'
                    : issues[index].length
                      ? 'bulk-row-warning'
                      : undefined
                }
              >
                <th scope="row" className="bulk-row-number">
                  {index + 1}
                </th>
                <td>
                  <input
                    ref={(input) => {
                      if (input) nameInputs.current.set(row.id, input);
                      else nameInputs.current.delete(row.id);
                    }}
                    aria-label={t('bulk.cell', {
                      index: index + 1,
                      field: t('field.emojiName'),
                    })}
                    dir="ltr"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={64}
                    aria-invalid={hasError(index, 'name') || undefined}
                    data-attention={hasIssue(index, 'name') || undefined}
                    aria-describedby={describedBy(index, 'name')}
                    value={row.name}
                    placeholder="happy_cat"
                    onChange={(event) =>
                      edit(row.id, 'name', event.target.value)
                    }
                  />
                  {row.sourceFilename && (
                    <div
                      className="bulk-source-filename"
                      id={`bulk-source-${row.id}`}
                    >
                      <span>{t('bulk.sourceFilename')}</span>
                      <bdi>{row.sourceFilename}</bdi>
                    </div>
                  )}
                  {renderIssues(index, 'name')}
                </td>
                <td className="bulk-url-cell">
                  <div className="bulk-url-input">
                    <input
                      aria-label={t('bulk.cell', {
                        index: index + 1,
                        field: t('field.imageUrl'),
                      })}
                      className={
                        urlPrefix && row.url.startsWith(urlPrefix)
                          ? 'bulk-compact-url'
                          : undefined
                      }
                      dir="ltr"
                      inputMode="url"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={2048}
                      aria-invalid={hasError(index, 'url') || undefined}
                      data-attention={hasIssue(index, 'url') || undefined}
                      aria-describedby={describedBy(index, 'url')}
                      title={row.url}
                      value={row.url}
                      placeholder="https://example.com/cat.png"
                      onChange={(event) =>
                        edit(row.id, 'url', event.target.value)
                      }
                    />
                    {urlPrefix && row.url.startsWith(urlPrefix) && (
                      <span
                        className="bulk-url-filename"
                        dir="ltr"
                        aria-hidden="true"
                      >
                        {row.url.slice(urlPrefix.length)}
                      </span>
                    )}
                  </div>
                  {renderIssues(index, 'url')}
                </td>
                <td>
                  <input
                    aria-label={t('bulk.cell', {
                      index: index + 1,
                      field: t('field.category'),
                    })}
                    dir="auto"
                    maxLength={80}
                    aria-invalid={hasError(index, 'category') || undefined}
                    data-attention={hasIssue(index, 'category') || undefined}
                    aria-describedby={describedBy(index, 'category')}
                    value={row.category}
                    placeholder={defaultCategory}
                    onChange={(event) =>
                      edit(row.id, 'category', event.target.value)
                    }
                  />
                  {renderIssues(index, 'category')}
                </td>
                <td>
                  <button
                    className="icon-button"
                    type="button"
                    disabled={rows.length === 1}
                    aria-label={t('bulk.removeRow', { index: index + 1 })}
                    title={t('bulk.removeRow', { index: index + 1 })}
                    onClick={() => {
                      pendingFocus.current =
                        rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
                      onChange(rows.filter((item) => item.id !== row.id));
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="button secondary bulk-add-row"
        type="button"
        disabled={rows.length >= MAX_EMOJIS}
        onClick={() => {
          const id = crypto.randomUUID();
          pendingFocus.current = id;
          onChange([...rows, { id, name: '', url: '', category: '' }]);
        }}
      >
        <Plus size={15} />
        {t('bulk.addRow')}
      </button>
    </div>
  );
}
