import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

import { listPartners, type Partner } from '../lib/api';
import { supabase } from '../lib/supabase';

type Props = {
  onSession: (session: Session | null) => void;
  session: Session;
};

export function PartnerList({ onSession, session }: Props) {
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    return listPartners(session)
      .then((payload) => {
        setPartners((payload.partners ?? []) as Partner[]);
      })
      .catch((caught: Error) => {
        setPartners(null);
        setError(caught.message);
      });
  };

  useEffect(() => {
    void load();
  }, [session]);

  async function signOut() {
    await supabase.auth.signOut();
    onSession(null);
  }

  return (
    <main>
      <header className="bar">
        <h1>Partners</h1>
        <div className="actions">
          <Link to="/partners/new">New partner</Link>
          <button onClick={() => void signOut()} type="button">Sign out</button>
        </div>
      </header>
      <p className="muted">Create partners, then add discount-code offers from each partner page.</p>
      {error ? (
        <p className="error">
          {error}
          {' '}
          <button onClick={() => void load()} type="button">Retry</button>
        </p>
      ) : null}
      {partners ? (
        partners.length === 0 ? (
          <p>No partners yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Store</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((partner) => (
                <tr key={partner.id}>
                  <td><Link to={`/partners/${partner.id}`}>{partner.name}</Link></td>
                  <td>
                    {partner.storeUrl ? (
                      <a href={partner.storeUrl} rel="noreferrer" target="_blank">{partner.storeUrl}</a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : error ? null : <p>Loading…</p>}
      <p className="muted advanced">
        <Link to="/reward-budgets">Legacy reward budgets</Link>
      </p>
    </main>
  );
}
