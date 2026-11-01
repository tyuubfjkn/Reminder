import { useId, useMemo, type ReactNode } from 'react';
import type { Locale, Settings, UpdateSettings } from '../api/contract';
import { useI18n } from '../i18n/context';
import { translate } from '../i18n/messages';

interface Props {
  settings: Settings;
  busy: boolean;
  onChange: (patch: UpdateSettings['patch']) => void;
  /** Extra settings sections, such as the optional AI assistant. */
  children?: ReactNode;
}

const locales: Locale[] = ['en-US', 'zh-CN'];

function timeZones(current: string): string[] {
  // supportedValuesOf omits UTC; keep it (and the saved zone) selectable.
  const zones = Intl.supportedValuesOf('timeZone');
  return [...new Set(['UTC', current, ...zones])];
}

export function SettingsView({ settings, busy, onChange, children }: Props) {
  const { t } = useI18n();
  const id = useId();
  const zones = useMemo(() => timeZones(settings.timeZone), [settings.timeZone]);

  return (
    <section className="settings" aria-labelledby={`${id}-heading`}>
      <h1 id={`${id}-heading`}>{t('settings.title')}</h1>
      <div className="field">
        <label htmlFor={`${id}-locale`}>{t('settings.language')}</label>
        <select id={`${id}-locale`} value={settings.locale} disabled={busy} aria-describedby={`${id}-locale-hint`}
          onChange={e => onChange({ locale: e.target.value as Locale })}>
          {/* Each language is named in itself so people can find their own. */}
          {locales.map(l => <option key={l} value={l} lang={l}>{translate(l, `locale.${l}`)}</option>)}
        </select>
        <p className="hint" id={`${id}-locale-hint`}>{t('settings.languageHint')}</p>
      </div>
      <div className="field">
        <label htmlFor={`${id}-zone`}>{t('settings.timeZone')}</label>
        <select id={`${id}-zone`} value={settings.timeZone} disabled={busy} aria-describedby={`${id}-zone-hint`}
          onChange={e => onChange({ timeZone: e.target.value })}>
          {zones.map(z => <option key={z} value={z}>{z.replaceAll('_', ' ')}</option>)}
        </select>
        <p className="hint" id={`${id}-zone-hint`}>{t('settings.timeZoneHint')}</p>
      </div>
      {busy && <p className="hint" aria-live="polite">{t('settings.saving')}</p>}
      {children}
    </section>
  );
}
