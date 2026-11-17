import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { json, requireAdmin } from '../_shared/admin.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const offerStatuses = new Set(['draft', 'paused', 'active', 'removed']);

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

function mapReason(reason: string | undefined) {
  if (reason === 'needs_codes') {
    return 'codes_required';
  }
  return reason || 'unavailable';
}

function statusForReason(reason: string) {
  if (reason === 'not_found' || reason === 'partner_not_found') {
    return 404;
  }
  if (
    reason === 'codes_required'
    || reason === 'duplicate_codes'
    || reason === 'slug_taken'
    || reason === 'removed_terminal'
    || reason === 'cannot_draft_after_publish'
    || reason === 'invalid_transition'
    || reason === 'wrong_offer_type'
  ) {
    return 409;
  }
  if (reason === 'invalid_payload' || reason === 'invalid_dates') {
    return 400;
  }
  return 500;
}

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  from: (table: string) => any;
};

type ListOfferRow = {
  codes_available: number;
  codes_total: number;
  created_at: string;
  description: string;
  expires_at: string | null;
  id: string;
  image_url: string | null;
  instructions: string[] | null;
  list_price_cents: number;
  pay_price_cents: number;
  points_cost: number;
  quantity: number | null;
  slug: string;
  starts_at: string | null;
  status: string;
  title: string;
  value_label: string;
};

