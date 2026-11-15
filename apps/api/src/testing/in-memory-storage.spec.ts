import { describe, expect, it } from 'vitest';
import {
  InvalidStorageKeyError,
  StorageObjectNotFoundError,
} from '../platform/storage/storage.port';
import { InMemoryStorage } from './in-memory-storage';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('InMemoryStorage', () => {
  it('stores, reads back and replaces objects', async () => {
    const storage = new InMemoryStorage();
    await storage.put('a/b', bytes(1, 2), { contentType: 'image/png' });
    expect(await storage.get('a/b')).toEqual({ body: bytes(1, 2), contentType: 'image/png' });
    await storage.put('a/b', bytes(9), { contentType: 'application/pdf' });
    expect(await storage.get('a/b')).toEqual({ body: bytes(9), contentType: 'application/pdf' });
  });

  it('runs put hooks after the object is stored, for a limited number of puts', async () => {
    const storage = new InMemoryStorage();
    const seen: { key: string; stored: boolean }[] = [];
    storage.onPut(
      async (key) => {
        seen.push({ key, stored: storage.has(key) });
      },
      { times: 1 },
    );
    await storage.put('a', bytes(1), { contentType: 'x/y' });
    await storage.put('b', bytes(2), { contentType: 'x/y' });
    expect(seen).toEqual([{ key: 'a', stored: true }]);

    storage.onPut(() => {
      throw new Error('hook failure');
    });
    await expect(storage.put('c', bytes(3), { contentType: 'x/y' })).rejects.toThrow(
      'hook failure',
    );
    storage.clearHooks();
    await storage.put('d', bytes(4), { contentType: 'x/y' });
    expect(storage.has('d')).toBe(true);
  });

  it('copies bodies so callers cannot mutate stored data', async () => {
    const storage = new InMemoryStorage();
    const body = bytes(1, 2);
    await storage.put('k', body, { contentType: 'x/y' });
    body[0] = 99;
    expect((await storage.get('k')).body[0]).toBe(1);
  });

  it('throws StorageObjectNotFoundError for a missing key and deletes idempotently', async () => {
    const storage = new InMemoryStorage();
    await expect(storage.get('missing')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    await storage.put('k', bytes(1), { contentType: 'x/y' });
    await storage.delete('k');
    await storage.delete('k');
    await expect(storage.get('k')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('rejects unsafe keys on every operation', async () => {
    const storage = new InMemoryStorage();
    await expect(storage.put('../x', bytes(1), { contentType: 'a/b' })).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
    await expect(storage.get('/x')).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.delete('a//b')).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.getSignedDownloadUrl('')).rejects.toBeInstanceOf(InvalidStorageKeyError);
  });

  it('signs a URL for an existing object and validates the lifetime', async () => {
    const storage = new InMemoryStorage();
    await storage.put('k', bytes(1), { contentType: 'x/y' });
    const url = await storage.getSignedDownloadUrl('k', { expiresInSeconds: 60 });
    expect(url).toContain('k');
    expect(url).toContain('60');
    await expect(storage.getSignedDownloadUrl('k', { expiresInSeconds: 0 })).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(storage.getSignedDownloadUrl('nope')).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it('lets tests inspect stored objects and recorded calls', async () => {
    const storage = new InMemoryStorage();
    await storage.put('one', bytes(1), { contentType: 'a/b' });
    await storage.put('two', bytes(2, 3), { contentType: 'c/d' });
    await storage.delete('one');
    expect(storage.keys()).toEqual(['two']);
    expect(storage.has('two')).toBe(true);
    expect(storage.has('one')).toBe(false);
    expect(storage.peek('two')).toEqual({ body: bytes(2, 3), contentType: 'c/d' });
    expect(storage.calls).toEqual([
      { operation: 'put', key: 'one' },
      { operation: 'put', key: 'two' },
      { operation: 'delete', key: 'one' },
    ]);
  });

  it('injects failures that leave state untouched, for a number of calls or by key', async () => {
    const storage = new InMemoryStorage();
    storage.failOn('put', { error: new Error('boom'), times: 1 });
    await expect(storage.put('a', bytes(1), { contentType: 'x/y' })).rejects.toThrow('boom');
    expect(storage.has('a')).toBe(false);
    await storage.put('a', bytes(1), { contentType: 'x/y' });

    storage.failOn('delete', { key: 'a' });
    await expect(storage.delete('a')).rejects.toThrow();
    expect(storage.has('a')).toBe(true);
    await storage.delete('other');

    storage.clearFailures();
    await storage.delete('a');
    expect(storage.has('a')).toBe(false);
  });
});
