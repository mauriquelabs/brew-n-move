import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

import { createPartner, getPartner, updatePartner } from '../lib/api';

type Props = {
  session: Session;
};

export function PartnerForm({ session }: Props) {
  const { partnerId } = useParams();
  const editing = Boolean(partnerId);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [storeUrl, setStoreUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);

  useEffect(() => {
    if (!partnerId) {
      return;
    }
    setLoading(true);
    getPartner(session, partnerId)
      .then((payload) => {
        const partner = payload.partner as { logoUrl: string | null; name: string; storeUrl: string | null };
        setName(partner.name);
        setLogoUrl(partner.logoUrl ?? '');
        setStoreUrl(partner.storeUrl ?? '');
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [partnerId, session]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing && partnerId) {
        await updatePartner(session, {
          id: partnerId,
          logoUrl: logoUrl || null,
          name,
          storeUrl: storeUrl || null,
        });
        navigate(`/partners/${partnerId}`);
        return;
      }
      const created = await createPartner(session, {
        logoUrl: logoUrl || null,
        name,
        storeUrl: storeUrl || null,
      });
      const id = (created.partner as { id: string }).id;
      navigate(`/partners/${id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'unavailable');
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="narrow">
        <p><Link to="/partners">Partners</Link></p>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="narrow">
      <p><Link to={partnerId ? `/partners/${partnerId}` : '/partners'}>Back</Link></p>
      <h1>{editing ? 'Edit partner' : 'New partner'}</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Name
          <input onChange={(event) => setName(event.target.value)} required value={name} />
        </label>
        <label>
          Logo URL
          <input onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://" value={logoUrl} />
        </label>
        <label>
          Store URL
          <input onChange={(event) => setStoreUrl(event.target.value)} placeholder="https://" value={storeUrl} />
        </label>
        <p className="muted">Store URL is used by members after they get a discount code.</p>
        {error ? <p className="error">{error}</p> : null}
        <button disabled={busy || !name.trim()} type="submit">{editing ? 'Save' : 'Create partner'}</button>
      </form>
    </main>
  );
}
