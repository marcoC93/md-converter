import type { ConversionCapability, DiagnosticsReport, DocumentFormat } from '@md-converter/shared';
import { computed, ref } from 'vue';
import { api, ApiError } from '../api/client';

const report = ref<DiagnosticsReport | null>(null);
const loading = ref(false);
const error = ref<ApiError | null>(null);

async function load(refresh = false): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    report.value = await api.getDiagnostics(refresh);
  } catch (caught) {
    error.value =
      caught instanceof ApiError
        ? caught
        : new ApiError('NETWORK_ERROR', 'Servizio non raggiungibile.', 0);
  } finally {
    loading.value = false;
  }
}

export function useDiagnostics() {
  const ocrAvailable = computed(
    () => report.value?.capabilities.some((capability) => capability.ocr) ?? false,
  );
  const ocrLanguages = computed(() => report.value?.ocrLanguages ?? []);

  function capability(from: DocumentFormat, to: DocumentFormat): ConversionCapability | undefined {
    return report.value?.capabilities.find((entry) => entry.from === from && entry.to === to);
  }

  return { report, loading, error, load, ocrAvailable, ocrLanguages, capability };
}
