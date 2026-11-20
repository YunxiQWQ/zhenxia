import { getCurrentWindow } from '@tauri-apps/api/window';
import { SettingsPanel } from '../components/SettingsPanel';
import { useWindowAppearance } from '../hooks/useWindowAppearance';

import { Toaster } from 'sonner';

export function SettingsWindow() {
  const { settings, effectiveTheme } = useWindowAppearance();

  const handleClose = async () => {
    const win = getCurrentWindow();
    try {
      await win.close();
    } catch (e) {
      console.error('Failed to close settings window:', e);
    }
  };

  if (!settings) {
    return <div className="flex h-screen items-center justify-center text-foreground">Loading...</div>;
  }

  return (
    <div className="h-screen">
      <div className="h-full overflow-hidden bg-transparent text-foreground">
        <SettingsPanel settings={settings} onClose={handleClose} />
        <Toaster
          className="settings-notifications"
          richColors
          position="bottom-center"
          theme={effectiveTheme}
        />
      </div>
    </div>
  );
}
