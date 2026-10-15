import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLegacyConverter } from '../../web/src/lib/legacy-client';

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    super();
    FakeWorker.instances.push(this);
  }
  reply(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWorker.instances = [];
});

describe('legacy conversion worker lifetime', () => {
  it('does not launch a worker after cancellation while reading a file', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    let finishRead!: (bytes: ArrayBuffer) => void;
    const file = {
      size: 3,
      name: 'emoji.gif',
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishRead = resolve;
        }),
    } as File;
    const converter = createLegacyConverter();
    const result = converter.convert(file, { maxEdge: 128 });
    const rejected = expect(result).rejects.toMatchObject({
      key: 'legacy.cancelled',
    });
    converter.close();
    finishRead(new ArrayBuffer(3));
    await rejected;
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('terminates a stalled worker and starts a fresh worker for a retry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const file = new File(['GIF'], 'emoji.gif');
    const converter = createLegacyConverter();
    const result = converter.convert(file, { maxEdge: 128 });
    const rejected = expect(result).rejects.toMatchObject({
      key: 'legacy.timeout',
    });
    await vi.advanceTimersByTimeAsync(180_000);
    await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const retried = converter.convert(file, { maxEdge: 128 });
    await vi.advanceTimersByTimeAsync(0);
    const worker = FakeWorker.instances[1];
    const id = worker.postMessage.mock.calls[0][0].id;
    worker.reply({ id: id - 1, type: 'error', key: 'legacy.invalid' });
    const output = {
      bytes: new Uint8Array([1]),
      filename: 'emoji.legacy.gif',
      width: 1,
      height: 1,
      frames: 1,
    };
    worker.reply({ id, type: 'result', result: output });
    await expect(retried).resolves.toEqual(output);
    converter.close();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
