<script setup lang="ts">
import { useConversionQueue } from '../composables/useConversionQueue';
import { useI18n } from '../i18n';
import FileQueueItem from './FileQueueItem.vue';

const { t } = useI18n();
const { rows, completedCount, failedCount } = useConversionQueue();
</script>

<template>
  <div class="queue">
    <h2 id="queue-title">{{ t('queue.title') }}</h2>
    <p v-if="rows.length === 0" class="queue__empty">{{ t('queue.empty') }}</p>
    <template v-else>
      <p class="queue__summary" data-testid="queue-summary">
        {{
          t('queue.summary', { total: rows.length, completed: completedCount, failed: failedCount })
        }}
      </p>
      <ul class="queue__list" :aria-label="t('queue.title')">
        <FileQueueItem v-for="row in rows" :key="row.item.localId" :row="row" />
      </ul>
    </template>
  </div>
</template>

<style scoped>
.queue {
  margin-top: 1.25rem;
}

.queue__empty,
.queue__summary {
  color: var(--color-text-muted);
  margin: 0 0 0.5rem;
}

.queue__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
</style>
