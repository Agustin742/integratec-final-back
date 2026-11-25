/** Single source of truth for the base avatar catalog (bodies, hair and tops). */
export const AVATAR_BODY_IDS = ['male', 'female'] as const;

export const FREE_HAIR_IDS = [
  'afro',
  'bob',
  'bun',
  'buzz-cut',
  'classic-short',
  'long-straight',
  'middle-part',
  'ponytail',
  'short-curls',
] as const;

/** Hair styles unlocked through the shop. */
export const PAID_HAIR_IDS = [
  'afro-with-headband',
  'box-braids',
  'braid',
  'dreads',
  'fringe',
  'half-up',
  'long-curls',
  'long-wavy',
  'messy',
  'side-part',
  'soft-mohawk',
  'two-braids',
  'two-pigtails',
  'wavy',
] as const;

export const FREE_TOP_IDS = [
  'basic-tshirt',
  'school-smock',
  'school-sweatshirt',
  'tank-top',
] as const;

/** Tops unlocked through the shop. */
export const PAID_TOP_IDS = [
  'denim-jacket',
  'flannel-shirt',
  'holiday-sweater',
  'hoodie',
  'national-team-jersey',
  'school-polo',
  'shirt-and-tie',
  'sweater',
  'track-jacket',
  'vest',
  'winter-coat',
] as const;

/** Every hair id, alphabetical. Allowed for both bodies. */
export const HAIR_IDS: readonly string[] = [...FREE_HAIR_IDS, ...PAID_HAIR_IDS].sort();
/** Every top id, alphabetical. Allowed for both bodies. */
export const TOP_IDS: readonly string[] = [...FREE_TOP_IDS, ...PAID_TOP_IDS].sort();

export type AvatarStyleKind = 'hair' | 'top';

const FREE_STYLES: Record<AvatarStyleKind, readonly string[]> = {
  hair: FREE_HAIR_IDS,
  top: FREE_TOP_IDS,
};

export function isFreeAvatarStyle(kind: AvatarStyleKind, id: string): boolean {
  return FREE_STYLES[kind].includes(id);
}
