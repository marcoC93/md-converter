<script setup lang="ts">
import { computed } from 'vue';
import type { ItemStatus } from '../composables/useConversionQueue';
import { useI18n } from '../i18n';

const props = defineProps<{ status: ItemStatus }>();
const { t } = useI18n();

/** Ogni stato ha un simbolo oltre al colore: l'informazione non è affidata solo al colore. */
const ICONS: Record<ItemStatus, string> = {
  uploading: '↑',
  validating: '…',
  ready: '●',
  queued: '◷',
  converting: '⟳',
  completed: '✓',
  cancelled: '⊘',
  failed: '✕',
};

const tone = computed(() => {
  if (props.status === 'completed') return 'success';
  if (props.status === 'failed') return 'error';
  if (props.status === 'cancelled') return 'muted';
  return 'info';
});
</script>

<template>
  <span class="badge" :class="`badge--${tone}`" :data-status="status">
    <span aria-hidden="true">{{ ICONS[status] }}</span>
    {{ t(`status.${status}`) }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 700;
  white-space: nowrap;
  border: 1px solid currentcolor;
}

.badge--success {
  color: var(--color-success);
  background: var(--color-success-bg);
}

.badge--error {
  color: var(--color-error);
  background: var(--color-error-bg);
}

.badge--info {
  color: var(--color-info);
  background: var(--color-info-bg);
}

.badge--muted {
  color: var(--color-text-muted);
  background: var(--color-surface-muted);
}
</style>
