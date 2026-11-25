import type { ErrorDetail } from '../http/error-envelope';
import { AvatarDto, BASE_OPTIONS } from './avatar.dto';

/**
 * Base-avatar access port. Paid hair and top styles are checked by `ShopAvatarAccess`;
 * classroom-scoped paid equipment ownership is verified in `EquipmentService`.
 */
export abstract class AvatarAccessPort {
  abstract assertCanUse(userId: string, appearance: AvatarDto): Promise<void>;
}

export function compatibilityErrors(appearance: AvatarDto): ErrorDetail[] {
  const options = Object.hasOwn(BASE_OPTIONS, appearance.bodyId)
    ? BASE_OPTIONS[appearance.bodyId]
    : undefined;
  return (['hairId', 'topId'] as const).flatMap((field) =>
    options?.[field].includes(appearance[field])
      ? []
      : [{ field, messages: [`${field} is not supported for bodyId`] }],
  );
}
