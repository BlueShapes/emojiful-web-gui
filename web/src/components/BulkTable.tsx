import { useEffect, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { translate } from '../i18n';
import type { Locale, MessageArgs, MessageKey } from '../i18n';
import { MAX_EMOJIS } from '../lib/pack';
import type { EmojiEntry } from '../lib/pack';

export interface BulkTableRow extends EmojiEntry {
  id: string;
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
  onChange,
}: {
  locale: Locale;
  rows: BulkTableRow[];
  defaultCategory: string;
  onChange: (rows: BulkTableRow[]) => void;
}) {
  const t = (key: MessageKey, args?: MessageArgs) =>
    translate(locale, key, args);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<string | null>(null);
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
      <div
        className="bulk-table-scroll"
        role="region"
        aria-label={t('bulk.tableMode')}
        aria-describedby="bulk-table-help"
        tabIndex={0}
      >
        <table className="bulk-table">
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
              <tr key={row.id}>
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
                    value={row.name}
                    placeholder="happy_cat"
                    onChange={(event) =>
                      edit(row.id, 'name', event.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={t('bulk.cell', {
                      index: index + 1,
                      field: t('field.imageUrl'),
                    })}
                    dir="ltr"
                    inputMode="url"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={2048}
                    value={row.url}
                    placeholder="https://example.com/cat.png"
                    onChange={(event) =>
                      edit(row.id, 'url', event.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={t('bulk.cell', {
                      index: index + 1,
                      field: t('field.category'),
                    })}
                    dir="auto"
                    maxLength={80}
                    value={row.category}
                    placeholder={defaultCategory}
                    onChange={(event) =>
                      edit(row.id, 'category', event.target.value)
                    }
                  />
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
