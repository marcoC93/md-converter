import { ref } from 'vue';

/**
 * Messaggi per le tecnologie assistive. Il componente LiveAnnouncer li legge in due regioni
 * `aria-live`: "polite" per gli aggiornamenti, "assertive" per gli errori.
 */
const politeMessage = ref('');
const assertiveMessage = ref('');

function setMessage(target: typeof politeMessage, message: string) {
  // Svuotare e poi riempire forza la lettura anche se il testo è uguale al precedente.
  target.value = '';
  window.setTimeout(() => {
    target.value = message;
  }, 50);
}

export function useAnnouncer() {
  return {
    politeMessage,
    assertiveMessage,
    announce: (message: string) => setMessage(politeMessage, message),
    announceError: (message: string) => setMessage(assertiveMessage, message),
  };
}
