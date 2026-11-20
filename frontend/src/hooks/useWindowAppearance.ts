import { useTheme } from './useTheme';
import { useSystemAccent } from './useSystemAccent';
import { useWindowSettings } from './useWindowSettings';
import { windowMaterial } from '../utils/windowMaterial';

export function useWindowAppearance() {
  const settings = useWindowSettings();
  const effectiveTheme = useTheme(settings?.theme ?? 'system');
  const material = windowMaterial(settings?.mica_effect);
  useSystemAccent();
  return { settings, effectiveTheme, material };
}
