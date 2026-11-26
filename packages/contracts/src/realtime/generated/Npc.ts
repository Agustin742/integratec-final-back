//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 5.0.43
//

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';

export class Npc extends Schema {
  @type('string') public id!: string;
  @type('float32') public x!: number;
  @type('float32') public z!: number;
  @type('float32') public rotation!: number;
  @type('string') public state!: string;
  @type('string') public emote!: string;
  @type('string') public reaction!: string;
  @type('int16') public phraseId!: number;
  @type('uint32') public reactionSeq!: number;
  @type('string') public reactingSessionId!: string;
}
