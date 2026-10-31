<script setup lang="ts">
import { useI18n } from '../i18n';
import ThemeSwitcher from './ThemeSwitcher.vue';

defineProps<{ diagnosticsOpen: boolean }>();
defineEmits<{ 'toggle-diagnostics': [] }>();

const { t } = useI18n();
</script>

<template>
  <header class="header">
    <div class="header__inner">
      <div>
        <h1 class="header__title">{{ t('app.title') }}</h1>
        <p class="header__subtitle">{{ t('app.subtitle') }}</p>
      </div>
      <div class="header__tools">
        <ThemeSwitcher />
        <button
          type="button"
          class="button button--small"
          :aria-expanded="diagnosticsOpen"
          aria-controls="diagnostics-panel"
          data-testid="toggle-diagnostics"
          @click="$emit('toggle-diagnostics')"
        >
          {{ diagnosticsOpen ? t('diagnostics.close') : t('diagnostics.open') }}
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.header__inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}

.header__title {
  font-size: 1.5rem;
  margin: 0;
}

.header__subtitle {
  margin: 0;
  color: var(--color-text-muted);
}

.header__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}
</style>
