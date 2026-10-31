import { watch } from 'vue';
import { useI18n } from '../i18n';
import { useAnnouncer } from './useAnnouncer';
import type { ConversionQueue } from './useConversionQueue';

const ANNOUNCED_STATUSES = ['ready', 'converting', 'completed', 'cancelled', 'failed'];

/** Annuncia alle tecnologie assistive i cambi di stato dei file e la fine del lotto. */
export function useQueueAnnouncements(queue: ConversionQueue): void {
  const { t, tDynamic } = useI18n();
  const { announce, announceError } = useAnnouncer();
  const lastStatus = new Map<string, string>();

  watch(
    () => queue.rows.value.map((row) => [row.item.localId, row.item.name, row.status] as const),
    (entries) => {
      for (const [id, name, status] of entries) {
        if (lastStatus.get(id) === status) continue;
        lastStatus.set(id, status);
        if (!ANNOUNCED_STATUSES.includes(status)) continue;
        const message = t('announce.fileStatus', {
          name,
          status: tDynamic(`status.${status}`, status),
        });
        if (status === 'failed') announceError(message);
        else announce(message);
      }
    },
  );

  watch(queue.isFinished, (finished) => {
    if (finished)
      announce(
        t('announce.allDone', {
          completed: queue.completedCount.value,
          failed: queue.failedCount.value,
        }),
      );
  });

  watch(queue.expired, (expired) => {
    if (expired) announceError(t('announce.jobExpired'));
  });
}