function mapListedOffer(row: ListOfferRow, partnerId: string | null = null) {
  return {
    codesRemaining: row.codes_available,
    codesTotal: row.codes_total,
    createdAt: row.created_at,
    description: row.description,
    expiresAt: row.expires_at,
    id: row.id,
    instructions: Array.isArray(row.instructions) && row.instructions.length > 0
      ? row.instructions
      : defaultInstructions,
    listPriceCents: row.list_price_cents,
    offerType: 'discount_code',
    partnerId,
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

async function rpcJson(admin: RpcClient, fn: string, args: Record<string, unknown>) {
  const result = await admin.rpc(fn, args);
  if (result.error) {
    return { error: json({ ok: false, reason: 'unavailable' }, 500) };
  }
  const payload = result.data as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object') {
    return { error: json({ ok: false, reason: 'unavailable' }, 500) };
  }
  if (payload.ok === false) {
    const reason = mapReason(typeof payload.reason === 'string' ? payload.reason : undefined);
    return { error: json({ ok: false, reason }, statusForReason(reason)) };
  }
  return { payload };
}

async function loadOffer(admin: RpcClient, offerId: string) {
  const offer = await admin
    .from('offers')
    .select('id, partner_id, slug, title, description, value_label, points_cost, quantity, expires_at, starts_at, status, offer_type, list_price_cents, pay_price_cents, instructions, created_at')
    .eq('id', offerId)
    .eq('offer_type', 'discount_code')
    .maybeSingle();
  if (offer.error) {
    return { error: json({ ok: false, reason: 'unavailable' }, 500) };
  }
  if (!offer.data) {
    return { error: json({ ok: false, reason: 'not_found' }, 404) };
  }
  const inventory = await rpcJson(admin, 'admin_discount_offer_inventory', {
    p_offer_id: offerId,
  });
  if ('error' in inventory && inventory.error) {
    return inventory;
  }
  const counts = inventory.payload as {
    available?: number;
    total?: number;
  };
  const row = offer.data as {
    created_at: string;
    description: string;
    expires_at: string | null;
    id: string;
    instructions: string[] | null;
    list_price_cents: number;
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
  return {
    offer: mapListedOffer({
      codes_available: typeof counts.available === 'number' ? counts.available : 0,
      codes_total: typeof counts.total === 'number' ? counts.total : 0,
      created_at: row.created_at,
      description: row.description,
      expires_at: row.expires_at,
      id: row.id,
      image_url: null,
      instructions: row.instructions,
      list_price_cents: row.list_price_cents,
      pay_price_cents: row.pay_price_cents,
      points_cost: row.points_cost,
      quantity: row.quantity,
      slug: row.slug,
      starts_at: row.starts_at,
      status: row.status,
      title: row.title,
      value_label: row.value_label,
    }, row.partner_id),
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
      const loaded = await loadOffer(admin, id);
      if ('error' in loaded && loaded.error) {
        return loaded.error;
      }
      return json({
        defaultInstructions,
        offer: loaded.offer,
        ok: true,
      });
    }

    if (!uuidPattern.test(partnerId)) {
      return json({ ok: false, reason: 'invalid_payload' }, 400);
    }
    const listed = await admin.rpc('admin_list_partner_discount_offers', {
      p_partner_id: partnerId,
    });
    if (listed.error) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    const rows = (listed.data ?? []) as ListOfferRow[];
    return json({
      defaultInstructions,
      offers: rows
        .filter((row) => row.status !== 'removed')
        .map((row) => mapListedOffer(row, partnerId)),
      ok: true,
    });
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
    const uploaded = await rpcJson(admin, 'admin_upload_discount_codes', {
      p_codes: codes,
      p_offer_id: offerId,
    });
    if ('error' in uploaded && uploaded.error) {
      return uploaded.error;
    }
    const payload = uploaded.payload as {
      available?: number;
      inserted?: number;
      total?: number;
    };
    return json({
      added: typeof payload.inserted === 'number' ? payload.inserted : codes.length,
      codesRemaining: typeof payload.available === 'number' ? payload.available : 0,
      codesTotal: typeof payload.total === 'number' ? payload.total : 0,
      ok: true,
    });
  }

  if (action === 'set-status') {
    const offerId = text(record.offerId);
    const status = text(record.status);
    if (!uuidPattern.test(offerId) || !offerStatuses.has(status)) {
      return json({ ok: false, reason: 'invalid_payload' }, 400);
    }
    const changed = await rpcJson(admin, 'admin_set_discount_offer_status', {
      p_offer_id: offerId,
      p_status: status,
    });
    if ('error' in changed && changed.error) {
      return changed.error;
    }
    const loaded = await loadOffer(admin, offerId);
    if ('error' in loaded && loaded.error) {
      return loaded.error;
    }
    return json({
      offer: loaded.offer,
      ok: true,
    });
  }

  if (action !== 'create' && action !== 'update') {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }

  const title = text(record.title);
  const description = text(record.description);
  const valueLabel = text(record.valueLabel) || title;
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
    || (action === 'create' && status !== 'draft' && status !== 'active')
  ) {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }

  if (startsAt && expiresAt && Date.parse(startsAt) >= Date.parse(expiresAt)) {
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

    const created = await rpcJson(admin, 'admin_upsert_discount_offer', {
      p_codes: initialCodes.length > 0 ? initialCodes : null,
      p_description: description,
      p_expires_at: expiresAt,
      p_image_url: null,
      p_instructions: instructions,
      p_list_price_cents: listPriceCents,
      p_offer_id: null,
      p_partner_id: createPartnerId,
      p_pay_price_cents: payPriceCents,
      p_points_cost: pointsCost,
      p_quantity: quantity,
      p_slug: slugFor(title),
      p_starts_at: startsAt,
      p_status: status,
      p_title: title,
      p_value_label: valueLabel,
    });
    if ('error' in created && created.error) {
      return created.error;
    }
    const createdId = text((created.payload as { id?: unknown }).id);
    if (!uuidPattern.test(createdId)) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    const loaded = await loadOffer(admin, createdId);
    if ('error' in loaded && loaded.error) {
      return loaded.error;
    }
    return json({
      offer: loaded.offer,
      ok: true,
    });
  }

  const offerId = text(record.offerId);
  if (!uuidPattern.test(offerId)) {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }

  const current = await loadOffer(admin, offerId);
  if ('error' in current && current.error) {
    return current.error;
  }
  const partnerIdForUpdate = text(current.offer?.partnerId);
  if (!uuidPattern.test(partnerIdForUpdate)) {
    return json({ ok: false, reason: 'unavailable' }, 500);
  }

  const updated = await rpcJson(admin, 'admin_upsert_discount_offer', {
    p_codes: null,
    p_description: description,
    p_expires_at: expiresAt,
    p_image_url: null,
    p_instructions: instructions,
    p_list_price_cents: listPriceCents,
    p_offer_id: offerId,
    p_partner_id: partnerIdForUpdate,
    p_pay_price_cents: payPriceCents,
    p_points_cost: pointsCost,
    p_quantity: quantity,
    p_slug: text(current.offer?.slug) || slugFor(title),
    p_starts_at: startsAt,
    p_status: 'draft',
    p_title: title,
    p_value_label: valueLabel,
  });
  if ('error' in updated && updated.error) {
    return updated.error;
  }

  // Field upsert never changes status. Apply an explicit transition when asked.
  if (status === 'active' || status === 'paused' || status === 'removed') {
    if (current.offer?.status !== status) {
      const changed = await rpcJson(admin, 'admin_set_discount_offer_status', {
        p_offer_id: offerId,
        p_status: status,
      });
      if ('error' in changed && changed.error) {
        return changed.error;
      }
    }
  }

  const loaded = await loadOffer(admin, offerId);
  if ('error' in loaded && loaded.error) {
    return loaded.error;
  }
  return json({
    offer: loaded.offer,
    ok: true,
  });
});
