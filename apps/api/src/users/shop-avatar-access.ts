import { ForbiddenException, Injectable } from '@nestjs/common';
import { RequestValidationException } from '../http/validation';
import { AvatarAccessPort, compatibilityErrors } from './avatar-access.port';
import type { AvatarDto } from './avatar.dto';
import { AvatarStylesService } from './avatar-styles.service';

/**
 * Base-avatar access: structural compatibility first (`400`), then shop ownership of paid hair and
 * top styles (`403`). Free styles never need a purchase.
 */
@Injectable()
export class ShopAvatarAccess extends AvatarAccessPort {
  constructor(private readonly styles: AvatarStylesService) {
    super();
  }

  async assertCanUse(userId: string, appearance: AvatarDto): Promise<void> {
    const errors = compatibilityErrors(appearance);
    if (errors.length) throw new RequestValidationException(errors);

    const missing = await this.styles.missingPaidStyles(userId, [
      { type: 'hair', id: appearance.hairId },
      { type: 'top', id: appearance.topId },
    ]);
    if (missing.length) {
      throw new ForbiddenException('Avatar style has not been unlocked in the shop');
    }
  }
}
