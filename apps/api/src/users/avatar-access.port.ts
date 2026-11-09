import type { ErrorDetail } from '../http/error-envelope';
import { AvatarDto, BASE_OPTIONS } from './avatar.dto';

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
