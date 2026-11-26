import type { MemberAppearance } from '@aula/contracts';
import { EquippedItemView, type AvatarAppearance } from './classroom-state';

/**
 * Copies the API-verified public appearance onto synchronized appearance state (#114). The payload
 * is already validated (`memberAppearanceSchema` in @aula/contracts); a slot that is not equipped
 * is simply absent from the items map. Shared by the classroom avatar and the call participant.
 */
export function applyAppearanceToState(
  target: AvatarAppearance,
  appearance: MemberAppearance,
): void {
  target.bodyId = appearance.baseAvatar.bodyId;
  target.hairId = appearance.baseAvatar.hairId;
  target.topId = appearance.baseAvatar.topId;
  target.hairColor = appearance.baseAvatar.hairColor;
  target.clothingColor = appearance.baseAvatar.clothingColor;
  target.items.clear();
  for (const [slot, item] of Object.entries(appearance.items)) {
    if (item === null) continue;
    const view = new EquippedItemView();
    view.slot = item.slot;
    view.shopItemId = item.shopItemId;
    view.shopItemCode = item.shopItemCode;
    view.shopItemName = item.shopItemName;
    view.kind = item.kind;
    target.items.set(slot, view);
  }
}
