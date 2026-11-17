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

type ListedOfferRow = {
  codes_available: number;
  codes_total: number;
  created_at: string;
  expires_at: string | null;
  id: string;
  points_cost: number;
  quantity: number | null;
  starts_at: string | null;
  status: string;
  title: string;
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

async function loadPartner(
  admin: { from: (table: string) => any },
  partnerId: string,
) {
  const partner = await admin
    .from('partners')
    .select('id, name, logo_url, store_url, created_at')
    .eq('id', partnerId)
    .maybeSingle();
  if (partner.error) {
    return { error: json({ ok: false, reason: 'unavailable' }, 500) };
  }
  if (!partner.data) {
    return { error: json({ ok: false, reason: 'not_found' }, 404) };
  }
  return { partner: mapPartner(partner.data as PartnerRow) };
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
      const loaded = await loadPartner(admin, id);
      if ('error' in loaded && loaded.error) {
        return loaded.error;
      }
      const offers = await admin.rpc('admin_list_partner_discount_offers', {
        p_partner_id: id,
      });
      if (offers.error) {
        return json({ ok: false, reason: 'unavailable' }, 500);
      }
      const offerRows = (offers.data ?? []) as ListedOfferRow[];
      return json({
        ok: true,
        offers: offerRows
          .filter((row) => row.status !== 'removed')
          .map((row) => ({
            codesRemaining: row.codes_available,
            codesTotal: row.codes_total,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            id: row.id,
            offerType: 'discount_code',
            pointsCost: row.points_cost,
            quantity: row.quantity,
            startsAt: row.starts_at,
            status: row.status,
            title: row.title,
          })),
        partner: loaded.partner,
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
    const inserted = await admin.rpc('admin_upsert_partner', {
      p_id: null,
      p_logo_url: logoUrl,
      p_name: name,
      p_store_url: storeUrl,
    });
    if (inserted.error) {
      return json({ ok: false, reason: 'unavailable' }, 500);
    }
    const payload = inserted.data as { id?: string; ok?: boolean; reason?: string } | null;
    if (!payload || payload.ok === false || typeof payload.id !== 'string') {
      return json({
        ok: false,
        reason: typeof payload?.reason === 'string' ? payload.reason : 'unavailable',
      }, 400);
    }
    const loaded = await loadPartner(admin, payload.id);
    if ('error' in loaded && loaded.error) {
      return loaded.error;
    }
    return json({ ok: true, partner: loaded.partner });
  }

  if (action !== 'update') {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }

  const partnerId = text(record.id);
  if (!uuidPattern.test(partnerId)) {
    return json({ ok: false, reason: 'invalid_payload' }, 400);
  }
  const updated = await admin.rpc('admin_upsert_partner', {
    p_id: partnerId,
    p_logo_url: logoUrl,
    p_name: name,
    p_store_url: storeUrl,
  });
  if (updated.error) {
    return json({ ok: false, reason: 'unavailable' }, 500);
  }
  const payload = updated.data as { id?: string; ok?: boolean; reason?: string } | null;
  if (!payload || payload.ok === false) {
    const reason = typeof payload?.reason === 'string' ? payload.reason : 'unavailable';
    return json({ ok: false, reason }, reason === 'not_found' ? 404 : 400);
  }
  const loaded = await loadPartner(admin, partnerId);
  if ('error' in loaded && loaded.error) {
    return loaded.error;
  }
  return json({ ok: true, partner: loaded.partner });
});
