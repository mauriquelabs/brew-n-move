import type { IllustrationKind } from '../../components/OfferIllustration';
import { supabase } from '../auth/supabase';

export type Offer = {
  id: string;
  slug: string;
  partner: string;
  location: string | null;
  address: string | null;
  title: string;
  description: string;
  value: string;
  points: number;
  listPriceCents: number;
  payPriceCents: number;
  collectLabel: string | null;
  imageUrl: string | null;
  partnerLogoUrl: string | null;
  storeUrl: string | null;
  instructions: string[];
  availabilityLabel: string | null;
  statusLabel: string | null;
  validityLabel: string | null;
  terms: string | null;
  accent: string;
  illustration: IllustrationKind;
};

type CatalogOfferRow = {
  collect_end?: string | null;
  collect_start?: string | null;
  description: string;
  expires_at?: string | null;
  id: string;
  image_url: string | null;
  instructions?: string[] | string | null;
  list_price_cents: number;
  location_address: string | null;
  location_name: string | null;
  offer_type?: string | null;
  partner_logo_url?: string | null;
  partner_name: string | null;
  partner_store_url?: string | null;
  pay_price_cents: number;
  points_cost: number;
  quantity?: number | null;
  slug: string;
  starts_at?: string | null;
  title: string;
  value_label: string;
};

export const defaultRedeemInstructions = [
  'Copy your discount code.',
  'Open the partner store.',
  'Paste the code at checkout before you pay.',
];

function formatClock(value: string) {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) {
    return value;
  }

  return `${match[1]}:${match[2]}`;
}

function collectLabel(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) {
    return null;
  }

  return `Collect: ${formatClock(start)} - ${formatClock(end)}`;
}

export function parseInstructions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((step): step is string => typeof step === 'string')
      .map((step) => step.trim())
      .filter((step) => step.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((step) => step.replace(/^\d+[\).\s]+/, '').trim())
      .filter((step) => step.length > 0);
  }

  return [];
}

function optionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short' }).format(date);
}

export function mapCatalogOffer(row: CatalogOfferRow): Offer {
  const address = optionalText(row.location_address);
  const location = optionalText(row.location_name);
  const instructions = parseInstructions(row.instructions);
  const startsLabel = row.starts_at ? formatDay(row.starts_at) : null;
  const endsLabel = row.expires_at ? formatDay(row.expires_at) : null;
  const availabilityLabel = startsLabel && endsLabel
    ? `Available ${startsLabel} – ${endsLabel}`
    : endsLabel
      ? `Available until ${endsLabel}`
      : startsLabel
        ? `Available from ${startsLabel}`
        : null;

  return {
    accent: '#D9E8DF',
    address,
    availabilityLabel,
    collectLabel: collectLabel(row.collect_start, row.collect_end),
    description: row.description,
    id: row.id,
    illustration: 'flat-white',
    imageUrl: optionalText(row.image_url),
    instructions: instructions.length > 0 ? instructions : defaultRedeemInstructions,
    listPriceCents: row.list_price_cents,
    location,
    partner: optionalText(row.partner_name) ?? 'Partner',
    partnerLogoUrl: optionalText(row.partner_logo_url),
    payPriceCents: row.pay_price_cents,
    points: row.points_cost,
    slug: row.slug,
    statusLabel: optionalText(row.offer_type) === 'discount_code' ? 'Online discount code' : null,
    storeUrl: optionalText(row.partner_store_url),
    terms: null,
    title: row.title,
    validityLabel: endsLabel ? `Valid until ${endsLabel}` : null,
    value: row.value_label,
  };
}

export async function loadOffers() {
  const primary = await supabase
    .from('catalog_offers')
    .select(
      'id, slug, partner_name, partner_logo_url, partner_store_url, location_name, location_address, title, value_label, points_cost, description, list_price_cents, pay_price_cents, image_url, offer_type, instructions, starts_at, expires_at, quantity',
    )
    .order('partner_name')
    .order('title');

  if (!primary.error && primary.data) {
    return primary.data.map(mapCatalogOffer);
  }

  // Fallback while discount-code catalog columns are rolling out.
  const legacy = await supabase
    .from('catalog_offers')
    .select(
      'id, slug, partner_name, location_name, title, value_label, points_cost, location_address, description, list_price_cents, pay_price_cents, collect_start, collect_end, image_url',
    )
    .order('partner_name')
    .order('title');

  if (legacy.error || !legacy.data) {
    return null;
  }

  return legacy.data.map(mapCatalogOffer);
}

export async function loadOffer(id: string) {
  const primary = await supabase
    .from('catalog_offers')
    .select(
      'id, slug, partner_name, partner_logo_url, partner_store_url, location_name, location_address, title, value_label, points_cost, description, list_price_cents, pay_price_cents, image_url, offer_type, instructions, starts_at, expires_at, quantity',
    )
    .eq('id', id)
    .maybeSingle();

  if (!primary.error && primary.data) {
    return mapCatalogOffer(primary.data);
  }

  const legacy = await supabase
    .from('catalog_offers')
    .select(
      'id, slug, partner_name, location_name, title, value_label, points_cost, location_address, description, list_price_cents, pay_price_cents, collect_start, collect_end, image_url',
    )
    .eq('id', id)
    .maybeSingle();

  if (legacy.error || !legacy.data) {
    return null;
  }

  return mapCatalogOffer(legacy.data);
}
