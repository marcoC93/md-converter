<script setup lang="ts">
import type { ToolStatus } from '@md-converter/shared';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useDiagnostics } from '../composables/useDiagnostics';
import { useI18n } from '../i18n';

const emit = defineEmits<{ close: [] }>();
const { t, tDynamic } = useI18n();
const { report, loading, error, load } = useDiagnostics();
const heading = ref<HTMLHeadingElement | null>(null);

const checkedAt = computed(() =>
  report.value ? new Date(report.value.checkedAt).toLocaleString('it-IT') : '',
);

function installHint(tool: ToolStatus): string {
  const platform = report.value?.platform ?? 'other';
  return platform === 'other'
    ? t('install.other')
    : tDynamic(`install.${platform}.${tool.id}`, t('install.other'));
}

onMounted(async () => {
  // Il focus va sul titolo del pannello appena aperto, così chi usa la tastiera o uno screen reader lo trova subito.
  await nextTick();
  heading.value?.focus();
});
</script>

<template>
  <section
    id="diagnostics-panel"
    class="panel diagnostics"
    aria-labelledby="diagnostics-title"
    data-testid="diagnostics-panel"
    @keydown.esc="emit('close')"
  >
    <div class="diagnostics__header">
      <h2 id="diagnostics-title" ref="heading" tabindex="-1">{{ t('diagnostics.title') }}</h2>
      <div class="diagnostics__buttons">
        <button type="button" class="button button--small" :disabled="loading" @click="load(true)">
          {{ t('diagnostics.refresh') }}
        </button>
        <button type="button" class="button button--small" @click="emit('close')">
          {{ t('diagnostics.close') }}
        </button>
      </div>
    </div>

    <p v-if="loading" aria-live="polite">{{ t('diagnostics.loading') }}</p>
    <p v-else-if="error" class="notice notice--error" role="alert">
      {{ tDynamic(`error.${error.code}`, error.message) }}
    </p>

    <template v-if="report && !loading">
      <p class="diagnostics__meta">{{ t('diagnostics.checkedAt', { time: checkedAt }) }}</p>
      <ul class="diagnostics__tools">
        <li
          v-for="tool in report.tools"
          :key="tool.id"
          class="tool"
          :data-testid="`tool-${tool.id}`"
        >
          <h3 class="tool__name">
            {{ t(`tool.${tool.id}`) }}
            <span :class="tool.available ? 'tool__ok' : 'tool__ko'">
              <span aria-hidden="true">{{ tool.available ? '✓' : '✕' }}</span>
              {{ tool.available ? t('diagnostics.available') : t('diagnostics.unavailable') }}
            </span>
          </h3>
          <dl class="tool__details">
            <template v-if="tool.version">
              <dt>{{ t('diagnostics.version') }}</dt>
              <dd>{{ tool.version }}</dd>
            </template>
            <template v-if="tool.displayPath">
              <dt>{{ t('diagnostics.path') }}</dt>
              <dd>
                <code>{{ tool.displayPath }}</code>
              </dd>
            </template>
            <dt>{{ t('diagnostics.enables') }}</dt>
            <dd>
              {{
                tool.enables.map((feature) => tDynamic(`feature.${feature}`, feature)).join(', ')
              }}
            </dd>
            <template v-if="tool.languages">
              <dt>{{ t('diagnostics.languages') }}</dt>
              <dd>{{ tool.languages.join(', ') || t('diagnostics.none') }}</dd>
            </template>
            <template v-if="!tool.available">
              <dt>{{ t('diagnostics.install') }}</dt>
              <dd>
                <span v-if="tool.problem">{{
                  tDynamic(`diagnostics.problem.${tool.problem}`, tool.problem)
                }}</span>
                <code class="tool__install">{{ installHint(tool) }}</code>
              </dd>
            </template>
          </dl>
        </li>
      </ul>

      <h3>{{ t('diagnostics.capabilities') }}</h3>
      <ul class="diagnostics__capabilities">
        <li v-for="capability in report.capabilities" :key="`${capability.from}-${capability.to}`">
          <span aria-hidden="true">{{
            capability.simple || capability.highFidelity ? '✓' : '✕'
          }}</span>
          {{ t(`format.${capability.from}`) }} → {{ t(`format.${capability.to}`) }}:
          {{ capability.simple ? t('mode.simple') : ''
          }}{{ capability.simple && capability.highFidelity ? ', ' : ''
          }}{{ capability.highFidelity ? t('mode.high-fidelity') : '' }}
          {{ !capability.simple && !capability.highFidelity ? t('diagnostics.unavailable') : '' }}
          <template v-if="capability.ocr"> (+ OCR)</template>
        </li>
      </ul>
      <p>
        {{
          t('diagnostics.ocrLanguagesUsable', {
            languages: report.ocrLanguages.join(', ') || t('diagnostics.none'),
          })
        }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.diagnostics {
  margin-bottom: 1rem;
}

.diagnostics__header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
}

.diagnostics__header h2:focus {
  outline: none;
}

.diagnostics__buttons {
  display: flex;
  gap: 0.5rem;
}

.diagnostics__meta {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.diagnostics__tools {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.tool {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 0.75rem;
}

.tool__name {
  font-size: 1rem;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.tool__ok {
  color: var(--color-success);
}

.tool__ko {
  color: var(--color-error);
}

.tool__details {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 0.75rem;
  font-size: 0.875rem;
}

.tool__details dt {
  color: var(--color-text-muted);
}

.tool__details dd {
  margin: 0;
  min-width: 0;
}

.tool__install {
  display: block;
  margin-top: 0.25rem;
}

.diagnostics__capabilities {
  padding-left: 1rem;
}
</style>
