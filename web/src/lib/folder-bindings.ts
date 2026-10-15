import { LocalizedError } from '../i18n';
import type { DirectorySource } from './folder';

const DATABASE_NAME = 'emojiful-folder-bindings';
const DATABASE_VERSION = 1;
const STORE_NAME = 'bindings';

function unavailable(): LocalizedError {
  return new LocalizedError('error.failed');
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? unavailable());
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? unavailable());
    transaction.onerror = () => reject(transaction.error ?? unavailable());
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(unavailable());
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME))
        database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? unavailable());
    request.onblocked = () => reject(unavailable());
  });
}

function validateKey(key: string): void {
  if (typeof key !== 'string' || !key.trim()) throw unavailable();
}

export async function loadFolderBindings(): Promise<
  Record<string, DirectorySource>
> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const completed = transactionResult(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const [[keys, values]] = await Promise.all([
      Promise.all([
        requestResult(store.getAllKeys()),
        requestResult(store.getAll()),
      ]),
      completed,
    ]);
    const result: Record<string, DirectorySource> = {};
    keys.forEach((key, index) => {
      if (typeof key === 'string')
        result[key] = values[index] as DirectorySource;
    });
    return result;
  } catch (error) {
    throw error instanceof LocalizedError ? error : unavailable();
  } finally {
    database.close();
  }
}

export async function putFolderBinding(
  key: string,
  source: DirectorySource,
): Promise<void> {
  validateKey(key);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionResult(transaction);
    await Promise.all([
      requestResult(transaction.objectStore(STORE_NAME).put(source, key)),
      completed,
    ]);
  } catch (error) {
    throw error instanceof LocalizedError ? error : unavailable();
  } finally {
    database.close();
  }
}

export async function deleteFolderBinding(key: string): Promise<void> {
  validateKey(key);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionResult(transaction);
    await Promise.all([
      requestResult(transaction.objectStore(STORE_NAME).delete(key)),
      completed,
    ]);
  } catch (error) {
    throw error instanceof LocalizedError ? error : unavailable();
  } finally {
    database.close();
  }
}
