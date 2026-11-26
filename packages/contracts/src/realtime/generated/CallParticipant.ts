//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 5.0.43
//

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';
import { AvatarAppearance } from './AvatarAppearance';

export class CallParticipant extends Schema {
  @type('string') public userId!: string;
  @type('string') public displayName!: string;
  @type('string') public role!: string;
  @type('boolean') public selfMuted!: boolean;
  @type('boolean') public forcedMuted!: boolean;
  @type('boolean') public speaking!: boolean;
  @type('string') public emote!: string;
  @type('uint32') public emoteSeq!: number;
  @type(AvatarAppearance) public appearance: AvatarAppearance = new AvatarAppearance();
}
