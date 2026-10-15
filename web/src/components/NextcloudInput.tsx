import { useEffect, useRef } from 'react';
import { Upload } from 'lucide-react';
import { buildNextcloudCommand, parseNextcloudFolder } from '../lib/nextcloud';
import type { NextcloudShell } from '../lib/nextcloud';
import { errorMessage, MAX_IMPORT_BYTES } from '../lib/pack';
import { LocalizedError, translate } from '../i18n';
import type { Locale, MessageArgs, MessageKey } from '../i18n';

export interface NextcloudDraft {
  shareUrl: string;
  folderPath: string;
  shell: NextcloudShell;
  listing: string;
}

export const emptyNextcloudDraft = (): NextcloudDraft => ({
  shareUrl: '',
  folderPath: '',
  shell: 'powershell',
  listing: '',
});

export default function NextcloudInput({
  locale,
  draft,
  onChange,
  onError,
}: {
  locale: Locale;
  draft: NextcloudDraft;
  onChange: (draft: NextcloudDraft) => void;
  onError: (error: unknown) => void;
}) {
  const t = (key: MessageKey, args?: MessageArgs) =>
    translate(locale, key, args);
  const readVersion = useRef(0);
  useEffect(
    () => () => {
      readVersion.current++;
    },
    [],
  );
  function edit(patch: Partial<NextcloudDraft>) {
    readVersion.current++;
    onChange({ ...draft, ...patch });
  }
  let command = '';
  let commandError = '';
  try {
    command = buildNextcloudCommand(
      parseNextcloudFolder(draft.shareUrl, draft.folderPath),
      draft.shell,
    );
  } catch (error) {
    commandError = errorMessage(error, locale);
  }

  return (
    <div className="nextcloud-input">
      <p className="form-intro">{t('nextcloud.description')}</p>
      <div className="format-help">
        <p>{t('nextcloud.requirements')}</p>
      </div>
      <label>
        {t('nextcloud.shareUrl')}
        <input
          aria-label={t('nextcloud.shareUrl')}
          type="url"
          required
          maxLength={2048}
          dir="ltr"
          value={draft.shareUrl}
          placeholder="https://cloud.example.com/s/SHARE_TOKEN"
          onChange={(event) => edit({ shareUrl: event.target.value })}
        />
      </label>
      <div className="form-columns">
        <label>
          {t('nextcloud.folderPath')}
          <input
            aria-label={t('nextcloud.folderPath')}
            aria-describedby="nextcloud-folder-help"
            maxLength={1024}
            dir="ltr"
            value={draft.folderPath}
            placeholder="/"
            onChange={(event) => edit({ folderPath: event.target.value })}
          />
          <small id="nextcloud-folder-help">{t('nextcloud.folderHelp')}</small>
        </label>
        <label>
          {t('nextcloud.shell')}
          <select
            aria-label={t('nextcloud.shell')}
            value={draft.shell}
            onChange={(event) =>
              edit({ shell: event.target.value as NextcloudShell })
            }
          >
            <option value="powershell">PowerShell (Windows)</option>
            <option value="sh">macOS / Linux (sh)</option>
          </select>
        </label>
      </div>
      <label>
        {t('nextcloud.command')}
        <textarea
          aria-label={t('nextcloud.command')}
          aria-describedby="nextcloud-command-help"
          readOnly
          className="nextcloud-command"
          dir="ltr"
          rows={5}
          value={command}
          placeholder={commandError}
          onFocus={(event) => {
            if (command) event.target.select();
          }}
        />
        <small id="nextcloud-command-help">{t('nextcloud.commandHelp')}</small>
      </label>
      <label>
        {t('nextcloud.output')}
        <textarea
          aria-label={t('nextcloud.output')}
          required
          className="bulk-input"
          dir="ltr"
          rows={6}
          value={draft.listing}
          placeholder={
            '<?xml version="1.0"?>\n<d:multistatus xmlns:d="DAV:">…</d:multistatus>'
          }
          onChange={(event) => edit({ listing: event.target.value })}
        />
      </label>
      <label className="file-label">
        <Upload size={15} />
        {t('nextcloud.file')}
        <input
          aria-label={t('nextcloud.file')}
          type="file"
          accept=".xml,application/xml,text/xml"
          onChange={async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            const version = ++readVersion.current;
            try {
              if (file.size > MAX_IMPORT_BYTES)
                throw new LocalizedError('error.fileSize');
              const listing = await file.text();
              if (version === readVersion.current)
                onChange({ ...draft, listing });
            } catch (error) {
              if (version === readVersion.current) onError(error);
            } finally {
              input.value = '';
            }
          }}
        />
      </label>
      <p className="form-intro">{t('nextcloud.editHelp')}</p>
    </div>
  );
}
