import { useLayoutEffect } from 'react';
import { type ColorTheme, useSystemTheme } from './useSystemTheme';

export function useTheme(theme: string, systemTheme?: ColorTheme): ColorTheme {
  const nativeTheme = useSystemTheme(systemTheme === undefined);
  const effectiveTheme = theme === 'light' || theme === 'dark' ? theme : (systemTheme ?? nativeTheme);

  useLayoutEffect(() => {
    const { classList } = document.documentElement;
    classList.toggle('light', effectiveTheme === 'light');
    classList.toggle('dark', effectiveTheme === 'dark');
  }, [effectiveTheme]);

  return effectiveTheme;
}
