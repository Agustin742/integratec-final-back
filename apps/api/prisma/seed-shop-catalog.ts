import { Prisma, ShopItemKind } from '@prisma/client';
import { type AvatarStyleKind, PAID_HAIR_IDS, PAID_TOP_IDS } from '../src/users/avatar-catalog';

export type SeedShopItem = Prisma.ShopItemCreateManyInput & {
  code: string;
  name: string;
  description: string;
  defaultPrice: number;
};

type AccessorySlot = 'head' | 'face' | 'back' | 'hand' | 'neck' | 'ears';

/** Colors mirror the front avatar catalog; update both together. */
const ACCESSORIES: ReadonlyArray<{
  slot: AccessorySlot;
  assetId: string;
  name: string;
  color: string;
  price: number;
}> = [
  { slot: 'head', assetId: 'headband', name: 'Vincha', color: '#F5B5AB', price: 80 },
  { slot: 'head', assetId: 'cap', name: 'Gorra', color: '#75B7DA', price: 100 },
  { slot: 'head', assetId: 'backwards-cap', name: 'Gorra al revés', color: '#E66861', price: 110 },
  { slot: 'head', assetId: 'beanie', name: 'Gorro de lana', color: '#7EBA8B', price: 110 },
  { slot: 'head', assetId: 'headphones', name: 'Auriculares', color: '#B5A7D6', price: 150 },
  {
    slot: 'head',
    assetId: 'graduation-cap',
    name: 'Birrete de graduación',
    color: '#5B4F96',
    price: 180,
  },
  { slot: 'head', assetId: 'top-hat', name: 'Galera', color: '#353849', price: 200 },
  { slot: 'head', assetId: 'crown', name: 'Corona', color: '#F7D86B', price: 240 },
  {
    slot: 'head',
    assetId: 'astronaut-helmet',
    name: 'Casco de astronauta',
    color: '#FFF9EB',
    price: 250,
  },
  { slot: 'face', assetId: 'face-paint', name: 'Pintura facial', color: '#E66861', price: 80 },
  {
    slot: 'face',
    assetId: 'round-glasses',
    name: 'Anteojos redondos',
    color: '#AF7B52',
    price: 90,
  },
  {
    slot: 'face',
    assetId: 'square-glasses',
    name: 'Anteojos cuadrados',
    color: '#5B4F96',
    price: 90,
  },
  { slot: 'face', assetId: 'face-mask', name: 'Barbijo', color: '#A9E7F4', price: 100 },
  { slot: 'face', assetId: 'sunglasses', name: 'Anteojos de sol', color: '#353849', price: 120 },
  { slot: 'face', assetId: 'masquerade-mask', name: 'Antifaz', color: '#C77DAA', price: 150 },
  { slot: 'back', assetId: 'backpack', name: 'Mochila', color: '#62CFC7', price: 120 },
  {
    slot: 'back',
    assetId: 'rolling-backpack',
    name: 'Mochila con ruedas',
    color: '#5B4F96',
    price: 150,
  },
  { slot: 'back', assetId: 'racket', name: 'Raqueta', color: '#65B96A', price: 160 },
  { slot: 'back', assetId: 'guitar', name: 'Guitarra', color: '#AF7B52', price: 200 },
  {
    slot: 'back',
    assetId: 'superhero-cape',
    name: 'Capa de superhéroe',
    color: '#E66861',
    price: 220,
  },
  { slot: 'back', assetId: 'wings', name: 'Alas', color: '#FFF9EB', price: 250 },
  { slot: 'hand', assetId: 'pencil', name: 'Lápiz', color: '#F7D86B', price: 80 },
  { slot: 'hand', assetId: 'book', name: 'Libro', color: '#5B4F96', price: 90 },
  { slot: 'hand', assetId: 'ruler', name: 'Regla', color: '#A9E7F4', price: 80 },
  { slot: 'hand', assetId: 'mug', name: 'Taza', color: '#E66861', price: 100 },
  { slot: 'hand', assetId: 'phone', name: 'Celular', color: '#353849', price: 150 },
  { slot: 'hand', assetId: 'mate', name: 'Mate', color: '#AF7B52', price: 130 },
  { slot: 'hand', assetId: 'magnifying-glass', name: 'Lupa', color: '#75B7DA', price: 120 },
  { slot: 'hand', assetId: 'paintbrush', name: 'Pincel', color: '#C77DAA', price: 100 },
  { slot: 'hand', assetId: 'tablet', name: 'Tablet', color: '#62CFC7', price: 180 },
  { slot: 'hand', assetId: 'trophy', name: 'Trofeo', color: '#F7D86B', price: 250 },
  { slot: 'neck', assetId: 'scarf', name: 'Bufanda', color: '#E66861', price: 110 },
  { slot: 'neck', assetId: 'necklace', name: 'Collar', color: '#B5A7D6', price: 130 },
  { slot: 'neck', assetId: 'bow-tie', name: 'Moño', color: '#5B4F96', price: 90 },
  {
    slot: 'neck',
    assetId: 'lanyard-badge',
    name: 'Credencial colgante',
    color: '#62CFC7',
    price: 80,
  },
  { slot: 'neck', assetId: 'bandana', name: 'Pañuelo', color: '#7EBA8B', price: 90 },
  {
    slot: 'neck',
    assetId: 'achievement-medal',
    name: 'Medalla de logro',
    color: '#F7D86B',
    price: 220,
  },
  { slot: 'ears', assetId: 'earrings', name: 'Aros', color: '#F5B5AB', price: 100 },
  {
    slot: 'ears',
    assetId: 'star-earrings',
    name: 'Aros de estrella',
    color: '#F7D86B',
    price: 140,
  },
  { slot: 'ears', assetId: 'ear-cuffs', name: 'Aros cuff', color: '#B5A7D6', price: 120 },
];

