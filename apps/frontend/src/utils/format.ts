import type { MessageKey, MessageParams } from '../i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

/** Dimensione leggibile con le unità tradotte, es. "1,5 MB". */
export function formatBytes(bytes: number, t: Translate, locale = 'it-IT'): string {
  const format = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 });
  if (bytes < 1024) return t('units.bytes', { value: bytes });
  if (bytes < 1024 ** 2) return t('units.kb', { value: format(bytes / 1024) });
  if (bytes < 1024 ** 3) return t('units.mb', { value: format(bytes / 1024 ** 2) });
  return t('units.gb', { value: format(bytes / 1024 ** 3) });
}

/** Estensione minuscola con il punto, oppure stringa vuota. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? '' : fileName.slice(dot).toLowerCase();
}
