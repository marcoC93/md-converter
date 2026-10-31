import { ref, watch } from 'vue';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = 'md-converter-theme';

function readSavedTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(saved as Theme) ? (saved as Theme) : 'system';
  } catch {
    return 'system';
  }
}

const theme = ref<Theme>(readSavedTheme());

watch(
  theme,
  (value) => {
    // Il CSS usa [data-theme]: "system" lascia decidere a prefers-color-scheme.
    document.documentElement.setAttribute('data-theme', value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Preferenza non salvabile (es. navigazione privata): il tema vale per la sessione corrente.
    }
  },
  { immediate: true },
);

export function useTheme() {
  return { theme };
}
