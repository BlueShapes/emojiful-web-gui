import { useEffect, useId, useState } from 'react';
import { translate } from '../i18n';
import type { Locale } from '../i18n';

export default function NameWarningSettings({
  locale,
  threshold,
  onChange,
}: {
  locale: Locale;
  threshold: number;
  onChange: (threshold: number) => void;
}) {
  const [draft, setDraft] = useState(String(threshold));
  const helpId = useId();
  useEffect(() => setDraft(String(threshold)), [threshold]);
  return (
    <div className="name-warning-settings">
      <label>
        {translate(locale, 'name.warningThreshold')}
        <input
          type="number"
          min={1}
          max={64}
          step={1}
          value={draft}
          aria-label={translate(locale, 'name.warningThreshold')}
          aria-describedby={helpId}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 1 && value <= 64)
              onChange(value);
          }}
          onBlur={() => setDraft(String(threshold))}
        />
      </label>
      <small id={helpId}>
        {translate(locale, 'name.warningThresholdHelp', { threshold })}
      </small>
    </div>
  );
}
