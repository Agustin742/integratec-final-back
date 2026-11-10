import { Schema, type } from '@colyseus/schema';

/**
 * Minimal synchronized state; presence and movement arrive with #25.
 * Client types are generated from this file (`pnpm realtime:codegen`), so keep it free of server
 * imports.
 */
export class ClassroomState extends Schema {
  @type('string') classroomId = '';
}
