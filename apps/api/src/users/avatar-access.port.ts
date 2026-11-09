import { Injectable } from '@nestjs/common';
import type { ErrorDetail } from '../http/error-envelope';
import { RequestValidationException } from '../http/validation';
import { AvatarDto, BASE_OPTIONS } from './avatar.dto';

/** Future shop adapter must verify persisted ownership before allowing paid options. */
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

/** Only finite free options exist here: nothing claims or grants shop ownership. */
@Injectable()
export class FreeBaseAvatarAccess extends AvatarAccessPort {
  async assertCanUse(_userId: string, appearance: AvatarDto): Promise<void> {
    const errors = compatibilityErrors(appearance);
    if (errors.length) throw new RequestValidationException(errors);
  }
}
