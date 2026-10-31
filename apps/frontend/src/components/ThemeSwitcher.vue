<script setup lang="ts">
import { THEMES, useTheme } from '../composables/useTheme';
import { useI18n } from '../i18n';

const { t } = useI18n();
const { theme } = useTheme();
</script>

<template>
  <fieldset class="theme-switcher">
    <legend class="visually-hidden">{{ t('theme.label') }}</legend>
    <span class="theme-switcher__label" aria-hidden="true">{{ t('theme.label') }}</span>
    <div class="theme-switcher__options">
      <label
        v-for="option in THEMES"
        :key="option"
        class="theme-switcher__option"
        :class="{ 'is-selected': theme === option }"
      >
        <input
          v-model="theme"
          type="radio"
          name="theme"
          :value="option"
          class="visually-hidden"
          :data-testid="`theme-${option}`"
        />
        <span>{{ t(`theme.${option}`) }}</span>
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.theme-switcher {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}

.theme-switcher__label {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.theme-switcher__options {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  overflow: hidden;
}

.theme-switcher__option {
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
}

.theme-switcher__option + .theme-switcher__option {
  border-left: 1px solid var(--color-border);
}

.theme-switcher__option.is-selected {
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 700;
}

/* L'input è nascosto visivamente: il focus va mostrato sull'etichetta. */
.theme-switcher__option:has(input:focus-visible) {
  outline: 3px solid var(--color-focus);
  outline-offset: -3px;
}
</style>
