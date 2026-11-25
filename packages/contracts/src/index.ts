import { z } from 'zod';

export interface HealthStatus {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
}

export type UserRole = 'TEACHER' | 'STUDENT' | 'PARENT' | 'SCHOOL_ADMIN';

export const RegistrationPath = {
  INDEPENDENT_TEACHER: 'INDEPENDENT_TEACHER',
  SCHOOL: 'SCHOOL',
} as const;

export type RegistrationPath = (typeof RegistrationPath)[keyof typeof RegistrationPath];

export const REGISTRATION_PATHS = [
  RegistrationPath.INDEPENDENT_TEACHER,
  RegistrationPath.SCHOOL,
] as const;

/**
 * Realtime (Colyseus) contract shared with the frontend (decision D8).
 * The room state client types are generated into `./realtime/generated` by `pnpm realtime:codegen`.
 * This stays in `index.ts` (no relative import): Node loads the package entry as TypeScript source.
 */

/** Name the room is registered under; clients join it with `client.joinOrCreate`. */
export const CLASSROOM_ROOM_NAME = 'classroom';

/**
 * Options a client passes when joining a classroom room.
 * The access token is NOT an option: the client sets `client.auth.token`, which the SDK sends as
 * the `Authorization: Bearer` header of the matchmake request.
 */
export interface ClassroomJoinOptions {
  classroomId: string;
}

/** Server simulation and state patch rates, in Hz. The frontend interpolates between patches. */
export const SIMULATION_TICK_RATE_HZ = 20;
export const PATCH_RATE_HZ = 20;

/** Fixed avatar speed in layout units per second; the client cannot change it. */
export const AVATAR_SPEED_UNITS_PER_SECOND = 3;

/** Per-connection message limit; messages over it are dropped silently. */
export const INPUT_RATE_LIMIT_PER_SECOND = 30;

/** Simultaneous connections (screens) one user may hold in a classroom room. */
export const MAX_CONNECTIONS_PER_USER = 3;

/**
 * Close codes the room uses (decision D14). Colyseus also uses 4001 (server shutdown) and 4002
 * (protocol error), so clients must read the close reason as well as the code.
 */
export const CLOSE_CODE_ACCESS_REVOKED = 4001;
export const CLOSE_CODE_TOO_MANY_CONNECTIONS = 4002;
/**
 * Access could not be verified (the API was unreachable, slow or failing) when a dropped
 * connection came back. Unlike 4001 it says nothing about the user's access: the client may retry.
 * 4100 sits outside every code Colyseus uses (4000 to 4003 and 4010).
 */
export const CLOSE_CODE_VERIFICATION_UNAVAILABLE = 4100;
export const CLOSE_REASON_ACCESS_REVOKED = 'access_revoked';
export const CLOSE_REASON_TOO_MANY_CONNECTIONS = 'too_many_connections';
export const CLOSE_REASON_VERIFICATION_UNAVAILABLE = 'verification_unavailable';

/** Client to server: the direction the avatar should walk. `{ x: 0, z: 0 }` stops it. */
export const AVATAR_INPUT_MESSAGE = 'avatar:input';

/** Each component is in [-1, 1]; the server normalizes the direction and applies a fixed speed. */
export const avatarInputSchema = z.strictObject({
  x: z.number().min(-1).max(1),
  z: z.number().min(-1).max(1),
});

export type AvatarInput = z.infer<typeof avatarInputSchema>;

/** Server to client: a persisted classroom chat message, announced after its database commit. */
export const CHAT_MESSAGE_EVENT = 'chat:message';
export const CHAT_MESSAGE_MAX_BODY_LENGTH = 2000;
export const CHAT_MESSAGE_MAX_MENTIONED_USERS = 20;
export const chatMessagePayloadSchema = z.strictObject({
  id: z.uuid(),
  classroomId: z.uuid(),
  authorId: z.uuid(),
  body: z.string().min(1).max(CHAT_MESSAGE_MAX_BODY_LENGTH),
  mentionedUserIds: z.array(z.uuid()).max(CHAT_MESSAGE_MAX_MENTIONED_USERS),
  createdAt: z.iso.datetime(),
});
export type ChatMessagePayload = z.infer<typeof chatMessagePayloadSchema>;

/** Server to client: a persisted moderation change; REST history supplies staff audit details. */
export const CHAT_MESSAGE_HIDDEN_EVENT = 'chat:message.hidden';
export const chatMessageHiddenPayloadSchema = z.strictObject({
  messageId: z.uuid(),
  hiddenAt: z.iso.datetime(),
});
export type ChatMessageHiddenPayload = z.infer<typeof chatMessageHiddenPayloadSchema>;

