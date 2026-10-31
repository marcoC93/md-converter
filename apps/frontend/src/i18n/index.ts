import { computed, ref } from 'vue';
import { it } from './it';

export type MessageKey = keyof typeof it;
/** Ogni lingua deve fornire tutte le chiavi del dizionario italiano: TypeScript lo verifica. */
export type Messages = Record<MessageKey, string>;

/**
 * Lingue disponibili. Per aggiungerne una:
 * 1. crea `src/i18n/en.ts` con `export const en: Messages = { ... }`;
 * 2. aggiungila qui sotto: `en: { label: 'English', messages: en }`.
 */
const LOCALES = {
  it: { label: 'Italiano', messages: it as Messages },
} satisfies Record<string, { label: string; messages: Messages }>;

export type Locale = keyof typeof LOCALES;

const currentLocale = ref<Locale>('it');

export type MessageParams = Record<string, string | number>;

export function translate(messages: Messages, key: MessageKey, params: MessageParams = {}): string {
  return messages[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function isMessageKey(key: string): key is MessageKey {
  return key in it;
}

export function useI18n() {
  const messages = computed(() => LOCALES[currentLocale.value].messages);
  const t = (key: MessageKey, params?: MessageParams) => translate(messages.value, key, params);
  /** Traduce una chiave costruita a runtime (es. `status.${stato}`), con un testo di ripiego. */
  const tDynamic = (key: string, fallback: string, params?: MessageParams) =>
    isMessageKey(key) ? t(key, params) : fallback;
  return { t, tDynamic, locale: currentLocale };
}
