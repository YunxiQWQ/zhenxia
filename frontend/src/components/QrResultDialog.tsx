import { useEffect, useRef } from 'react';
import { Copy, ScanQrCode, X } from 'lucide-react';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';

export function QrResultDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const { lang } = useTranslation();
  const zh = lang === 'zh-CN';
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="absolute inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
        if (e.key === 'Tab') {
          const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button');
          if (!buttons?.length) return;
          const index = [...buttons].indexOf(document.activeElement as HTMLButtonElement);
          e.preventDefault();
          buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
        }
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={zh ? '二维码结果' : 'QR results'}
        data-el="qr-result"
        className="max-h-[80%] w-full max-w-lg overflow-auto rounded-xl border border-border bg-background p-4 text-foreground shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <strong className="flex items-center gap-2 text-sm">
            <ScanQrCode size={17} />
            {zh ? '扫一扫' : 'Scan QR code'}
          </strong>
          <button
            type="button"
            aria-label={zh ? '关闭二维码结果' : 'Close QR results'}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {codes.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">
            {zh
              ? '未识别到二维码，请选择包含完整二维码的区域。'
              : 'No QR code found. Select a region containing the entire code.'}
          </p>
        ) : (
          codes.map((code, index) => (
            <div key={index} className="mb-3 rounded-lg border border-border p-3">
              <textarea
                readOnly
                value={code}
                aria-label={`${zh ? '二维码内容' : 'QR content'} ${index + 1}`}
                className="min-h-24 w-full select-text resize-y break-all bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                className="mt-2 flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(code)
                    .then(() => toast.success(zh ? '已复制' : 'Copied'))
                    .catch((e) => toast.error(String(e)))
                }
              >
                <Copy size={13} />
                {zh ? '复制内容' : 'Copy content'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
