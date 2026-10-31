<script setup lang="ts">
import { computed } from 'vue';
import { useConversionQueue } from '../composables/useConversionQueue';
import { useI18n } from '../i18n';

const props = defineProps<{
  disabled: boolean;
  ocrAvailable: boolean;
  installedLanguages: string[];
}>();

const { t, tDynamic } = useI18n();
const { options, config, ocrLanguagesValid } = useConversionQueue();

const allowedLanguages = computed(() => config.value?.allowedOcrLanguages ?? ['ita', 'eng']);
const isInstalled = (code: string) => props.installedLanguages.includes(code);
</script>

<template>
  <fieldset :disabled="disabled" class="ocr">
    <legend>{{ t('options.ocr') }}</legend>
    <p id="ocr-description" class="choice__description">{{ t('options.ocr.description') }}</p>
    <p v-if="!ocrAvailable" class="notice notice--warning" data-testid="ocr-unavailable">
      {{ t('options.ocr.unavailable') }}
    </p>

    <label class="choice">
      <input
        v-model="options.ocr.enabled"
        type="checkbox"
        role="switch"
        aria-describedby="ocr-description"
        data-testid="ocr-toggle"
      />
      <span>{{ t('options.ocr.enable') }}</span>
    </label>

    <fieldset
      v-if="options.ocr.enabled"
      class="ocr__languages"
      :aria-invalid="!ocrLanguagesValid"
      aria-describedby="ocr-language-error"
    >
      <legend>{{ t('options.ocr.languages') }}</legend>
      <label v-for="code in allowedLanguages" :key="code" class="choice">
        <input
          v-model="options.ocr.languages"
          type="checkbox"
          :value="code"
          :disabled="ocrAvailable && !isInstalled(code)"
          :data-testid="`ocr-language-${code}`"
        />
        <span>
          {{ tDynamic(`language.${code}`, code) }}
          <span v-if="ocrAvailable && !isInstalled(code)" class="choice__description">{{
            t('options.ocr.notInstalled')
          }}</span>
        </span>
      </label>
      <p
        v-if="!ocrLanguagesValid"
        id="ocr-language-error"
        class="notice notice--error"
        role="alert"
      >
        {{ t('options.ocr.needLanguage') }}
      </p>
    </fieldset>

    <label v-if="options.ocr.enabled" class="choice">
      <input v-model="options.ocr.force" type="checkbox" aria-describedby="ocr-force-description" />
      <span>
        {{ t('options.ocr.force') }}
        <span id="ocr-force-description" class="choice__description">{{
          t('options.ocr.forceDescription')
        }}</span>
      </span>
    </label>
  </fieldset>
</template>

<style scoped>
.ocr__languages {
  margin-left: 1.75rem;
}
</style>
