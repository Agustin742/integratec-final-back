//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 5.0.43
//

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';

export class EquippedItemView extends Schema {
  @type('string') public slot!: string;
  @type('string') public shopItemId!: string;
  @type('string') public shopItemCode!: string;
  @type('string') public shopItemName!: string;
  @type('string') public kind!: string;
}
