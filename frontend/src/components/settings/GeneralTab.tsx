import type { Settings } from '../../types';
import { PaneHeader, Row, SectionLabel, Segmented, SettingCard, Toggle, ghostButton } from './ui';
import type { UpdateSetting } from './types';
import { useTranslation, LANGUAGES, type LanguageCode } from '../../i18n';

interface GeneralTabProps {
  settings: Settings;
  updateSetting: UpdateSetting;
}

export function GeneralTab({ settings, updateSetting }: GeneralTabProps) {
  const { lang, setLang } = useTranslation();
  const handleThemeChange = (newTheme: string) => updateSetting('theme', newTheme);

  const windowEffectValue =
    settings.mica_effect === 'clear'
      ? 'solid'
      : settings.mica_effect === 'mica_alt' || settings.mica_effect === 'auto'
        ? 'acrylic'
        : settings.mica_effect || 'solid';

  return (
    <div className="space-y-7">
      <PaneHeader title={'General'} subtitle={'How Cubby looks and behaves on this PC.'} />

      <section>
        <SectionLabel>{'Language'}</SectionLabel>
        <SettingCard>
          <Row
            title={'Interface language'}
            desc={'Choose the language for the app interface.'}
            control={
              <Segmented
                value={lang}
                onChange={(val) => setLang(val as LanguageCode)}
                options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
              />
            }
          />
        </SettingCard>
      </section>

      <section>
        <SectionLabel>{'Appearance'}</SectionLabel>
        <SettingCard>
          <Row
            title={'Theme'}
            control={
              <Segmented
                value={settings.theme}
                onChange={handleThemeChange}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                ]}
              />
            }
          />
          <Row
            title={'Window Effect'}
            desc={'Surface style of the popup window.'}
            control={
              <Segmented
                value={windowEffectValue}
                onChange={(val) => updateSetting('mica_effect', val)}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'mica', label: 'Mica' },
                  { value: 'acrylic', label: 'Acrylic' },
                ]}
              />
            }
          />
          <Row
            title={'History density'}
            desc={'Fit more clips, or show larger previews.'}
            control={
              <Segmented
                value={settings.density ?? 'comfortable'}
                onChange={(val) =>
                  updateSetting('density', val as NonNullable<Settings['density']>)
                }
                options={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' },
                ]}
              />
            }
          />
          <Row
            title={'Rounded Corners'}
            desc={'Use rounded corners for the Cubby flyout.'}
            control={
              <Toggle
                checked={settings.round_corners ?? false}
                onChange={() => updateSetting('round_corners', !(settings.round_corners ?? false))}
                label={'Rounded Corners'}
              />
            }
          />
        </SettingCard>
      </section>

      <section>
        <SectionLabel>{'Window behavior'}</SectionLabel>
        <SettingCard>
          <Row
            title={'Startup with Windows'}
            desc={
              settings.startup_unavailable_reason === 'error'
                ? 'Cubby could not read Windows startup permissions. Restart Cubby and try again.'
                : settings.startup_unavailable_reason === 'app_store'
                  ? 'Not available in the Microsoft Store version. Windows manages Store app startup permissions.'
                  : settings.is_portable
                    ? 'Not available in the portable version (it never touches the registry).'
                    : 'Automatically start when Windows boots'
            }
            control={
              <Toggle
                checked={settings.startup_with_windows}
                disabled={settings.startup_available === false}
                onChange={() =>
                  updateSetting('startup_with_windows', !settings.startup_with_windows)
                }
                label={'Startup with Windows'}
              />
            }
          />
          <Row
            title={'Float Above Taskbar'}
            desc={'Show the window on top of the taskbar'}
            control={
              <Toggle
                checked={settings.float_above_taskbar ?? true}
                onChange={() =>
                  updateSetting('float_above_taskbar', !(settings.float_above_taskbar ?? true))
                }
                label={'Float Above Taskbar'}
              />
            }
          />
        </SettingCard>
      </section>

      <section>
        <SectionLabel>{'Shortcuts'}</SectionLabel>
        <SettingCard>
          <Row
            title={'Shortcuts'}
            desc={`${settings.screenshot_hotkey ?? 'F1'} · ${settings.pin_hotkey ?? 'F3'} · ${settings.hotkey}`}
            control={
              <button
                className={ghostButton}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('zhenxia:settings-section', { detail: 'hotkeys' })
                  )
                }
              >
                {lang === 'zh-CN' ? '管理快捷键' : 'Manage shortcuts'}
              </button>
            }
          />
          <Row
            title={'Replace Windows clipboard shortcut'}
            desc={
              'Cubby takes over Win+V, so Windows Clipboard History will not open. Emoji picker remains available with Win+Period.'
            }
            control={
              <Toggle
                checked={settings.replace_win_v}
                onChange={() => updateSetting('replace_win_v', !settings.replace_win_v)}
                label={'Replace Windows clipboard shortcut'}
              />
            }
          />
        </SettingCard>
      </section>
    </div>
  );
}
