//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 5.0.43
//

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';
import { Avatar } from './Avatar';

export class ClassroomState extends Schema {
  @type('string') public classroomId!: string;
  @type({ map: Avatar }) public avatars: MapSchema<Avatar> = new MapSchema<Avatar>();
}
