<script setup lang="ts">
import { CONVERSION_MODES, DOCUMENT_FORMATS, IMAGE_MODES } from '@md-converter/shared';
import { computed } from 'vue';
import { useConversionQueue } from '../composables/useConversionQueue';
import { useDiagnostics } from '../composables/useDiagnostics';
import { useI18n } from '../i18n';
import { formatBytes } from '../utils/format';
import OcrOptions from './OcrOptions.vue';

const { t } = useI18n();
const queue = useConversionQueue();
const { options, config, started, hasPdf } = queue;
const diagnostics = useDiagnostics();

const isMarkdownOutput = computed(() => options.outputFormat === 'markdown');
const embedLimit = computed(() =>
  config.value ? formatBytes(config.value.maxEmbeddedImagesBytes, t) : '',
);
const showPdfNotice = computed(() => hasPdf.value && options.outputFormat !== 'pdf');
</script>

<template>
  <div>
    <h2 id="options-title">{{ t('options.title') }}</h2>

    <fieldset :disabled="started">
      <legend>{{ t('options.outputFormat') }}</legend>
      <label v-for="format in DOCUMENT_FORMATS" :key="format" class="choice">
        <input
          v-model="options.outputFormat"
          type="radio"
          name="output-format"
          :value="format"
          :data-testid="`format-${format}`"
        />
        <span>{{ t(`format.${format}`) }}</span>
      </label>
    </fieldset>

    <fieldset :disabled="started">
      <legend>{{ t('options.mode') }}</legend>
      <label v-for="mode in CONVERSION_MODES" :key="mode" class="choice">
        <input
          v-model="options.mode"
          type="radio"
          name="mode"
          :value="mode"
          :aria-describedby="`mode-${mode}-description`"
          :data-testid="`mode-${mode}`"
        />
        <span>
          {{ t(`mode.${mode}`) }}
          <span :id="`mode-${mode}-description`" class="choice__description">{{
            t(`mode.${mode}.description`)
          }}</span>
        </span>
      </label>
    </fieldset>

    <div v-if="showPdfNotice" class="notice notice--info" data-testid="pdf-notice">
      <span aria-hidden="true">ℹ</span>
      <p>
        {{ t('notice.pdf') }}
        <template v-if="options.outputFormat === 'docx' && options.mode === 'high-fidelity'">
          {{ t('notice.pdfHighFidelity') }}</template
        >
      </p>
    </div>

    <details class="advanced" data-testid="advanced-options">
      <summary>{{ t('options.advanced') }}</summary>

      <fieldset :disabled="started || !isMarkdownOutput" aria-describedby="images-only-markdown">
        <legend>{{ t('options.images') }}</legend>
        <p v-if="!isMarkdownOutput" id="images-only-markdown" class="choice__description">
          {{ t('options.images.onlyMarkdown') }}
        </p>
        <label v-for="mode in IMAGE_MODES" :key="mode" class="choice">
          <input
            v-model="options.imageMode"
            type="radio"
            name="image-mode"
            :value="mode"
            :data-testid="`images-${mode}`"
          />
          <span>
            {{ t(`images.${mode}`) }}
            <span class="choice__description">{{
              t(`images.${mode}.description`, { limit: embedLimit })
            }}</span>
          </span>
        </label>
      </fieldset>

      <OcrOptions
        :disabled="started"
        :ocr-available="diagnostics.ocrAvailable.value"
        :installed-languages="diagnostics.ocrLanguages.value"
      />
    </details>
  </div>
</template>

<style scoped>
.advanced {
  border-top: 1px solid var(--color-border);
  padding-top: 0.75rem;
  margin-top: 0.5rem;
}

.advanced summary {
  cursor: pointer;
  font-weight: 700;
  min-height: 44px;
  display: flex;
  align-items: center;
}

.advanced[open] summary {
  margin-bottom: 0.5rem;
}

.notice p {
  margin: 0;
}
</style>
