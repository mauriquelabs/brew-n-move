import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { json, requireAdmin } from '../_shared/admin.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const offerStatuses = new Set(['draft', 'paused', 'active', 'removed']);
const offerTypes = new Set(['discount_code', 'exclusive', 'venue', 'gift_card', 'experience']);

const defaultInstructions = [
  'Open this reward in Brew & Move and tap Get code.',
  'Copy your unique discount code.',
  'Open the partner store from the reward.',
  'Paste the code at checkout before you pay.',
];

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function asIso(value: unknown) {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return new Date(parsed).toISOString();
}

function asInstructions(value: unknown) {
  if (value == null) {
    return defaultInstructions;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const steps = value
    .map((step) => (typeof step === 'string' ? step.trim() : ''))
    .filter((step) => step.length > 0);
  return steps.length > 0 ? steps : null;
}

function normalizeCodes(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const code = entry.trim();
    if (!code || seen.has(code)) {
      continue;
    }
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

function slugFor(title: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'offer';
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

type OfferRow = {
  created_at: string;
  description: string;
  expires_at: string | null;
  id: string;
  instructions: string[] | null;
  list_price_cents: number;
  offer_type: string;
  partner_id: string | null;
  pay_price_cents: number;
  points_cost: number;
  quantity: number | null;
  slug: string;
  starts_at: string | null;
  status: string;
  title: string;
  value_label: string;
};

async function codeCounts(
  admin: { from: (table: string) => any },
  offerId: string,
) {
  const codes = await admin
    .from('offer_discount_codes')
    .select('redemption_id')
    .eq('offer_id', offerId);
  if (codes.error) {
    return null;
  }
  const rows = (codes.data ?? []) as Array<{ redemption_id: string | null }>;
  return {
    remaining: rows.filter((row) => row.redemption_id == null).length,
    total: rows.length,
  };
}

function mapOffer(row: OfferRow, counts: { remaining: number; total: number }) {
  return {
    codesRemaining: counts.remaining,
    codesTotal: counts.total,
    createdAt: row.created_at,
    description: row.description,
    expiresAt: row.expires_at,
    id: row.id,
    instructions: Array.isArray(row.instructions) && row.instructions.length > 0
      ? row.instructions
      : defaultInstructions,
    listPriceCents: row.list_price_cents,
    offerType: row.offer_type,
    partnerId: row.partner_id,
    payPriceCents: row.pay_price_cents,
    pointsCost: row.points_cost,
    quantity: row.quantity,
    slug: row.slug,
    startsAt: row.starts_at,
    status: row.status,
    title: row.title,
    valueLabel: row.value_label,
  };
}

Deno.serve(async (req) => {
  const auth = await requireAdmin(req);
  if ('preflight' in auth && auth.preflight) {
    return auth.preflight;
  }
  if ('error' in auth && auth.error) {
    return auth.error;
  }
  const { admin } = auth;
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  const partnerId = url.searchParams.get('partnerId') ?? '';

  if (req.method === 'GET') {
    if (id) {
      if (!uuidPattern.test(id)) {
        return json({ ok: false, reason: 'invalid_payload' }, 400);
      }
      const offer = await admin
        .from('offers')
        .select('id, partner_id, slug, title, description, value_label, points_cost, quantity, expires_at, starts_at, status, offer_type, list_price_cents, pay_price_cents, instructions, created_at')
        .eq('id', id)
        .maybeSingle();
      if (offer.error) {
        return json({ ok: false, reason: 'unavailable' }, 500);
      }
      if (!offer.data) {
        return json({ ok: false, reason: 'not_found' }, 404);
      }
      const counts = await codeCounts(admin, id);
      if (!counts) {
        return json({ ok: false, reason: 'unavailable' }, 500);
      }
      return json({
        defaultInstructions,
        offer: mapOffer(offer.data as OfferRow, counts),
        ok: true,
      });
    }

    if (!uuidPattern.test(partnerId)) {
      return json({ ok: false, reason: 'invalid_payload' }, 400);
    }
    const offers = await admin
      .from('offers')
      .select('id, partner_id, slug, title, description, value_label, points_cost, quantity, expires_at, starts_at, status, offer_type, list_price_cents, pay_price_cents, instructions, created_at')
      .eq('partner_id', partnerId)
      .neq('status', 'removed')
      .order('created_at', { ascending: false });
    if (offers.error) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    const mapped = [];
    for (const row of offers.data ?? []) {
      const counts = await codeCounts(admin, row.id as string);
      if (!counts) {
        return json({ ok: false, reason: 'unavailable' }, 500);
      }
      mapped.push(mapOffer(row as OfferRow, counts));
    }
    return json({ defaultInstructions, offers: mapped, ok: true });
  }

  if (req.method !== 'POST') {
    return json({ ok: false, reason: 'invalid_payload' }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const action = text(record.action);

  if (action === 'add-codes') {
    const offerId = text(record.offerId);
    const codes = normalizeCodes(record.codes);
    if (!uuidPattern.test(offerId) || !codes || codes.length === 0) {
      return json({ ok: false, reason: 'invalid_payload' }, 400);
    }
    const existing = await admin.from('offers').select('id, offer_type').eq('id', offerId).maybeSingle();
    if (existing.error) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    if (!existing.data || existing.data.offer_type !== 'discount_code') {
      return json({ ok: false, reason: 'not_found' }, 404);
    }
    const inserted = await admin
      .from('offer_discount_codes')
      .insert(codes.map((code) => ({ code, offer_id: offerId })))
      .select('id');
    if (inserted.error) {
      const message = typeof inserted.error.message === 'string' ? inserted.error.message : '';
      if (message.toLowerCase().includes('duplicate') || message.toLowerCase().includes('unique')) {
        return json({ ok: false, reason: 'duplicate_codes' }, 409);
      }
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    const counts = await codeCounts(admin, offerId);
    return json({
      added: inserted.data?.length ?? codes.length,
      codesRemaining: counts?.remaining ?? 0,
      codesTotal: counts?.total ?? 0,
      ok: true,
    });
  }

  if (action === 'set-status') {
    const offerId = text(record.offerId);
    const status = text(record.status);
    if (!uuidPattern.test(offerId) || !offerStatuses.has(status)) {
      return json({ ok: false, reason: 'invalid_payload' }, 400);
    }
    const offer = await admin
      .from('offers')
      .select('id, offer_type, status')
      .eq('id', offerId)
      .maybeSingle();
    if (offer.error) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    if (!offer.data || offer.data.offer_type !== 'discount_code') {
      return json({ ok: false, reason: 'not_found' }, 404);
    }
    if (status === 'active') {
      const counts = await codeCounts(admin, offerId);
      if (!counts) {
        return json({ ok: false, reason: 'unavailable' }, 500);
      }
      if (counts.total < 1) {
        return json({ ok: false, reason: 'codes_required' }, 409);
      }
    }
    const updated = await admin
      .from('offers')
      .update({ status })
      .eq('id', offerId)
      .select('id, partner_id, slug, title, description, value_label, points_cost, quantity, expires_at, starts_at, status, offer_type, list_price_cents, pay_price_cents, instructions, created_at')
      .maybeSingle();
    if (updated.error || !updated.data) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    const counts = await codeCounts(admin, offerId);
    return json({
      offer: mapOffer(updated.data as OfferRow, counts ?? { remaining: 0, total: 0 }),
      ok: true,
    });
  }

  if (action !== 'create' && action !== 'update') {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }

  const title = text(record.title);
  const description = text(record.description);
  const valueLabel = text(record.valueLabel) || title;
  const offerType = text(record.offerType) || 'discount_code';
  const listPriceCents = asInteger(record.listPriceCents);
  const payPriceCents = asInteger(record.payPriceCents);
  const pointsCost = asInteger(record.pointsCost);
  const quantity = asInteger(record.quantity);
  const startsAt = asIso(record.startsAt);
  const expiresAt = asIso(record.expiresAt);
  const instructions = asInstructions(record.instructions);
  const status = text(record.status) || 'draft';

  if (
    !title
    || !description
    || !offerTypes.has(offerType)
    || offerType !== 'discount_code'
    || listPriceCents == null
    || listPriceCents <= 0
    || payPriceCents == null
    || payPriceCents < 0
    || payPriceCents > listPriceCents
    || pointsCost == null
    || pointsCost <= 0
    || quantity == null
    || quantity < 1
    || startsAt === undefined
    || expiresAt === undefined
    || !instructions
    || !offerStatuses.has(status)
    || status === 'removed'
  ) {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }

  if (startsAt && expiresAt && Date.parse(startsAt) > Date.parse(expiresAt)) {
    return json({ ok: false, reason: 'invalid_dates' }, 400);
  }

  if (action === 'create') {
    const createPartnerId = text(record.partnerId);
    if (!uuidPattern.test(createPartnerId)) {
      return json({ ok: false, reason: 'invalid_payload' }, 400);
    }
    const initialCodes = normalizeCodes(record.codes) ?? [];
    if (status === 'active' && initialCodes.length < 1) {
      return json({ ok: false, reason: 'codes_required' }, 409);
    }
    const partner = await admin.from('partners').select('id').eq('id', createPartnerId).maybeSingle();
    if (partner.error) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    if (!partner.data) {
      return json({ ok: false, reason: 'partner_not_found' }, 404);
    }
    const inserted = await admin
      .from('offers')
      .insert({
        description,
        expires_at: expiresAt,
        instructions,
        list_price_cents: listPriceCents,
        location_id: null,
        offer_type: offerType,
        partner_id: createPartnerId,
        pay_price_cents: payPriceCents,
        points_cost: pointsCost,
        quantity,
        slug: slugFor(title),
        starts_at: startsAt,
        status: status === 'active' ? 'draft' : status,
        title,
        value_label: valueLabel,
      })
      .select('id, partner_id, slug, title, description, value_label, points_cost, quantity, expires_at, starts_at, status, offer_type, list_price_cents, pay_price_cents, instructions, created_at')
      .single();
    if (inserted.error || !inserted.data) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    if (initialCodes.length > 0) {
      const coded = await admin
        .from('offer_discount_codes')
        .insert(initialCodes.map((code) => ({ code, offer_id: inserted.data.id })));
      if (coded.error) {
        const message = typeof coded.error.message === 'string' ? coded.error.message : '';
        if (message.toLowerCase().includes('duplicate') || message.toLowerCase().includes('unique')) {
          return json({ id: inserted.data.id, ok: false, reason: 'duplicate_codes' }, 409);
        }
        return json({ id: inserted.data.id, ok: false, reason: 'unavailable' }, 500);
      }
    }
    let row = inserted.data as OfferRow;
    if (status === 'active') {
      const activated = await admin
        .from('offers')
        .update({ status: 'active' })
        .eq('id', inserted.data.id)
        .select('id, partner_id, slug, title, description, value_label, points_cost, quantity, expires_at, starts_at, status, offer_type, list_price_cents, pay_price_cents, instructions, created_at')
        .single();
      if (activated.error || !activated.data) {
        return json({ id: inserted.data.id, ok: false, reason: 'unavailable' }, 500);
      }
      row = activated.data as OfferRow;
    }
    const counts = await codeCounts(admin, inserted.data.id as string);
    return json({
      offer: mapOffer(row, counts ?? { remaining: 0, total: 0 }),
      ok: true,
    });
  }

  const offerId = text(record.offerId);
  if (!uuidPattern.test(offerId)) {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }
  const current = await admin
    .from('offers')
    .select('id, offer_type, status')
    .eq('id', offerId)
    .maybeSingle();
  if (current.error) {
    return json({ ok: false, reason: 'unavailable' }, 500);
  }
  if (!current.data || current.data.offer_type !== 'discount_code') {
    return json({ ok: false, reason: 'not_found' }, 404);
  }
  if (status === 'active') {
    const counts = await codeCounts(admin, offerId);
    if (!counts) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    if (counts.total < 1) {
      return json({ ok: false, reason: 'codes_required' }, 409);
    }
  }
  const updated = await admin
    .from('offers')
    .update({
      description,
      expires_at: expiresAt,
      instructions,
      list_price_cents: listPriceCents,
      pay_price_cents: payPriceCents,
      points_cost: pointsCost,
      quantity,
      starts_at: startsAt,
      status,
      title,
      value_label: valueLabel,
    })
    .eq('id', offerId)
    .select('id, partner_id, slug, title, description, value_label, points_cost, quantity, expires_at, starts_at, status, offer_type, list_price_cents, pay_price_cents, instructions, created_at')
    .maybeSingle();
  if (updated.error || !updated.data) {
    return json({ ok: false, reason: 'unavailable' }, 500);
  }
  const counts = await codeCounts(admin, offerId);
  return json({
    offer: mapOffer(updated.data as OfferRow, counts ?? { remaining: 0, total: 0 }),
    ok: true,
  });
});
