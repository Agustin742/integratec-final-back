//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 5.0.43
//

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';
import { EquippedItemView } from './EquippedItemView';

export class AvatarAppearance extends Schema {
  @type('string') public bodyId!: string;
  @type('string') public hairId!: string;
  @type('string') public topId!: string;
  @type('string') public hairColor!: string;
  @type('string') public clothingColor!: string;
  @type({ map: EquippedItemView }) public items: MapSchema<EquippedItemView> =
    new MapSchema<EquippedItemView>();
}
