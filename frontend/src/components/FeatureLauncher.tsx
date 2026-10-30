import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ScanLine, Video, Presentation, Shapes } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
export function FeatureLauncher() {
  const { lang } = useTranslation(),
    [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    t = (cn: string, en: string) => (lang === 'zh-CN' ? cn : en);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  return (
    <div className="relative" ref={root}>
      <button
        aria-label={t('截图工具', 'Capture tools')}
        title={t('截图工具', 'Capture tools')}
        className="rounded-lg p-2 hover:bg-accent"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Shapes size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 w-52 rounded-xl border border-border bg-background p-1 shadow-lg">
          {[
            { id: 'scroll', cn: '长截图', en: 'Scrolling capture', Icon: ScanLine },
            { id: 'record', cn: '录屏', en: 'Screen recording', Icon: Video },
            {
              id: 'presentation',
              cn: '演示画布 / 恢复操作',
              en: 'Presentation / restore',
              Icon: Presentation,
            },
          ].map(({ id, cn, en, Icon }) => (
            <button
              key={id}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-accent"
              onClick={() => {
                setOpen(false);
                void invoke(
                  id === 'presentation' ? 'start_presentation' : 'start_workflow_capture',
                  id === 'presentation' ? {} : { kind: id }
                ).catch((e) => toast.error(String(e)));
              }}
            >
              <Icon size={15} />
              {t(cn, en)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
