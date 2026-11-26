import { PrismaClient } from '@prisma/client';
import { SHOP_CATALOG } from './seed-shop-catalog';

/**
 * Inserts the shop catalog items that are missing. Safe on any database, including
 * production: it never updates or deletes, and rows with an existing `code` are skipped.
 */
export async function loadShopCatalog(prisma: PrismaClient): Promise<number> {
  const { count } = await prisma.shopItem.createMany({
    data: [...SHOP_CATALOG],
    skipDuplicates: true,
  });
  return count;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    console.log(`Shop catalog: ${await loadShopCatalog(prisma)} item(s) added.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
