<script setup lang="ts">
import { computed } from 'vue';
import { useConversionQueue } from '../composables/useConversionQueue';
import { useI18n } from '../i18n';

const { t, tDynamic } = useI18n();
const queue = useConversionQueue();
const { rows, started, starting, canStart, completedCount, isFinished, lastError } = queue;

const hasActive = computed(() =>
  rows.value.some((row) => ['queued', 'converting'].includes(row.status)),
);
const showNoReadyHint = computed(
  () =>
    !started.value &&
    rows.value.length > 0 &&
    !canStart.value &&
    !starting.value &&
    queue.readyCount.value === 0,
);
const errorText = computed(() =>
  lastError.value ? tDynamic(`error.${lastError.value.code}`, lastError.value.message) : '',
);
</script>

<template>
  <div class="actions">
    <p v-if="errorText" class="notice notice--error" role="alert" data-testid="global-error">
      <span aria-hidden="true">✕</span
      ><span
        >{{ errorText }}
        <template v-if="lastError?.details">{{ lastError.details }}</template></span
      >
    </p>
    <p v-if="showNoReadyHint" class="actions__hint">{{ t('actions.noReadyFiles') }}</p>
    <div class="actions__buttons">
      <button
        v-if="!started"
        type="button"
        class="button button--primary"
        :disabled="!canStart"
        data-testid="start"
        @click="queue.start()"
      >
        {{ starting ? t('actions.starting') : t('actions.start') }}
      </button>
      <button
        v-if="hasActive"
        type="button"
        class="button"
        data-testid="cancel-all"
        @click="queue.cancelAll()"
      >
        {{ t('actions.cancelAll') }}
      </button>
      <button
        v-if="completedCount > 0"
        type="button"
        class="button"
        data-testid="download-all"
        @click="queue.downloadAll()"
      >
        {{ t('actions.downloadAll') }}
      </button>
      <button
        v-if="started || rows.length > 0"
        type="button"
        class="button"
        :class="{ 'button--primary': isFinished }"
        data-testid="new-conversion"
        @click="queue.reset()"
      >
        {{ t('actions.newConversion') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.actions {
  margin-top: 1rem;
  border-top: 1px solid var(--color-border);
  padding-top: 1rem;
}

.actions__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.actions__hint {
  color: var(--color-text-muted);
  margin: 0 0 0.5rem;
}
</style>
