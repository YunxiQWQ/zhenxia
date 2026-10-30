import { useState } from 'react';
import { useTranslation } from '../i18n';
import type { Watermark } from '../editor/watermark';
export function WatermarkPanel({
  value,
  onChange,
  onApply,
  onCancel,
}: {
  value: Watermark;
  onChange: (v: Watermark) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { lang } = useTranslation(),
    t = (cn: string, en: string) => (lang === 'zh-CN' ? cn : en),
    [error, setError] = useState('');
  const patch = (p: Partial<Watermark>) => onChange({ ...value, ...p });
  return (
    <div
      className="ie-modal-backdrop"
      onKeyDownCapture={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('水印设置', 'Watermark settings')}
        className="max-h-[90vh] w-[440px] max-w-[94vw] space-y-3 overflow-auto rounded-xl border border-border bg-background p-5 text-sm text-foreground shadow-xl"
      >
        <h2 className="font-semibold">{t('水印 · 实时预览', 'Watermark · live preview')}</h2>
        <label className="block">
          {t('文字', 'Text')}
          <input
            className="mt-1 w-full rounded border border-border bg-background p-2"
            value={value.text}
            maxLength={200}
            placeholder={t('填写水印文字', 'Watermark text')}
            onChange={(e) => patch({ text: e.target.value, image: undefined })}
          />
        </label>
        <label className="block text-xs">
          {t('或选择图片水印（PNG / JPEG）', 'Or choose an image watermark (PNG / JPEG)')}
          <input
            className="mt-1 block w-full text-xs"
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 16 * 1024 * 1024)
                  throw Error(t('图片不能超过16 MB', 'Image must be at most 16 MB'));
                const bitmap = await createImageBitmap(file, {
                  resizeWidth: 512,
                  resizeQuality: 'high',
                });
                const c = document.createElement('canvas');
                c.width = bitmap.width;
                c.height = bitmap.height;
                c.getContext('2d')!.drawImage(bitmap, 0, 0);
                bitmap.close();
                patch({ image: c });
                setError('');
              } catch (e) {
                setError(String(e));
              }
            }}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label>
            {t('颜色', 'Color')}{' '}
            <input
              type="color"
              value={value.color}
              onChange={(e) => patch({ color: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.tiled}
              onChange={(e) => patch({ tiled: e.target.checked })}
            />
            {t('平铺', 'Tile')}
          </label>
        </div>
        {(
          [
            { key: 'opacity', label: t('透明度', 'Opacity'), min: 0.05, max: 1, step: 0.05 },
            { key: 'fontSize', label: t('字号', 'Font size'), min: 12, max: 120, step: 1 },
            { key: 'angle', label: t('角度', 'Angle'), min: -90, max: 90, step: 1 },
            {
              key: 'imageScale',
              label: t('图片宽度占比', 'Image width ratio'),
              min: 0.05,
              max: 0.6,
              step: 0.05,
            },
          ] as const
        )
          .filter((f) => (value.image ? f.key !== 'fontSize' : f.key !== 'imageScale'))
          .map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3 text-xs">
              <span>
                {f.label} · {value[f.key].toFixed(f.step < 1 ? 2 : 0)}
              </span>
              <input
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={value[f.key]}
                onChange={(e) => patch({ [f.key]: Number(e.target.value) })}
              />
            </label>
          ))}
        {!value.tiled && (
          <label className="flex items-center justify-between">
            {t('位置', 'Position')}
            <select
              className="rounded border border-border bg-background p-1"
              value={value.position}
              onChange={(e) => patch({ position: e.target.value as Watermark['position'] })}
            >
              {[
                ['top-left', '左上', 'Top left'],
                ['top-right', '右上', 'Top right'],
                ['center', '居中', 'Center'],
                ['bottom-left', '左下', 'Bottom left'],
                ['bottom-right', '右下', 'Bottom right'],
              ].map(([v, cn, en]) => (
                <option key={v} value={v}>
                  {t(cn, en)}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border border-border px-3 py-2" onClick={onCancel}>
            {t('取消', 'Cancel')}
          </button>
          <button
            className="rounded bg-primary px-3 py-2 text-primary-foreground"
            disabled={!value.text && !value.image}
            onClick={onApply}
          >
            {t('应用水印', 'Apply watermark')}
          </button>
        </div>
      </section>
    </div>
  );
}
