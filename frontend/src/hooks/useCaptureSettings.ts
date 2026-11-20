import { capturePreferences } from '../utils/capturePreferences';
import { useWindowSettings } from './useWindowSettings';
import { useTheme } from './useTheme';
import { useSystemTheme } from './useSystemTheme';
export function useCaptureSettings() {
  const settings = useWindowSettings();
  const systemTheme = useSystemTheme();
  const effectiveTheme = useTheme(settings?.theme ?? 'system', systemTheme);
  return { settings, preferences: capturePreferences(settings), effectiveTheme, systemTheme };
}
