import type { Session } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function invoke(
  name: string,
  session: Session,
  options: { body?: Record<string, unknown>; method?: string; query?: string } = {},
) {
  const response = await fetch(`${url}/functions/v1/${name}${options.query ?? ''}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: key,
      'Content-Type': 'application/json',
    },
    method: options.method ?? 'GET',
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || payload.ok === false) {
    throw new Error(typeof payload.reason === 'string' ? payload.reason : 'unavailable');
  }
  return payload;
}

export type Partner = {
  createdAt: string;
  id: string;
  logoUrl: string | null;
  name: string;
  storeUrl: string | null;
};

export type OfferSummary = {
  codesRemaining: number;
  codesTotal: number;
  createdAt?: string;
  expiresAt: string | null;
  id: string;
  offerType: string;
  pointsCost: number;
  quantity: number | null;
  startsAt: string | null;
  status: string;
  title: string;
};

export type DiscountOffer = OfferSummary & {
  description: string;
  instructions: string[];
  listPriceCents: number;
  partnerId: string | null;
  payPriceCents: number;
  slug: string;
  valueLabel: string;
};

export function listBudgets(session: Session) {
  return invoke('admin-reward-budgets', session);
}

export function getBudget(session: Session, id: string) {
  return invoke('admin-reward-budgets', session, { query: `?id=${id}` });
}

export function createBudget(session: Session, body: Record<string, unknown>) {
  return invoke('admin-reward-budgets', session, { body, method: 'POST' });
}

export function runBudgetAction(session: Session, body: Record<string, unknown>) {
  return invoke('admin-reward-action', session, { body, method: 'POST' });
}

export function getCampaigns(session: Session, budgetId: string) {
  return invoke('admin-campaign', session, { query: `?budgetId=${budgetId}` });
}

export function runCampaignAction(session: Session, body: Record<string, unknown>) {
  return invoke('admin-campaign', session, { body, method: 'POST' });
}

export function listPartners(session: Session) {
  return invoke('admin-partners', session);
}

export function getPartner(session: Session, id: string) {
  return invoke('admin-partners', session, { query: `?id=${id}` });
}

export function createPartner(session: Session, body: {
  logoUrl?: string | null;
  name: string;
  storeUrl?: string | null;
}) {
  return invoke('admin-partners', session, {
    body: { action: 'create', ...body },
    method: 'POST',
  });
}

export function updatePartner(session: Session, body: {
  id: string;
  logoUrl?: string | null;
  name: string;
  storeUrl?: string | null;
}) {
  return invoke('admin-partners', session, {
    body: { action: 'update', ...body },
    method: 'POST',
  });
}

export function listPartnerOffers(session: Session, partnerId: string) {
  return invoke('admin-offers', session, { query: `?partnerId=${partnerId}` });
}

export function getOffer(session: Session, id: string) {
  return invoke('admin-offers', session, { query: `?id=${id}` });
}

export function createOffer(session: Session, body: Record<string, unknown>) {
  return invoke('admin-offers', session, {
    body: { action: 'create', ...body },
    method: 'POST',
  });
}

export function updateOffer(session: Session, body: Record<string, unknown>) {
  return invoke('admin-offers', session, {
    body: { action: 'update', ...body },
    method: 'POST',
  });
}

export function setOfferStatus(session: Session, offerId: string, status: string) {
  return invoke('admin-offers', session, {
    body: { action: 'set-status', offerId, status },
    method: 'POST',
  });
}

export function addOfferCodes(session: Session, offerId: string, codes: string[]) {
  return invoke('admin-offers', session, {
    body: { action: 'add-codes', codes, offerId },
    method: 'POST',
  });
}
