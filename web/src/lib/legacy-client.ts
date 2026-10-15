import { LocalizedError } from '../i18n';
import type { LegacyOptions } from './legacy-media';

export interface LegacyResult {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  width: number;
  height: number;
  frames: number;
}
type Stage = 'loading' | 'converting';

export function createLegacyConverter() {
  let worker: Worker | null = null;
  let pending: { reject: (error: unknown) => void; id: number } | null = null;
  let serial = 0;
  function close() {
    serial++;
    worker?.terminate();
    worker = null;
    pending?.reject(new LocalizedError('legacy.cancelled'));
    pending = null;
  }
  return {
    close,
    async convert(
      file: File,
      options: LegacyOptions,
      onStage?: (stage: Stage) => void,
    ): Promise<LegacyResult> {
      if (pending) throw new LocalizedError('legacy.failed');
      if (!file.size || file.size > 32 * 1024 * 1024)
        throw new LocalizedError('legacy.limits');
      if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined')
        throw new LocalizedError('legacy.unsupported');
      const id = ++serial;
      const bytes = await file.arrayBuffer();
      // A stop during File.arrayBuffer() must not restart a terminated worker.
      if (id !== serial) throw new LocalizedError('legacy.cancelled');
      worker ??= new Worker(new URL('./legacy-worker.ts', import.meta.url), {
        type: 'module',
      });
      const activeWorker = worker;
      return new Promise<LegacyResult>((resolve, reject) => {
        let finished = false;
        const finish = (error?: unknown, result?: LegacyResult) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          activeWorker.removeEventListener('message', message);
          activeWorker.removeEventListener('error', failed);
          if (pending?.id === id) pending = null;
          if (error) reject(error);
          else resolve(result!);
        };
        const message = (event: MessageEvent) => {
          if (event.data?.id !== id) return;
          if (event.data.type === 'stage') onStage?.(event.data.stage);
          else if (event.data.type === 'result')
            finish(undefined, event.data.result);
          else if (event.data.type === 'error') {
            const key =
              (
                [
                  'legacy.invalid',
                  'legacy.limits',
                  'legacy.outputInvalid',
                  'legacy.settingsInvalid',
                  'legacy.unsupported',
                ] as const
              ).find((value) => value === event.data.key) ?? 'legacy.failed';
            finish(new LocalizedError(key));
          }
        };
        const failed = () => {
          activeWorker.terminate();
          if (worker === activeWorker) worker = null;
          finish(new LocalizedError('legacy.failed'));
        };
        const timer = setTimeout(() => {
          activeWorker.terminate();
          if (worker === activeWorker) worker = null;
          finish(new LocalizedError('legacy.timeout'));
        }, 180_000);
        pending = { id, reject: (error) => finish(error) };
        activeWorker.addEventListener('message', message);
        activeWorker.addEventListener('error', failed);
        activeWorker.postMessage({ id, bytes, name: file.name, options }, [
          bytes,
        ]);
      });
    },
  };
}
