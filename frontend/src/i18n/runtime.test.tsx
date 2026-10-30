import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, setGlobalLang, tGlobal, useTranslation } from './index';
import { translateUiSource } from '../../../scripts/chinese-ui-plugin';

function Labels() {
  const { lang, setLang, t } = useTranslation();
  return (
    <>
      <span>{t('General')}</span>
      <output>{lang}</output>
      <button onClick={() => setLang(lang === 'en' ? 'zh-CN' : 'en')}>switch</button>
    </>
  );
}
beforeEach(() => {
  setGlobalLang('zh-CN');
});
afterEach(cleanup);
describe('runtime language preference', () => {
  it('switches both directions and keeps global toasts and persisted preference in sync', () => {
    render(
      <LanguageProvider>
        <Labels />
      </LanguageProvider>
    );
    expect(screen.getByText('常规')).toBeInTheDocument();
    fireEvent.click(screen.getByText('switch'));
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(tGlobal('General')).toBe('General');
    expect(localStorage.getItem('zhenxia_lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    fireEvent.click(screen.getByText('switch'));
    expect(screen.getByText('常规')).toBeInTheDocument();
    expect(tGlobal('General')).toBe('常规');
  });
  it('updates existing subscribers after another document changes language', () => {
    render(<Labels />);
    act(() =>
      window.dispatchEvent(new StorageEvent('storage', { key: 'zhenxia_lang', newValue: 'en' }))
    );
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(tGlobal('General')).toBe('General');
  });
});
describe('UI source transformation', () => {
  const id = 'C:/project/frontend/src/components/Example.tsx';
  it('keeps canonical keys reversible rather than baking Chinese into the build', () => {
    const output = translateUiSource(
      'export function Example(){ return <button title="Settings">General</button> }',
      id
    )!;
    expect(output).toContain('__uiT("General")');
    expect(output).toContain('__uiT("Settings")');
    expect(output).toContain('__useUiLanguage()');
    expect(output).not.toContain('常规');
  });
  it('does not translate user data, internal values or existing translation keys', () => {
    const output = translateUiSource(
      'export function Example(){ const options={value:"General",label:"General"}; return <div>{clip.content}{t("General")}</div> }',
      id
    )!;
    expect(output).toContain('value:"General"');
    expect(output).toContain('{clip.content}');
    expect(output).toContain('t("General")');
    expect(output).toContain('get label()');
  });
});
