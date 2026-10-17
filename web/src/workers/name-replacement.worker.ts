import {
  NameReplacementError,
  previewNameReplacement,
  type NameReplacementErrorCode,
  type NameReplacementPreview,
  type NameReplacementRequest,
} from '../lib/name-tools';

export type NameReplacementWorkerResponse =
  | { ok: true; preview: NameReplacementPreview }
  | { ok: false; code: NameReplacementErrorCode };

const workerScope = self as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<NameReplacementRequest>) => void,
  ): void;
  postMessage(response: NameReplacementWorkerResponse): void;
};

workerScope.addEventListener('message', (event) => {
  try {
    workerScope.postMessage({
      ok: true,
      preview: previewNameReplacement(event.data),
    });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      code: error instanceof NameReplacementError ? error.code : 'tooLarge',
    });
  }
});
