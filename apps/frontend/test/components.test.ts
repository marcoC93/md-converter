import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DropZone from '../src/components/DropZone.vue';
import StatusBadge from '../src/components/StatusBadge.vue';
import ThemeSwitcher from '../src/components/ThemeSwitcher.vue';
import { it as italian } from '../src/i18n/it';
import { translate, type Messages } from '../src/i18n';
import { extensionOf, formatBytes } from '../src/utils/format';

describe('i18n', () => {
  it('sostituisce i parametri e lascia intatti quelli mancanti', () => {
    const messages = italian as Messages;
    expect(translate(messages, 'queue.pages', { count: 3 })).toBe('3 pagine');
    expect(translate(messages, 'queue.pages')).toBe('{count} pagine');
  });

  it('ha un messaggio per ogni stato', () => {
    for (const status of [
      'uploading',
      'validating',
      'ready',
      'queued',
      'converting',
      'completed',
      'cancelled',
      'failed',
    ]) {
      expect(italian).toHaveProperty(`status.${status}`);
    }
  });
});

describe('format', () => {
  const t = (key: keyof typeof italian, params?: Record<string, string | number>) =>
    translate(italian as Messages, key, params);
  it('formatta le dimensioni', () => {
    expect(formatBytes(512, t)).toBe('512 B');
    expect(formatBytes(1536, t)).toBe('1,5 KB');
    expect(formatBytes(50 * 1024 * 1024, t)).toBe('50 MB');
  });

  it("estrae l'estensione", () => {
    expect(extensionOf('Relazione.DOCX')).toBe('.docx');
    expect(extensionOf('.bashrc')).toBe('');
  });
});

describe('StatusBadge', () => {
  it('mostra testo e simbolo, non solo un colore', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'failed' } });
    expect(wrapper.text()).toContain('Errore');
    expect(wrapper.text()).toContain('✕');
  });
});

describe('DropZone', () => {
  it('emette i file rilasciati', async () => {
    const wrapper = mount(DropZone, { props: { disabled: false } });
    const file = new File(['# a'], 'a.md');
    await wrapper
      .find('[data-testid=dropzone]')
      .trigger('drop', { dataTransfer: { files: [file] } });
    expect(wrapper.emitted('files')?.[0]?.[0]).toEqual([file]);
  });

  it('da disabilitata ignora i file e lo spiega', async () => {
    const wrapper = mount(DropZone, { props: { disabled: true } });
    await wrapper
      .find('[data-testid=dropzone]')
      .trigger('drop', { dataTransfer: { files: [new File(['x'], 'a.md')] } });
    expect(wrapper.emitted('files')).toBeUndefined();
    expect(wrapper.find('[data-testid=choose-files]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Nuova conversione');
  });

  it('il pulsante è associato al suggerimento sui formati', () => {
    const wrapper = mount(DropZone, { props: { disabled: false } });
    expect(wrapper.find('[data-testid=choose-files]').attributes('aria-describedby')).toBe(
      'drop-hint',
    );
  });
});

describe('ThemeSwitcher', () => {
  it('applica e salva il tema scelto', async () => {
    const wrapper = mount(ThemeSwitcher);
    await wrapper.find('[data-testid=theme-dark]').setValue(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('md-converter-theme')).toBe('dark');
    expect(wrapper.find('legend').text()).toBe('Tema');
  });
});
