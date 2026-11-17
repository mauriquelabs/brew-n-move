import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

import {
  addOfferCodes,
  createOffer,
  getOffer,
  getPartner,
  setOfferStatus,
  updateOffer,
  type DiscountOffer,
} from '../lib/api';
import {
  campaignFromCoffeeAndDiscount,
  parseEuroToCents,
  parsePercent,
} from '../lib/money';

type Props = {
  session: Session;
};

const DISABLED_TYPES = [
  { label: 'Exclusive (coming soon)', value: 'exclusive' },
  { label: 'Venue (coming soon)', value: 'venue' },
  { label: 'Gift card (coming soon)', value: 'gift_card' },
  { label: 'Experience (coming soon)', value: 'experience' },
] as const;

const DEFAULT_INSTRUCTIONS = [
  'Open this reward in Brew & Move and tap Get code.',
  'Copy your unique discount code.',
  'Open the partner store from the reward.',
  'Paste the code at checkout before you pay.',
];

function emptyForm() {
  return {
    codesText: '',
    description: '',
    discountPercent: '20',
    expiresAt: '',
    instructions: [...DEFAULT_INSTRUCTIONS],
    listPrice: '4.50',
    quantity: '10',
    startsAt: '',
    title: '',
  };
}

function toLocalInput(value: string | null | undefined) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseCodes(text: string) {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const part of text.split(/[\n,]+/)) {
    const code = part.trim();
    if (!code || seen.has(code)) {
      continue;
    }
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

function reasonCopy(reason: string) {
  if (reason === 'codes_required' || reason === 'needs_codes') {
    return 'Upload at least one unused discount code before publishing.';
  }
  if (reason === 'duplicate_codes') {
    return 'One or more codes are already used. Remove duplicates and try again.';
  }
  if (reason === 'invalid_dates') {
    return 'End date must be on or after the start date.';
  }
  if (reason === 'removed_terminal') {
    return 'This offer was removed and cannot be changed.';
  }
  if (reason === 'cannot_draft_after_publish' || reason === 'invalid_transition') {
    return 'That status change is not allowed.';
  }
  return reason;
}

export function OfferForm({ session }: Props) {
  const { partnerId = '', offerId } = useParams();
  const editing = Boolean(offerId);
  const navigate = useNavigate();
  const [partnerName, setPartnerName] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [offer, setOffer] = useState<DiscountOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appendCodes, setAppendCodes] = useState('');

  const listCents = parseEuroToCents(form.listPrice);
  const discountPercent = parsePercent(form.discountPercent);
  const pricing = listCents != null && listCents > 0 && discountPercent != null && discountPercent > 0
    ? campaignFromCoffeeAndDiscount(listCents, discountPercent)
    : null;
  const parsedCodes = parseCodes(form.codesText);
  const quantity = Number.parseInt(form.quantity, 10);
  const guideOk = Number.isInteger(quantity) && quantity > 0;
  const codesTotal = offer?.codesTotal ?? 0;
  const canPublish = codesTotal + (editing ? parseCodes(appendCodes).length : parsedCodes.length) >= 1;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      const partnerPayload = await getPartner(session, partnerId);
      if (cancelled) {
        return;
      }
      setPartnerName((partnerPayload.partner as { name: string }).name);
      if (!offerId) {
        setForm(emptyForm());
        setOffer(null);
        setLoading(false);
        return;
      }
      const offerPayload = await getOffer(session, offerId);
      if (cancelled) {
        return;
      }
      const next = offerPayload.offer as DiscountOffer;
      setOffer(next);
      const percent = next.listPriceCents > 0
        ? ((next.listPriceCents - next.payPriceCents) * 100) / next.listPriceCents
        : 20;
      setForm({
        codesText: '',
        description: next.description,
        discountPercent: Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/\.?0+$/, ''),
        expiresAt: toLocalInput(next.expiresAt),
        instructions: next.instructions.length > 0 ? next.instructions : [...DEFAULT_INSTRUCTIONS],
        listPrice: (next.listPriceCents / 100).toFixed(2),
        quantity: String(next.quantity ?? 10),
        startsAt: toLocalInput(next.startsAt),
        title: next.title,
      });
      setLoading(false);
    };
    void load().catch((caught: Error) => {
      if (!cancelled) {
        setError(caught.message);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [offerId, partnerId, session]);

  function setField<K extends keyof ReturnType<typeof emptyForm>>(name: K, value: ReturnType<typeof emptyForm>[K]) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function setInstruction(index: number, value: string) {
    setForm((current) => {
      const instructions = [...current.instructions];
      instructions[index] = value;
      return { ...current, instructions };
    });
  }

  function moveInstruction(index: number, delta: number) {
    setForm((current) => {
      const next = index + delta;
      if (next < 0 || next >= current.instructions.length) {
        return current;
      }
      const instructions = [...current.instructions];
      const [item] = instructions.splice(index, 1);
      instructions.splice(next, 0, item);
      return { ...current, instructions };
    });
  }

  function removeInstruction(index: number) {
    setForm((current) => ({
      ...current,
      instructions: current.instructions.filter((_, i) => i !== index),
    }));
  }

  function addInstruction() {
    setForm((current) => ({
      ...current,
      instructions: [...current.instructions, ''],
    }));
  }

  function offerBody() {
    return {
      description: form.description,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      instructions: form.instructions.map((step) => step.trim()).filter(Boolean),
      listPriceCents: listCents,
      offerType: 'discount_code',
      partnerId,
      payPriceCents: pricing!.payCents,
      pointsCost: pricing!.pointsCost,
      quantity,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      title: form.title,
      valueLabel: pricing!.valueLabel,
    };
  }

  async function save(event: FormEvent, intent: 'draft' | 'active' | 'fields') {
    event.preventDefault();
    if (!pricing || !guideOk) {
      setError('Enter a full price, discount percentage, and code quantity guide of at least 1.');
      return;
    }
    if (intent === 'active' && !canPublish && !editing) {
      setError('Upload at least one discount code before publishing.');
      return;
    }
    if (intent === 'active' && editing && codesTotal < 1 && parseCodes(appendCodes).length < 1) {
      setError('Upload at least one discount code before publishing.');
      return;
    }
    if (offer?.status === 'removed') {
      setError(reasonCopy('removed_terminal'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!editing) {
        const created = await createOffer(session, {
          ...offerBody(),
          codes: parsedCodes,
          status: intent === 'active' ? 'active' : 'draft',
        });
        const createdOffer = created.offer as DiscountOffer;
        setNotice(intent === 'active' ? 'Published.' : 'Draft saved.');
        navigate(`/partners/${partnerId}/offers/${createdOffer.id}`, { replace: true });
        return;
      }
      if (parseCodes(appendCodes).length > 0) {
        await addOfferCodes(session, offerId!, parseCodes(appendCodes));
        setAppendCodes('');
      }
      // Field updates never change status. Publish/pause/remove use set-status.
      const updated = await updateOffer(session, {
        ...offerBody(),
        offerId,
        status: offer?.status === 'active' ? 'active' : offer?.status === 'paused' ? 'paused' : 'draft',
      });
      let next = updated.offer as DiscountOffer;
      if (intent === 'active' && next.status !== 'active') {
        const published = await setOfferStatus(session, offerId!, 'active');
        next = published.offer as DiscountOffer;
      }
      setOffer(next);
      setNotice(intent === 'active' ? 'Published.' : 'Saved.');
    } catch (caught) {
      setError(reasonCopy(caught instanceof Error ? caught.message : 'unavailable'));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: 'paused' | 'removed' | 'active') {
    if (!offerId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await setOfferStatus(session, offerId, status);
      setOffer(updated.offer as DiscountOffer);
      setNotice(status === 'paused' ? 'Paused.' : status === 'removed' ? 'Removed.' : 'Published.');
    } catch (caught) {
      setError(reasonCopy(caught instanceof Error ? caught.message : 'unavailable'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="narrow">
        <p><Link to={`/partners/${partnerId}`}>Back</Link></p>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="narrow">
      <p><Link to={`/partners/${partnerId}`}>{partnerName || 'Partner'}</Link></p>
      <h1>{editing ? 'Edit offer' : 'New offer'}</h1>
      {offer ? (
        <p className="muted">
          Status: {offer.status}
          {' · '}
          Codes {offer.codesRemaining}/{offer.codesTotal}
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
      <form onSubmit={(event) => void save(event, editing ? 'fields' : 'draft')}>
        <label>
          Name
          <input
            disabled={offer?.status === 'removed'}
            onChange={(event) => setField('title', event.target.value)}
            required
            value={form.title}
          />
        </label>
        <label>
          Description
          <textarea onChange={(event) => setField('description', event.target.value)} required value={form.description} />
        </label>
        <label>
          Offer type
          <select disabled value="discount_code">
            <option value="discount_code">Discount code</option>
            {DISABLED_TYPES.map((type) => (
              <option disabled key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
        <label>
          Start
          <input onChange={(event) => setField('startsAt', event.target.value)} type="datetime-local" value={form.startsAt} />
        </label>
        <label>
          End
          <input onChange={(event) => setField('expiresAt', event.target.value)} type="datetime-local" value={form.expiresAt} />
        </label>
        <label>
          Full price (euro)
          <input onChange={(event) => setField('listPrice', event.target.value)} value={form.listPrice} />
        </label>
        <label>
          Discount (%)
          <input onChange={(event) => setField('discountPercent', event.target.value)} value={form.discountPercent} />
        </label>
        {pricing ? (
          <div className="preview">
            <p>{pricing.valueLabel}</p>
            <dl className="split">
              <div><dt>Member pays</dt><dd>€{(pricing.payCents / 100).toFixed(2)}</dd></div>
              <div><dt>Brew Points</dt><dd>{pricing.pointsCost}</dd></div>
            </dl>
          </div>
        ) : (
          <p className="muted">Enter a full price and discount to preview Brew Points.</p>
        )}
        <label>
          Code quantity guide
          <input onChange={(event) => setField('quantity', event.target.value)} value={form.quantity} />
        </label>
        <p className="muted">
          Guidance only — upload unique codes below.
          {guideOk ? ` Uploaded ${editing ? codesTotal : parsedCodes.length} of ${quantity}.` : null}
        </p>
        <fieldset className="stack">
          <legend>Instructions</legend>
          {form.instructions.map((step, index) => (
            <div className="bar" key={`step-${index}`}>
              <label style={{ flex: 1 }}>
                {index + 1}.
                <input onChange={(event) => setInstruction(index, event.target.value)} value={step} />
              </label>
              <div className="actions">
                <button className="secondary" disabled={index === 0} onClick={() => moveInstruction(index, -1)} type="button">Up</button>
                <button className="secondary" disabled={index === form.instructions.length - 1} onClick={() => moveInstruction(index, 1)} type="button">Down</button>
                <button className="secondary" onClick={() => removeInstruction(index)} type="button">Remove</button>
              </div>
            </div>
          ))}
          <button className="secondary" onClick={addInstruction} type="button">Add step</button>
        </fieldset>
        {!editing ? (
          <label>
            Unique codes (paste one per line)
            <textarea
              onChange={(event) => setField('codesText', event.target.value)}
              placeholder={'CODE-001\nCODE-002'}
              value={form.codesText}
            />
          </label>
        ) : (
          <label>
            Add more unique codes
            <textarea
              onChange={(event) => setAppendCodes(event.target.value)}
              placeholder={'CODE-011\nCODE-012'}
              value={appendCodes}
            />
          </label>
        )}
        <div className="actions">
          {offer?.status === 'removed' ? (
            <p className="muted">Removed offers are terminal and cannot be edited or republished.</p>
          ) : (
            <>
              <button disabled={busy || !pricing || !guideOk || !form.title.trim()} type="submit">
                {editing ? (offer?.status === 'draft' ? 'Save draft' : 'Save') : 'Save draft'}
              </button>
              {offer?.status === 'active' ? (
                <button className="secondary" disabled={busy} onClick={() => void setStatus('paused')} type="button">
                  Pause
                </button>
              ) : (
                <button
                  className="secondary"
                  disabled={busy || !pricing || !guideOk || !canPublish}
                  onClick={(event) => void save(event, 'active')}
                  type="button"
                >
                  Publish
                </button>
              )}
              {editing ? (
                <button className="secondary" disabled={busy} onClick={() => void setStatus('removed')} type="button">
                  Remove
                </button>
              ) : null}
            </>
          )}
        </div>
        {!canPublish && offer?.status !== 'removed' ? (
          <p className="muted">Publish stays disabled until at least one unused code is available.</p>
        ) : null}
      </form>
    </main>
  );
}
