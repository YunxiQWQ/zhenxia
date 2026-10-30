import { zhCN } from './zh-CN';
/**
 * 帧匣 Zhenxia — i18n 词条包（英文，回退 / 源语言）
 * 英文为源语言，t() 找不到翻译时回退到 key 本身，因此此包可为空对象。
 * 保留导出以便未来需要覆盖英文措辞时使用。
 */
export const en: Record<string, string> = { Cubby: 'Zhenxia' };

for (const key of Object.keys(zhCN)) {
  if (key.includes('Cubby') && !/GPL|©|fork|copyright/i.test(key))
    en[key] = key.replace(/Cubby/g, 'Zhenxia');
}