/** Authenticated NestJS-to-Colyseus service request; the public event payload stays nested. */
export const chatRealtimeBroadcastSchema = z
  .discriminatedUnion('event', [
    z.strictObject({
      classroomId: z.uuid(),
      event: z.literal(CHAT_MESSAGE_EVENT),
      payload: chatMessagePayloadSchema,
    }),
    z.strictObject({
      classroomId: z.uuid(),
      event: z.literal(CHAT_MESSAGE_HIDDEN_EVENT),
      payload: chatMessageHiddenPayloadSchema,
    }),
  ])
  .refine(
    (broadcast) =>
      broadcast.event !== CHAT_MESSAGE_EVENT ||
      broadcast.payload.classroomId === broadcast.classroomId,
    { message: 'Message classroomId must match the broadcast classroomId' },
  );
export type ChatRealtimeBroadcast = z.infer<typeof chatRealtimeBroadcastSchema>;

export const AVATAR_STATUSES = ['online', 'reconnecting'] as const;
export type AvatarStatus = (typeof AVATAR_STATUSES)[number];

/**
 * Slot names of avatar equipment as carried in appearance payloads. They match the API's
 * equipment URL slot names; duplicated here so the realtime service can validate the payload
 * without importing server code.
 */
export const APPEARANCE_SLOT_NAMES = ['head', 'face', 'back', 'desk_decor'] as const;
export type AppearanceSlotName = (typeof APPEARANCE_SLOT_NAMES)[number];

/** Public projection of one equipped item: catalog fields only, no purchase or price data. */
export const equippedItemPayloadSchema = z.strictObject({
  slot: z.enum(APPEARANCE_SLOT_NAMES),
  shopItemId: z.string().min(1),
  shopItemCode: z.string().min(1).max(80),
  shopItemName: z.string().min(1).max(120),
  kind: z.string().min(1).max(40),
});
export type EquippedItemPayload = z.infer<typeof equippedItemPayloadSchema>;

/**
 * Public appearance of one classroom member: base avatar plus equipped items per slot (#114).
 * Unknown fields are rejected at every consumer so no private data can ride along.
 */
export const memberAppearanceSchema = z
  .strictObject({
    baseAvatar: z.strictObject({
      bodyId: z.string().min(1).max(40),
      hairId: z.string().min(1).max(40),
      topId: z.string().min(1).max(40),
      hairColor: z.string().min(1).max(40),
      clothingColor: z.string().min(1).max(40),
    }),
    items: z.strictObject({
      head: equippedItemPayloadSchema.nullable(),
      face: equippedItemPayloadSchema.nullable(),
      back: equippedItemPayloadSchema.nullable(),
      desk_decor: equippedItemPayloadSchema.nullable(),
    }),
  })
  .refine(
    (appearance) =>
      (Object.keys(appearance.items) as AppearanceSlotName[]).every(
        (slot) => appearance.items[slot] === null || appearance.items[slot].slot === slot,
      ),
    { message: 'equipped item slot must match its items key' },
  );
export type MemberAppearance = z.infer<typeof memberAppearanceSchema>;

/** Axis-aligned box on the floor plane (x, z), in layout units. */
export interface LayoutBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ClassroomLayout {
  /** Walls: the avatar centre stays at least `avatarRadius` inside this box. */
  bounds: LayoutBox;
  /** Collision radius of an avatar. Obstacles are inflated by it. */
  avatarRadius: number;
  /** Desks and other solid boxes an avatar cannot enter. */
  obstacles: readonly LayoutBox[];
  /**
   * Floor props the scene draws (shop kiosk, pet bed, bot station). They block avatars like desks
   * but live apart from `obstacles`, whose order (teacher desk first, then student desks) the
   * frontend relies on.
   */
  props: readonly PropObstacle[];
  /** Where new avatars appear; every point is walkable. */
  spawnPoints: readonly { x: number; z: number }[];
}

export type PropObstacleId =
  'shopKiosk' | 'petBed' | 'botStation' | 'reportCardStand' | 'chatComputer';

/** Footprint of a floor prop: an axis-aligned box on the floor plane. */
export interface PropObstacle extends LayoutBox {
  id: PropObstacleId;
}

const desk = (
  centerX: number,
  centerZ: number,
  halfWidth: number,
  halfDepth: number,
): LayoutBox => ({
  minX: centerX - halfWidth,
  maxX: centerX + halfWidth,
  minZ: centerZ - halfDepth,
  maxZ: centerZ + halfDepth,
});

/** Fewest student desks a classroom layout ever has: three rows of four. */
export const MIN_CLASSROOM_DESKS = 12;

