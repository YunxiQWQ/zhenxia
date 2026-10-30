import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Shapes } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { ContextMenu } from './ContextMenu';

export function FeatureLauncher({ active = true }: { active?: boolean }) {
  const { lang } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const text = (cn: string, en: string) => (lang === 'zh-CN' ? cn : en);
  useEffect(() => {
    if (!active) setMenu(null);
  }, [active]);
  return (
    <>
      <button
        aria-label={text('截图工具', 'Capture tools')}
        title={text('截图工具', 'Capture tools')}
        className="icon-button"
        aria-expanded={!!menu}
        aria-haspopup="menu"
        onClick={(event) => {
          const r = event.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: r.right, y: r.bottom });
        }}
      >
        <Shapes size={15} />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          kind="history"
          label={text('截图工具', 'Capture tools')}
          onClose={() => setMenu(null)}
          options={[
            { id: 'scroll', cn: '长截图', en: 'Scrolling capture' },
            { id: 'record', cn: '录屏', en: 'Screen recording' },
            { id: 'presentation', cn: '演示画布 / 恢复操作', en: 'Presentation / restore' },
          ].map(({ id, cn, en }) => ({
            label: text(cn, en),
            onClick: () => {
              void invoke(
                id === 'presentation' ? 'start_presentation' : 'start_workflow_capture',
                id === 'presentation' ? {} : { kind: id }
              ).catch((e) => toast.error(String(e)));
            },
          }))}
        />
      )}
    </>
  );
}
