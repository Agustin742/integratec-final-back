import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { loadShopCatalog } from './load-shop-catalog';
import { SHOP_CATALOG } from './seed-shop-catalog';

describe('loadShopCatalog', () => {
  it('inserts the whole catalog, skipping existing items, and writes nothing else', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    // Any other access (delete, update, another model) throws on undefined.
    const prisma = { shopItem: { createMany } } as unknown as PrismaClient;

    await expect(loadShopCatalog(prisma)).resolves.toBe(3);

    expect(createMany).toHaveBeenCalledExactlyOnceWith({
      data: [...SHOP_CATALOG],
      skipDuplicates: true,
    });
  });
});
