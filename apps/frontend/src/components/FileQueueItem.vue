<script setup lang="ts">
import { computed } from 'vue';
import { useConversionQueue, type QueueRow } from '../composables/useConversionQueue';
import { useDiagnostics } from '../composables/useDiagnostics';
import { useI18n } from '../i18n';
import { formatBytes } from '../utils/format';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ row: QueueRow }>();

const { t, tDynamic } = useI18n();
const queue = useConversionQueue();
const diagnostics = useDiagnostics();

const status = computed(() => props.row.status);
const canCancel = computed(() =>
  ['uploading', 'validating', 'queued', 'converting'].includes(status.value),
);
const canRemove = computed(
  () => !queue.started.value || ['completed', 'failed', 'cancelled'].includes(status.value),
);
const progress = computed(() =>
  status.value === 'uploading'
    ? props.row.item.uploadProgress
    : (props.row.server?.progress ?? null),
);
const showProgress = computed(() => status.value === 'uploading' || status.value === 'converting');
const stage = computed(() =>
  props.row.server?.stage
    ? tDynamic(`stage.${props.row.server.stage}`, props.row.server.stage)
    : '',
);
const errorMessage = computed(() =>
  props.row.error ? tDynamic(`error.${props.row.error.code}`, props.row.error.message) : '',
);
const ocrSuggested = computed(
  () =>
    props.row.server?.pdfAnalysis?.ocrSuggested &&
    !queue.options.ocr.enabled &&
    !queue.started.value,
);

/** Avviso preventivo: la conversione scelta richiede uno strumento non installato. */
const availabilityWarning = computed(() => {
  if (queue.started.value || status.value !== 'ready') return '';
  const from = queue.inputFormatOf(props.row);
  if (!from) return '';
  if (from === queue.options.outputFormat) return t('queue.sameFormat');
  const capability = diagnostics.capability(from, queue.options.outputFormat);
  if (!capability) return '';
  const available = queue.options.mode === 'simple' ? capability.simple : capability.highFidelity;
  if (!available) {
    const missing =
      diagnostics.report.value?.tools
        .filter((tool) => !tool.available)
        .map((tool) => t(`tool.${tool.id}`)) ?? [];
    return t('queue.unavailable', { tools: missing.join(', ') });
  }
  return '';
});
</script>

<template>
  <li class="item" :data-testid="`queue-item`" :data-status="status">
    <div class="item__main">
      <div class="item__info">
        <span class="item__name">{{ row.item.name }}</span>
        <span class="item__meta">
          {{ formatBytes(row.item.size, t) }}
          <template v-if="row.server?.pdfAnalysis">
            · {{ t('queue.pages', { count: row.server.pdfAnalysis.pageCount }) }}</template
          >
        </span>
      </div>
      <StatusBadge :status="status" />
    </div>

    <div v-if="showProgress" class="item__progress">
      <progress
        :value="progress ?? undefined"
        max="100"
        :aria-label="`${row.item.name}: ${t(`status.${status}`)}`"
      ></progress>
      <span class="item__stage">
        <template v-if="progress !== null">{{ progress }}%</template>
        <template v-if="stage"> {{ stage }}</template>
      </span>
    </div>

    <p v-if="errorMessage" class="notice notice--error item__notice" data-testid="item-error">
      <span aria-hidden="true">✕</span>
      <span>
        {{ errorMessage }}
        <template v-if="row.error?.details"> {{ row.error.details }}</template>
        <span v-if="row.error?.correlationId" class="item__correlation">{{
          t('error.correlation', { id: row.error.correlationId })
        }}</span>
      </span>
    </p>

    <p v-if="availabilityWarning" class="notice notice--warning item__notice">
      <span aria-hidden="true">⚠</span><span>{{ availabilityWarning }}</span>
    </p>

    <div
      v-if="ocrSuggested"
      class="notice notice--warning item__notice"
      data-testid="ocr-suggestion"
    >
      <span aria-hidden="true">⚠</span>
      <span>
        {{ t('queue.ocrSuggested') }}
        <button
          type="button"
          class="button button--small"
          @click="queue.options.ocr.enabled = true"
        >
          {{ t('queue.enableOcr') }}
        </button>
      </span>
    </div>

    <ul v-if="row.server?.result?.warnings.length" class="item__warnings">
      <li v-for="warning in row.server.result.warnings" :key="warning">
        ⚠ {{ tDynamic(`warning.${warning}`, warning) }}
      </li>
    </ul>

    <div class="item__actions">
      <button
        v-if="status === 'completed'"
        type="button"
        class="button button--primary button--small"
        :aria-label="t('queue.downloadLabel', { name: row.item.name })"
        data-testid="download-item"
        @click="queue.downloadRow(row)"
      >
        {{ t('queue.download') }}
        <span v-if="row.server?.result" class="item__result"
          >({{ row.server.result.fileName }})</span
        >
      </button>
      <button
        v-if="canCancel"
        type="button"
        class="button button--small"
        :aria-label="t('queue.cancel', { name: row.item.name })"
        @click="queue.cancelRow(row)"
      >
        {{ t('queue.cancelShort') }}
      </button>
      <button
        v-if="canRemove"
        type="button"
        class="button button--small"
        :aria-label="t('queue.remove', { name: row.item.name })"
        data-testid="remove-item"
        @click="queue.removeRow(row)"
      >
        {{ t('queue.removeShort') }}
      </button>
    </div>
  </li>
</template>

<style scoped>
.item {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 0.75rem;
  background: var(--color-surface);
}

.item__main {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
}

.item__info {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.item__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.item__meta,
.item__stage,
.item__correlation {
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}

.item__correlation {
  display: block;
}

.item__progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.item__progress progress {
  flex: 1;
  height: 0.6rem;
  accent-color: var(--color-primary);
}

.item__notice {
  margin: 0.5rem 0 0;
}

.item__warnings {
  margin: 0.5rem 0 0;
  padding-left: 0;
  list-style: none;
  color: var(--color-warning);
  font-size: 0.875rem;
}

.item__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.item__result {
  font-weight: 400;
}
</style>
