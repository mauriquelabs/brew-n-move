import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

import { getPartner, type OfferSummary, type Partner } from '../lib/api';

type Props = {
  session: Session;
};

function statusLabel(status: string) {
  return status;
}

export function PartnerDetail({ session }: Props) {
  const { partnerId = '' } = useParams();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const payload = await getPartner(session, partnerId);
      setPartner(payload.partner as Partner);
      setOffers((payload.offers ?? []) as OfferSummary[]);
    } catch (caught) {
      setPartner(null);
      setOffers([]);
      setError(caught instanceof Error ? caught.message : 'unavailable');
    }
  }, [partnerId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!partner) {
    return (
      <main>
        <p><Link to="/partners">Partners</Link></p>
        {error ? (
          <p className="error">
            {error}
            {' '}
            <button onClick={() => void load()} type="button">Retry</button>
          </p>
        ) : <p>Loading…</p>}
      </main>
    );
  }

  return (
    <main>
      <p><Link to="/partners">Partners</Link></p>
      <header className="bar">
        <div>
          <h1>{partner.name}</h1>
          <p className="muted">
            {partner.storeUrl ? (
              <a href={partner.storeUrl} rel="noreferrer" target="_blank">{partner.storeUrl}</a>
            ) : 'No store URL yet'}
          </p>
        </div>
        <div className="actions">
          <Link to={`/partners/${partner.id}/edit`}>Edit partner</Link>
          <Link to={`/partners/${partner.id}/offers/new`}>New offer</Link>
        </div>
      </header>
      {partner.logoUrl ? (
        <p>
          <img alt="" height={48} src={partner.logoUrl} style={{ objectFit: 'contain' }} />
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <section>
        <h2>Offers</h2>
        {offers.length === 0 ? (
          <p>No offers yet. Create a discount-code offer for this partner.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Points</th>
                <th>Codes</th>
                <th>Window</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr key={offer.id}>
                  <td>
                    <Link to={`/partners/${partner.id}/offers/${offer.id}`}>{offer.title}</Link>
                  </td>
                  <td>{statusLabel(offer.status)}</td>
                  <td>{offer.pointsCost}</td>
                  <td>{offer.codesRemaining} / {offer.codesTotal}
                    {offer.quantity != null ? ` · guide ${offer.quantity}` : ''}
                  </td>
                  <td>
                    {(offer.startsAt ? offer.startsAt.slice(0, 10) : '—')}
                    {' → '}
                    {(offer.expiresAt ? offer.expiresAt.slice(0, 10) : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