/** Desk decor shares the single `desk_decor` slot; asset ids match the front desk-decor models. */
const DESK_DECOR: ReadonlyArray<{ assetId: string; name: string; price: number }> = [
  { assetId: 'mug', name: 'Taza de escritorio', price: 80 },
  { assetId: 'plant', name: 'Planta de escritorio', price: 100 },
  { assetId: 'photo-frame', name: 'Portarretrato', price: 120 },
  { assetId: 'puzzle-cube', name: 'Cubo mágico', price: 140 },
  { assetId: 'mini-globe', name: 'Mini globo terráqueo', price: 180 },
  { assetId: 'lamp', name: 'Lámpara de escritorio', price: 200 },
  { assetId: 'figurine', name: 'Figura coleccionable', price: 220 },
];

/** Keyed by paid style id so a missing or extra entry fails type checking. */
const HAIR_STYLES: Record<(typeof PAID_HAIR_IDS)[number], { name: string; price: number }> = {
  'side-part': { name: 'Raya al costado', price: 80 },
  fringe: { name: 'Flequillo', price: 80 },
  wavy: { name: 'Ondulado', price: 90 },
  messy: { name: 'Despeinado', price: 100 },
  'long-curls': { name: 'Rulos largos', price: 120 },
  'long-wavy': { name: 'Ondas largas', price: 120 },
  'half-up': { name: 'Medio recogido', price: 130 },
  braid: { name: 'Trenza', price: 140 },
  'two-braids': { name: 'Dos trenzas', price: 150 },
  dreads: { name: 'Rastas', price: 160 },
  'two-pigtails': { name: 'Dos colitas', price: 160 },
  'box-braids': { name: 'Trenzas africanas', price: 180 },
  'soft-mohawk': { name: 'Mohicano suave', price: 190 },
  'afro-with-headband': { name: 'Afro con vincha', price: 200 },
};

const TOP_STYLES: Record<(typeof PAID_TOP_IDS)[number], { name: string; price: number }> = {
  'school-polo': { name: 'Chomba escolar', price: 80 },
  vest: { name: 'Chaleco', price: 90 },
  sweater: { name: 'Suéter', price: 100 },
  'flannel-shirt': { name: 'Camisa de franela', price: 110 },
  'track-jacket': { name: 'Campera deportiva', price: 130 },
  'denim-jacket': { name: 'Campera de jean', price: 140 },
  hoodie: { name: 'Buzo con capucha', price: 140 },
  'shirt-and-tie': { name: 'Camisa y corbata', price: 150 },
  'winter-coat': { name: 'Abrigo de invierno', price: 160 },
  'holiday-sweater': { name: 'Suéter festivo', price: 180 },
  'national-team-jersey': { name: 'Camiseta de la selección', price: 200 },
};

const snake = (id: string): string => id.replaceAll('-', '_');

function accessoryItems(): SeedShopItem[] {
  return ACCESSORIES.map(({ slot, assetId, name, color, price }) => ({
    code: `${slot}_${snake(assetId)}`,
    name,
    description: `${name} para personalizar tu avatar.`,
    kind: ShopItemKind.AVATAR_ACCESSORY,
    defaultPrice: price,
    isActive: true,
    isImplemented: true,
    metadata: { assetId, slot, color },
  }));
}

function deskDecorItems(): SeedShopItem[] {
  return DESK_DECOR.map(({ assetId, name, price }) => ({
    code: `desk_${snake(assetId)}`,
    name,
    description: `${name} para decorar tu escritorio.`,
    kind: ShopItemKind.DESK_UPGRADE,
    defaultPrice: price,
    isActive: true,
    isImplemented: true,
    metadata: { assetId, slot: 'desk_decor' },
  }));
}

function styleItems(
  styleType: AvatarStyleKind,
  styles: Record<string, { name: string; price: number }>,
): SeedShopItem[] {
  return Object.entries(styles).map(([styleId, { name, price }]) => ({
    code: `${styleType}_${snake(styleId)}`,
    name,
    description:
      styleType === 'hair'
        ? `Peinado "${name}" para tu avatar.`
        : `Prenda "${name}" para tu avatar.`,
    kind: ShopItemKind.AVATAR_STYLE,
    defaultPrice: price,
    isActive: true,
    isImplemented: true,
    metadata: { styleType, styleId },
  }));
}

/**
 * Synthetic local-only shop catalog: 40 avatar accessories, 7 desk decor items and 25 paid
 * hair/top styles.
 */
export const SHOP_CATALOG: readonly SeedShopItem[] = [
  ...accessoryItems(),
  ...deskDecorItems(),
  ...styleItems('hair', HAIR_STYLES),
  ...styleItems('top', TOP_STYLES),
];
