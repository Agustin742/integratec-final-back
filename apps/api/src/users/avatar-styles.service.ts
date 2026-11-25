import { Injectable } from '@nestjs/common';
import { Prisma, ShopItemKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HAIR_IDS, TOP_IDS, isFreeAvatarStyle, type AvatarStyleKind } from './avatar-catalog';
import { AvatarStyleAvailabilityDto, AvatarStylesDto } from './avatar-styles.dto';

const styleKey = (type: AvatarStyleKind, id: string): string => `${type}:${id}`;

function readStyleMetadata(
  metadata: Prisma.JsonValue,
): { type: AvatarStyleKind; id: string } | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const { styleType, styleId } = metadata as Record<string, unknown>;
  if ((styleType !== 'hair' && styleType !== 'top') || typeof styleId !== 'string') return null;
  return { type: styleType, id: styleId };
}

/**
 * Paid avatar styles are `AVATAR_STYLE` shop items whose metadata names the style
 * (`styleType`, `styleId`). A purchase in any classroom unlocks the style for the user's global
 * avatar, whether or not the shop item is still active.
 */
@Injectable()
export class AvatarStylesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<AvatarStylesDto> {
    const sold = await this.soldStyles(userId);
    const items: AvatarStyleAvailabilityDto[] = [
      ...HAIR_IDS.map((id) => this.describe('hair', id, sold)),
      ...TOP_IDS.map((id) => this.describe('top', id, sold)),
    ];
    return { items };
  }

  /** Paid styles among the given ones that the user does not own yet. */
  async missingPaidStyles(
    userId: string,
    wanted: ReadonlyArray<{ type: AvatarStyleKind; id: string }>,
  ): Promise<Array<{ type: AvatarStyleKind; id: string }>> {
    const paid = wanted.filter(({ type, id }) => !isFreeAvatarStyle(type, id));
    if (paid.length === 0) return [];
    const sold = await this.soldStyles(userId);
    return paid.filter(({ type, id }) => !sold.get(styleKey(type, id))?.owned);
  }

  private describe(
    type: AvatarStyleKind,
    id: string,
    sold: Map<string, { code: string; owned: boolean }>,
  ): AvatarStyleAvailabilityDto {
    const free = isFreeAvatarStyle(type, id);
    const entry = sold.get(styleKey(type, id));
    return {
      styleType: type,
      styleId: id,
      free,
      owned: free || (entry?.owned ?? false),
      shopItemCode: free ? null : (entry?.code ?? null),
    };
  }

  /**
   * One query: every style shop item with the user's purchases of it. When several items sell
   * the same style, the owned one wins, then the active one, then the lowest code.
   */
  private async soldStyles(userId: string): Promise<Map<string, { code: string; owned: boolean }>> {
    const rows = await this.prisma.shopItem.findMany({
      where: { kind: ShopItemKind.AVATAR_STYLE },
      orderBy: { code: 'asc' },
      select: {
        code: true,
        isActive: true,
        metadata: true,
        purchases: { where: { studentId: userId }, select: { id: true }, take: 1 },
      },
    });
    const sold = new Map<string, { code: string; owned: boolean; active: boolean }>();
    for (const row of rows) {
      const style = readStyleMetadata(row.metadata);
      if (!style) continue;
      const key = styleKey(style.type, style.id);
      const candidate = { code: row.code, owned: row.purchases.length > 0, active: row.isActive };
      const current = sold.get(key);
      if (
        !current ||
        (candidate.owned && !current.owned) ||
        (candidate.owned === current.owned && candidate.active && !current.active)
      ) {
        sold.set(key, candidate);
      }
    }
    return sold;
  }
}
