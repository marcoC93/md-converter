<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import AppHeader from './components/AppHeader.vue';
import ConversionOptions from './components/ConversionOptions.vue';
import DiagnosticsPanel from './components/DiagnosticsPanel.vue';
import DropZone from './components/DropZone.vue';
import FileQueue from './components/FileQueue.vue';
import LiveAnnouncer from './components/LiveAnnouncer.vue';
import QueueActions from './components/QueueActions.vue';
import { useAnnouncer } from './composables/useAnnouncer';
import { useConversionQueue } from './composables/useConversionQueue';
import { useDiagnostics } from './composables/useDiagnostics';
import { useQueueAnnouncements } from './composables/useQueueAnnouncements';
import { useI18n } from './i18n';

const { t } = useI18n();
const queue = useConversionQueue();
const diagnostics = useDiagnostics();
const { announce } = useAnnouncer();
const diagnosticsOpen = ref(false);

useQueueAnnouncements(queue);

function onFiles(files: File[]) {
  const added = queue.addFiles(files);
  if (added > 0) announce(t('drop.added', { count: added }));
}

onMounted(async () => {
  await Promise.all([queue.init(), diagnostics.load()]);
});
onBeforeUnmount(() => queue.dispose());
</script>

<template>
  <a class="skip-link" href="#main">{{ t('app.skipToContent') }}</a>
  <AppHeader
    :diagnostics-open="diagnosticsOpen"
    @toggle-diagnostics="diagnosticsOpen = !diagnosticsOpen"
  />
  <main id="main" class="main" tabindex="-1">
    <p class="privacy">{{ t('app.privacy') }}</p>
    <DiagnosticsPanel v-if="diagnosticsOpen" @close="diagnosticsOpen = false" />
    <div class="layout">
      <section class="panel layout__queue" aria-labelledby="queue-title">
        <DropZone :disabled="queue.started.value" @files="onFiles" />
        <FileQueue />
        <QueueActions />
      </section>
      <aside class="panel layout__options" aria-labelledby="options-title">
        <ConversionOptions />
      </aside>
    </div>
  </main>
  <LiveAnnouncer />
</template>

<style scoped>
.main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}

.main:focus {
  outline: none;
}

.privacy {
  color: var(--color-text-muted);
  margin: 0 0 1rem;
}

.layout {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 900px) {
  .layout {
    grid-template-columns: minmax(0, 3fr) minmax(300px, 2fr);
    align-items: start;
  }

  .layout__options {
    position: sticky;
    top: 1rem;
  }
}
</style>
