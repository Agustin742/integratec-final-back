//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 5.0.43
//

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';

export class Avatar extends Schema {
  @type('string') public userId!: string;
  @type('string') public displayName!: string;
  @type('string') public role!: string;
  @type('float32') public x!: number;
  @type('float32') public z!: number;
  @type('float32') public rotation!: number;
  @type('string') public status!: string;
}
