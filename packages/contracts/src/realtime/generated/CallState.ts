//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 5.0.43
//

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';
import { CallParticipant } from './CallParticipant';

export class CallState extends Schema {
  @type('string') public kind!: string;
  @type('string') public classroomId!: string;
  @type('string') public hostUserId!: string;
  @type('boolean') public focusMode!: boolean;
  @type('boolean') public allowSelfUnmute!: boolean;
  @type({ map: CallParticipant }) public participants: MapSchema<CallParticipant> =
    new MapSchema<CallParticipant>();
}
