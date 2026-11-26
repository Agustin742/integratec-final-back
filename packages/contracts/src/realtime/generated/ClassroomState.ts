//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 5.0.43
//

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';
import { Avatar } from './Avatar';
import { Npc } from './Npc';

export class ClassroomState extends Schema {
  @type('string') public classroomId!: string;
  @type('uint16') public deskCount!: number;
  @type('string') public tutorBotSkin!: string;
  @type({ map: Avatar }) public avatars: MapSchema<Avatar> = new MapSchema<Avatar>();
  @type('boolean') public classCallActive!: boolean;
  @type('boolean') public focusMode!: boolean;
  @type({ map: Npc }) public npcs: MapSchema<Npc> = new MapSchema<Npc>();
}
