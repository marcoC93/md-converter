<script setup lang="ts">
import { ACCEPTED_EXTENSIONS } from '@md-converter/shared';
import { computed, ref } from 'vue';
import { useConversionQueue } from '../composables/useConversionQueue';
import { useI18n } from '../i18n';
import { formatBytes } from '../utils/format';

const props = defineProps<{ disabled: boolean }>();
const emit = defineEmits<{ files: [files: File[]] }>();

const { t } = useI18n();
const { config } = useConversionQueue();
const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const accept = ACCEPTED_EXTENSIONS.join(',');

const hint = computed(() =>
  config.value
    ? t('drop.hint', {
        maxFiles: config.value.maxFiles,
        maxSize: formatBytes(config.value.maxFileSizeBytes, t),
        maxTotal: formatBytes(config.value.maxTotalSizeBytes, t),
      })
    : '',
);

function onDrop(event: DragEvent) {
  dragging.value = false;
  if (props.disabled || !event.dataTransfer) return;
  emit('files', [...event.dataTransfer.files]);
}

function onDragOver(event: DragEvent) {
  if (props.disabled) return;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  dragging.value = true;
}

function onInputChange() {
  const files = input.value?.files;
  if (files && files.length > 0) emit('files', [...files]);
  // Svuotare il campo permette di selezionare di nuovo lo stesso file.
  if (input.value) input.value.value = '';
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ 'is-dragging': dragging, 'is-disabled': disabled }"
    data-testid="dropzone"
    @dragenter.prevent="onDragOver"
    @dragover.prevent="onDragOver"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <svg class="dropzone__icon" aria-hidden="true" viewBox="0 0 24 24" width="40" height="40">
      <path
        fill="currentColor"
        d="M19 15v4H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4zM11 4.83V16h2V4.83l3.59 3.58L18 7l-6-6-6 6 1.41 1.41z"
      />
    </svg>
    <p class="dropzone__title">{{ t('drop.title') }}</p>
    <p class="dropzone__or">{{ t('drop.or') }}</p>
    <button
      type="button"
      class="button button--primary"
      :disabled="disabled"
      aria-describedby="drop-hint"
      data-testid="choose-files"
      @click="input?.click()"
    >
      {{ t('drop.choose') }}
    </button>
    <input
      ref="input"
      class="visually-hidden"
      type="file"
      multiple
      :accept="accept"
      :disabled="disabled"
      tabindex="-1"
      aria-hidden="true"
      data-testid="file-input"
      @change="onInputChange"
    />
    <p id="drop-hint" class="dropzone__hint">{{ disabled ? t('drop.disabled') : hint }}</p>
  </div>
</template>

<style scoped>
.dropzone {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 1.5rem 1rem;
  text-align: center;
  background: var(--color-surface-muted);
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.dropzone.is-dragging {
  border-color: var(--color-primary);
  border-style: solid;
  background: var(--color-info-bg);
}

.dropzone.is-disabled {
  opacity: 0.75;
}

.dropzone__icon {
  color: var(--color-primary);
}

.dropzone__title {
  font-weight: 700;
  font-size: 1.1rem;
  margin: 0.25rem 0 0;
}

.dropzone__or {
  margin: 0.25rem 0 0.5rem;
  color: var(--color-text-muted);
}

.dropzone__hint {
  margin: 0.75rem 0 0;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}
</style>
