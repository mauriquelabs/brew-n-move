import { supabase } from '../auth/supabase';
import { parseInstructions } from '../rewards/offers';

export type RedeemReason =
  | 'budget_exhausted'
  | 'eligible'
  | 'insufficient_balance'
  | 'invalid_payload'
  | 'issued'
  | 'location_unavailable'
  | 'not_found'
  | 'not_onboarded'
  | 'not_signed_in'
  | 'offer_unavailable'
  | 'outside_geofence'
  | 'redeemed'
  | 'sold_out'
  | 'unavailable';

export type RedeemConfirmation = {
  discountCode: string | null;
  instructions: string[];
  location: string | null;
  offerId: string;
  partner: string;
  pointsSpent: number;
  redeemedAt: string;
  redemptionId: string;
  storeUrl: string | null;
  tillConfirmedAt: string | null;
  title: string;
  valueLabel: string;
};

export type RedeemResponse = {
  balance: number | null;
  confirmation: RedeemConfirmation | null;
  confirmed: boolean;
  reason: RedeemReason;
};

const confirmedReasons = new Set<RedeemReason>([
  'budget_exhausted',
  'eligible',
  'insufficient_balance',
  'invalid_payload',
  'issued',
  'location_unavailable',
  'not_found',
  'not_onboarded',
  'not_signed_in',
  'offer_unavailable',
  'outside_geofence',
  'redeemed',
  'sold_out',
]);

function unconfirmed(): RedeemResponse {
  return {
    balance: null,
    confirmation: null,
    confirmed: false,
    reason: 'unavailable',
  };
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function confirmationFrom(payload: Record<string, unknown>): RedeemConfirmation | null {
  const offerId = payload.offerId ?? payload.offer_id;
  const partner = payload.partner ?? payload.partner_name;
  const pointsSpent = payload.pointsSpent ?? payload.points_spent ?? payload.pointsCost ?? payload.points_cost;
  const redeemedAt = payload.redeemedAt ?? payload.redeemed_at;
  const redemptionId = payload.redemptionId ?? payload.redemption_id;
  const title = payload.title ?? payload.offer_title;
  const valueLabel = payload.valueLabel ?? payload.value_label;
  if (
    typeof offerId !== 'string'
    || typeof partner !== 'string'
    || typeof pointsSpent !== 'number'
    || typeof redeemedAt !== 'string'
    || typeof redemptionId !== 'string'
    || typeof title !== 'string'
    || typeof valueLabel !== 'string'
  ) {
    return null;
  }

  const tillConfirmedAt = payload.tillConfirmedAt ?? payload.till_confirmed_at;
  const location = payload.location ?? payload.location_name;
  const discountCode = optionalText(payload.discountCode ?? payload.discount_code);
  const storeUrl = optionalText(payload.storeUrl ?? payload.store_url);
  const instructions = parseInstructions(payload.instructions);

  return {
    discountCode,
    instructions,
    location: optionalText(location),
    offerId,
    partner,
    pointsSpent,
    redeemedAt,
    redemptionId,
    storeUrl,
    tillConfirmedAt: typeof tillConfirmedAt === 'string' ? tillConfirmedAt : null,
    title,
    valueLabel,
  };
}

function mapRedemptionRow(row: {
  discount_code?: string | null;
  id: string;
  instructions?: string[] | string | null;
  location_name: string | null;
  offer_id: string;
  offer_title: string;
  partner_name: string;
  points_spent: number;
  redeemed_at: string;
  store_url?: string | null;
  till_confirmed_at: string | null;
  value_label: string;
}): RedeemConfirmation {
  return {
    discountCode: optionalText(row.discount_code),
    instructions: parseInstructions(row.instructions),
    location: optionalText(row.location_name),
    offerId: row.offer_id,
    partner: row.partner_name || 'Partner',
    pointsSpent: row.points_spent,
    redeemedAt: row.redeemed_at,
    redemptionId: row.id,
    storeUrl: optionalText(row.store_url),
    tillConfirmedAt: row.till_confirmed_at,
    title: row.offer_title,
    valueLabel: row.value_label,
  };
}

async function postRedeem(body: Record<string, unknown>): Promise<RedeemResponse> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !apiKey) {
    return unconfirmed();
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return {
      balance: null,
      confirmation: null,
      confirmed: true,
      reason: 'not_signed_in',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 20_000);

  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/redeem`, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
  } catch {
    return unconfirmed();
  } finally {
    clearTimeout(timeout);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    return unconfirmed();
  }

  const reason = payload.reason;
  if (typeof reason !== 'string' || !confirmedReasons.has(reason as RedeemReason)) {
    return unconfirmed();
  }

  if (response.status >= 500) {
    return unconfirmed();
  }

  return {
    balance: typeof payload.balance === 'number' ? payload.balance : null,
    confirmation: reason === 'issued' || reason === 'redeemed' ? confirmationFrom(payload) : null,
    confirmed: true,
    reason: reason as RedeemReason,
  };
}

export function lookupVoucher(redemptionId: string) {
  return supabase
    .from('redemptions')
    .select('id, offer_id, partner_name, location_name, offer_title, value_label, points_spent, redeemed_at, till_confirmed_at, discount_code, store_url, instructions')
    .eq('id', redemptionId)
    .maybeSingle()
    .then(async ({ data, error }) => {
      if (!error && data) {
        return mapRedemptionRow(data);
      }

      const legacy = await supabase
        .from('redemptions')
        .select('id, offer_id, partner_name, location_name, offer_title, value_label, points_spent, redeemed_at, till_confirmed_at')
        .eq('id', redemptionId)
        .maybeSingle();
      if (legacy.error || !legacy.data) {
        return null;
      }
      return mapRedemptionRow(legacy.data);
    });
}

export function listMyRewards() {
  return supabase
    .from('redemptions')
    .select('id, offer_id, partner_name, location_name, offer_title, value_label, points_spent, redeemed_at, till_confirmed_at, discount_code, store_url, instructions')
    .order('redeemed_at', { ascending: false })
    .then(async ({ data, error }) => {
      if (!error && data) {
        return data.map(mapRedemptionRow);
      }

      const legacy = await supabase
        .from('redemptions')
        .select('id, offer_id, partner_name, location_name, offer_title, value_label, points_spent, redeemed_at, till_confirmed_at')
        .order('redeemed_at', { ascending: false });
      if (legacy.error || !legacy.data) {
        return null;
      }
      return legacy.data.map(mapRedemptionRow);
    });
}

export function submitExchange(body: { commit: boolean; offerId: string; requestId?: string }) {
  return postRedeem({
    action: 'exchange',
    commit: body.commit,
    offerId: body.offerId,
    requestId: body.requestId,
  });
}