/**
 * Largest desk count a classroom layout accepts. Desks only grow one by one with student
 * enrolments (#22), so 200 (fifty rows) is far beyond any real classroom; the cap keeps a corrupt
 * or hostile count from building an arbitrarily large room on the realtime server.
 */
export const MAX_CLASSROOM_DESKS = 200;

/** Distance between two consecutive student desk rows (z axis). */
export const CLASSROOM_DESK_ROW_SPACING = 2.2;

const DESKS_PER_ROW = 4;
const FIRST_ROW_Z = -1.8;
const DESK_COLUMNS_X = [-4.5, -1.5, 1.5, 4.5];
const BASE_BOUNDS: LayoutBox = { minX: -8, maxX: 8, minZ: -6, maxZ: 6 };
const BASE_ROWS = MIN_CLASSROOM_DESKS / DESKS_PER_ROW;

/** Snaps to centimetres so extra rows get clean decimals and the base room stays bit-identical. */
const toCentimetres = (value: number): number => Math.round(value * 100) / 100;

/**
 * Footprints of the floor props, in world axes, from `front/docs/art/classroom-interactive.md` and
 * `tutor-bot.md`. The kiosk (1.96 x 0.71 m) and the pet bed (1.04 x 0.80 m) stand against the front
 * wall; the bot station (1.532 x 1.278 m) is rotated 90 degrees against the left wall, so its long
 * side runs along z. Positions derive from the bounds, which never move on their front and left
 * sides, so a grown room keeps the props where they are.
 */
function buildPropObstacles({ minX, minZ }: LayoutBox): PropObstacle[] {
  return [
    { id: 'shopKiosk', ...desk(4.8, minZ + 0.44, 0.98, 0.355) },
    { id: 'petBed', ...desk(6.85, minZ + 0.62, 0.52, 0.4) },
    { id: 'botStation', ...desk(minX + 1.05, 1.05, 0.639, 0.766) },
    // Report card stand (0.78 x 0.48 m) on the front wall; chat computer (0.54 x 0.88 m) on the left.
    { id: 'reportCardStand', ...desk(2.95, minZ + 0.32, 0.39, 0.24) },
    { id: 'chatComputer', ...desk(minX + 0.38, -3.0, 0.27, 0.44) },
  ];
}

/**
 * Walkable surface shared by the server (collisions) and the frontend scene, built from the number
 * of student desks of a classroom (issues #79 and #22). The base room is 16 by 12 with the teacher
 * desk at the front (negative z) and the entrance at the back. Student desks go in rows of four,
 * front to back, columns left to right in deskIndex order; a new row appears with the first desk
 * that does not fit, and a partial last row fills from the left. Fewer than twelve desks (or a
 * non-finite count) yield the base twelve-desk room. Each extra row pushes the back wall by one row
 * spacing; the teacher desk and the other walls never move, and spawn points stay behind the last
 * row.
 */
export function buildClassroomLayout(deskCount: number): ClassroomLayout {
  const effectiveCount = Number.isFinite(deskCount)
    ? Math.max(MIN_CLASSROOM_DESKS, Math.floor(deskCount))
    : MIN_CLASSROOM_DESKS;
  const rows = Math.ceil(effectiveCount / DESKS_PER_ROW);
  const maxZ = toCentimetres(BASE_BOUNDS.maxZ + CLASSROOM_DESK_ROW_SPACING * (rows - BASE_ROWS));
  const studentDesks = Array.from({ length: effectiveCount }, (_, deskIndex) =>
    desk(
      DESK_COLUMNS_X[deskIndex % DESKS_PER_ROW],
      toCentimetres(
        FIRST_ROW_Z + CLASSROOM_DESK_ROW_SPACING * Math.floor(deskIndex / DESKS_PER_ROW),
      ),
      0.8,
      0.4,
    ),
  );
  return {
    bounds: { ...BASE_BOUNDS, maxZ },
    avatarRadius: 0.3,
    obstacles: [desk(0, -4.4, 1.5, 0.4), ...studentDesks],
    props: buildPropObstacles(BASE_BOUNDS),
    spawnPoints: [-6, -4, -2, 0, 2, 4, 6].map((x) => ({ x, z: toCentimetres(maxZ - 1) })),
  };
}

/** Server-driven NPCs of the classroom: the pet (Michi) and the tutor bot. */
export const NPC_IDS = ['pet', 'tutorBot'] as const;
export type NpcId = (typeof NPC_IDS)[number];

export const NpcState = {
  idle: 'idle',
  walking: 'walking',
  emote: 'emote',
  sleeping: 'sleeping',
  reacting: 'reacting',
} as const;

export type NpcState = (typeof NpcState)[keyof typeof NpcState];

