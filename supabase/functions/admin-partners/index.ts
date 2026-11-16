import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { json, requireAdmin } from '../_shared/admin.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalUrl(value: unknown) {
  const trimmed = text(value);
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return trimmed;
  } catch {
    return undefined;
  }
}

type PartnerRow = {
  created_at: string;
  id: string;
  logo_url: string | null;
  name: string;
  store_url: string | null;
};

function mapPartner(row: PartnerRow) {
  return {
    createdAt: row.created_at,
    id: row.id,
    logoUrl: row.logo_url,
    name: row.name,
    storeUrl: row.store_url,
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

  if (req.method === 'GET') {
    if (id) {
      if (!uuidPattern.test(id)) {
        return json({ ok: false, reason: 'invalid_payload' }, 400);
      }
      const partner = await admin
        .from('partners')
        .select('id, name, logo_url, store_url, created_at')
        .eq('id', id)
        .maybeSingle();
      if (partner.error) {
        return json({ ok: false, reason: 'unavailable' }, 500);
      }
      if (!partner.data) {
        return json({ ok: false, reason: 'not_found' }, 404);
      }
      const offers = await admin
        .from('offers')
        .select('id, title, status, offer_type, points_cost, starts_at, expires_at, quantity, created_at')
        .eq('partner_id', id)
        .neq('status', 'removed')
        .order('created_at', { ascending: false });
      if (offers.error) {
        return json({ ok: false, reason: 'unavailable' }, 500);
      }
      const offerRows = offers.data ?? [];
      const offerIds = offerRows.map((row) => row.id as string);
      let codeStats = new Map<string, { remaining: number; total: number }>();
      if (offerIds.length > 0) {
        const codes = await admin
          .from('offer_discount_codes')
          .select('offer_id, redemption_id')
          .in('offer_id', offerIds);
        if (codes.error) {
          return json({ ok: false, reason: 'unavailable' }, 500);
        }
        codeStats = new Map();
        for (const row of codes.data ?? []) {
          const offerId = row.offer_id as string;
          const current = codeStats.get(offerId) ?? { remaining: 0, total: 0 };
          current.total += 1;
          if (row.redemption_id == null) {
            current.remaining += 1;
          }
          codeStats.set(offerId, current);
        }
      }
      return json({
        ok: true,
        offers: offerRows.map((row) => {
          const stats = codeStats.get(row.id as string) ?? { remaining: 0, total: 0 };
          return {
            codesRemaining: stats.remaining,
            codesTotal: stats.total,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            id: row.id,
            offerType: row.offer_type,
            pointsCost: row.points_cost,
            quantity: row.quantity,
            startsAt: row.starts_at,
            status: row.status,
            title: row.title,
          };
        }),
        partner: mapPartner(partner.data as PartnerRow),
      });
    }

    const listed = await admin
      .from('partners')
      .select('id, name, logo_url, store_url, created_at')
      .order('name');
    if (listed.error) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    return json({
      ok: true,
      partners: (listed.data ?? []).map((row) => mapPartner(row as PartnerRow)),
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
  const action = text(record.action) || 'upsert';
  const name = text(record.name);
  const logoUrl = optionalUrl(record.logoUrl);
  const storeUrl = optionalUrl(record.storeUrl);
  if (!name || logoUrl === undefined || storeUrl === undefined) {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }

  if (action === 'create') {
    const inserted = await admin
      .from('partners')
      .insert({
        logo_url: logoUrl,
        name,
        store_url: storeUrl,
      })
      .select('id, name, logo_url, store_url, created_at')
      .single();
    if (inserted.error || !inserted.data) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    return json({ ok: true, partner: mapPartner(inserted.data as PartnerRow) });
  }

  if (action !== 'update') {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }

  const partnerId = text(record.id);
  if (!uuidPattern.test(partnerId)) {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }
  const updated = await admin
    .from('partners')
    .update({
      logo_url: logoUrl,
      name,
      store_url: storeUrl,
    })
    .eq('id', partnerId)
    .select('id, name, logo_url, store_url, created_at')
    .maybeSingle();
  if (updated.error) {
    return json({ ok: false, reason: 'unavailable' }, 500);
  }
  if (!updated.data) {
    return json({ ok: false, reason: 'not_found' }, 404);
  }
  return json({ ok: true, partner: mapPartner(updated.data as PartnerRow) });
});
