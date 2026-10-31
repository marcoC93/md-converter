<script setup lang="ts">
import { useAnnouncer } from '../composables/useAnnouncer';

const { politeMessage, assertiveMessage } = useAnnouncer();
</script>

<template>
  <div class="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="live-polite">
    {{ politeMessage }}
  </div>
  <div
    class="visually-hidden"
    aria-live="assertive"
    aria-atomic="true"
    data-testid="live-assertive"
  >
    {{ assertiveMessage }}
  </div>
</template>