/**
 * Emote names per NPC, matching the clip names the frontend plays. The tutor bot's are its real
 * clips (its idle is `IdleHover`, its sleep `Face_Sleeping`); the pet's clips are not shipped yet,
 * so the frontend falls back to procedural motion.
 */
export const NPC_EMOTES = {
  pet: ['Meow', 'AskForPets', 'Sleep', 'Walk'],
  tutorBot: ['Wave', 'Think', 'Celebrate', 'Encourage', 'Talk'],
} as const satisfies Record<NpcId, readonly string[]>;

export const TUTOR_BOT_IDLE_CLIP = 'IdleHover';
export const TUTOR_BOT_SLEEP_CLIP = 'Face_Sleeping';

/** Client to server: the member pressed E next to an NPC. */
export const NPC_INTERACT_MESSAGE = 'npc:interact';

export const npcInteractSchema = z.strictObject({
  npcId: z.enum(NPC_IDS),
});

export type NpcInteract = z.infer<typeof npcInteractSchema>;

/** Farthest an avatar may stand from an NPC (layout units) and still interact with it. */
export const NPC_INTERACT_MAX_DISTANCE = 1.8;

/** Minimum time between two interactions of the same member. */
export const NPC_INTERACT_COOLDOWN_MS = 4000;

export interface NpcHome {
  x: number;
  z: number;
  /** Facing angle in radians, `atan2(x, z)` convention. */
  rotation: number;
}

/** Cushion of the pet bed relative to its centre (`docs/art/classroom-pet.md`). */
const PET_CUSHION_OFFSET = { x: -0.12, z: -0.02 };
/** How far in front of the station (towards +x) the tutor bot waits. */
const TUTOR_BOT_STATION_CLEARANCE = 0.7;

/**
 * Where each NPC rests: the pet curls up on the bed cushion and the tutor bot waits on the floor in
 * front of its station, facing +x like the station. Derived from the layout props, so it follows
 * the room.
 */
export function deriveNpcHomes(layout: ClassroomLayout): Record<NpcId, NpcHome> {
  const prop = (id: PropObstacleId): PropObstacle => {
    const found = layout.props.find((p) => p.id === id);
    if (!found) throw new Error(`classroom layout has no ${id} prop`);
    return found;
  };
  const bed = prop('petBed');
  const station = prop('botStation');
  return {
    pet: {
      x: (bed.minX + bed.maxX) / 2 + PET_CUSHION_OFFSET.x,
      z: (bed.minZ + bed.maxZ) / 2 + PET_CUSHION_OFFSET.z,
      rotation: 0,
    },
    tutorBot: {
      x: station.maxX + TUTOR_BOT_STATION_CLEARANCE,
      z: (station.minZ + station.maxZ) / 2,
      rotation: Math.PI / 2,
    },
  };
}

/**
 * Short study and well-being phrases the tutor bot says when a member presses E. Clients receive
 * only the index (`phraseId`) and show the text from this list, so keep the order stable and
 * append new phrases at the end.
 */
export const TUTOR_BOT_PHRASES: readonly string[] = [
  'Estudiar un ratito todos los días rinde más que una maratón la noche anterior.',
  'Si algo no te sale, probá explicárselo a alguien: ahí descubrís qué te falta.',
  'Antes de un examen, repasá tus resúmenes y dormí bien. El descanso también estudia.',
  'Un error es una pista: fijate qué te enseña y seguí adelante.',
  'Dividí una tarea grande en pasos chiquitos. Es más fácil empezar.',
  'Preguntar no es de ingenuos: es de gente que quiere entender.',
  'Anotá tus pendientes de la semana. Tener todo a la vista da tranquilidad.',
  'Leer un poco cada día entrena la atención y suma vocabulario nuevo.',
  'Hacé pausas cortas cuando estudies: unos minutos para estirarte y volvés con energía.',
  'Si te trabás con un tema, pedí ayuda a tu docente o a un compañero. Nadie aprende solo.',
  'Subrayar lo importante y escribirlo con tus palabras te ayuda a recordarlo.',
  'Estás más preparado de lo que creés. Respirá hondo y confiá en lo que estudiaste.',
  'Un buen lugar de estudio, sin distracciones, hace que el tiempo rinda el doble.',
  'Hacer preguntas en clase ayuda a todo el grupo, no solo a vos.',
  'Armá un horario simple para tus tareas y andá tildando lo que terminás.',
  'Ayer no entendías y hoy sí: eso es aprender. Seguí así.',
  'Tomar agua y comer algo rico también ayuda a concentrarte.',
  'Antes de entregar una tarea, leela otra vez. Siempre aparece algo para mejorar.',
  'Estudiar en grupo con respeto y buen humor puede ser muy divertido.',
  'Cuando termines de estudiar, tomate un rato para jugar o descansar. Te lo ganaste.',
];
