-- Discount-code offers: partner-scoped online redemption with a one-time code pool.
-- Café till / vault settlement stay in the database but are not used by this flow.

-- ---------------------------------------------------------------------------
-- Partners: storefront link + logo for the member app
-- ---------------------------------------------------------------------------

alter table public.partners
  add column logo_url text,
  add column store_url text;

alter table public.partners
  add constraint partners_logo_url_present check (
    logo_url is null or char_length(pg_catalog.btrim(logo_url)) > 0
  ),
  add constraint partners_store_url_present check (
    store_url is null or char_length(pg_catalog.btrim(store_url)) > 0
  );

comment on column public.partners.logo_url is
  'Optional partner logo URL shown on Rewards cards.';

comment on column public.partners.store_url is
  'Partner online store URL. Shown after a discount-code redeem as Open partner store.';

grant select (logo_url, store_url) on public.partners to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Offers: type, partner scope, draft status, start window, instructions
-- ---------------------------------------------------------------------------

alter table public.offers
  add column partner_id uuid references public.partners (id),
  add column offer_type text,
  add column starts_at timestamptz,
  add column instructions jsonb not null default '[]'::jsonb;

update public.offers
set partner_id = locations.partner_id
from public.locations
where locations.id = offers.location_id
  and offers.partner_id is null;

update public.offers
set offer_type = 'venue'
where offer_type is null;

alter table public.offers
  alter column offer_type set not null,
  alter column offer_type set default 'venue',
  alter column location_id drop not null;
-- status default stays active for legacy venue inserts. Discount-code creates
-- always pass status = draft from admin_upsert_discount_offer.

alter table public.offers
  drop constraint offers_status;

alter table public.offers
  add constraint offers_status check (
    status in ('draft', 'active', 'paused', 'removed')
  ),
  add constraint offers_type check (
    offer_type in (
      'discount_code',
      'venue',
      'exclusive',
      'gift_card',
      'experience'
    )
  ),
  add constraint offers_discount_code_requires_partner check (
    offer_type <> 'discount_code' or partner_id is not null
  ),
  add constraint offers_window_order check (
    starts_at is null
    or expires_at is null
    or starts_at < expires_at
  ),
  add constraint offers_instructions_array check (
    pg_catalog.jsonb_typeof(instructions) = 'array'
  );

comment on column public.offers.partner_id is
  'Partner that owns the offer. Required for discount_code. Nullable for legacy venue rows that only had location_id.';

comment on column public.offers.location_id is
  'Venue location when the offer is place-bound. Null for partner/online discount_code offers.';

comment on column public.offers.offer_type is
  'Offer fulfilment kind. Only discount_code is live in Rewards for this slice.';

comment on column public.offers.starts_at is
  'When the offer becomes redeemable. Null means no start gate beyond status.';

comment on column public.offers.instructions is
  'Ordered JSON string list shown after a successful discount-code redeem.';

comment on column public.offers.status is
  'draft never published; active live; paused was published then paused; removed hidden.';

create index offers_partner on public.offers (partner_id)
  where partner_id is not null;

drop policy offers_select_available on public.offers;

create policy offers_select_available on public.offers
  for select to anon, authenticated
  using (
    offer_type = 'discount_code'
    and status = 'active'
    and (starts_at is null or starts_at <= pg_catalog.now())
    and (expires_at is null or expires_at > pg_catalog.now())
  );

-- ---------------------------------------------------------------------------
-- Redemptions: nullable location + member-readable fulfilment snapshot
-- ---------------------------------------------------------------------------

alter table public.redemptions
  alter column location_id drop not null,
  add column fulfillment_code text,
  add column instructions jsonb,
  add column store_url text;

alter table public.redemptions
  add constraint redemptions_fulfillment_code_present check (
    fulfillment_code is null
    or char_length(pg_catalog.btrim(fulfillment_code)) > 0
  ),
  add constraint redemptions_instructions_array check (
    instructions is null
    or pg_catalog.jsonb_typeof(instructions) = 'array'
  ),
  add constraint redemptions_store_url_present check (
    store_url is null or char_length(pg_catalog.btrim(store_url)) > 0
  );

comment on column public.redemptions.fulfillment_code is
  'One-time discount code assigned at redeem. Readable by the member via redemptions RLS.';

comment on column public.redemptions.instructions is
  'Snapshot of offer instructions at redeem time for My rewards.';

comment on column public.redemptions.store_url is
  'Snapshot of partner store_url at redeem time for My rewards.';

-- ---------------------------------------------------------------------------
-- Code pool (private). Codes are unique globally. Unassigned codes stay off Data API.
-- ---------------------------------------------------------------------------

create table private.offer_discount_codes (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  code text not null,
  redemption_id uuid unique references public.redemptions (id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint offer_discount_codes_code_present check (
    char_length(pg_catalog.btrim(code)) > 0
  ),
  constraint offer_discount_codes_code_trimmed check (code = pg_catalog.btrim(code)),
  constraint offer_discount_codes_assignment check (
    (redemption_id is null and assigned_at is null)
    or (redemption_id is not null and assigned_at is not null)
  ),
  unique (code)
);

comment on table private.offer_discount_codes is
  'Admin-uploaded one-time discount codes. Unique across all offers. Assigned at redeem.';

create index offer_discount_codes_available
  on private.offer_discount_codes (offer_id)
  where redemption_id is null;

alter table private.offer_discount_codes enable row level security;

revoke all on private.offer_discount_codes from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- catalog_offers: only live discount_code offers in window
-- ---------------------------------------------------------------------------

drop view public.catalog_offers;

create view public.catalog_offers
with (security_invoker = true) as
select
  offers.id,
  offers.slug,
  offers.partner_id,
  partners.name as partner_name,
  partners.logo_url as partner_logo_url,
  partners.store_url as partner_store_url,
  locations.name as location_name,
  locations.address as location_address,
  offers.title,
  offers.value_label,
  offers.points_cost,
  offers.description,
  offers.list_price_cents,
  offers.pay_price_cents,
  offers.image_url,
  offers.offer_type,
  offers.instructions,
  offers.starts_at,
  offers.expires_at,
  offers.quantity
from public.offers
join public.partners on partners.id = offers.partner_id
left join public.locations on locations.id = offers.location_id
where offers.offer_type = 'discount_code'
  and offers.status = 'active'
  and (offers.starts_at is null or offers.starts_at <= pg_catalog.now())
  and (offers.expires_at is null or offers.expires_at > pg_catalog.now());

revoke all on public.catalog_offers from anon, authenticated;
grant select on public.catalog_offers to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.instructions_are_strings(p_instructions jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_instructions is not null
    and pg_catalog.jsonb_typeof(p_instructions) = 'array'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_instructions) as element(value)
      where pg_catalog.jsonb_typeof(element.value) <> 'string'
        or char_length(pg_catalog.btrim(element.value #>> '{}')) = 0
    );
$$;

create or replace function private.discount_code_available_count(p_offer_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from private.offer_discount_codes
  where offer_id = p_offer_id
    and redemption_id is null;
$$;

create or replace function private.discount_code_redemption_result(
  p_row public.redemptions
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'ok', true,
    'reason', 'redeemed',
    'redemption_id', p_row.id,
    'offer_id', p_row.offer_id,
    'partner', p_row.partner_name,
    'title', p_row.offer_title,
    'value_label', p_row.value_label,
    'points_spent', p_row.points_spent,
    'redeemed_at', p_row.redeemed_at,
    'code', p_row.fulfillment_code,
    'instructions', coalesce(p_row.instructions, '[]'::jsonb),
    'store_url', p_row.store_url,
    'balance', coalesce((
      select balance
      from public.member_balances
      where member_id = p_row.member_id
    ), 0)
  );
$$;

-- ---------------------------------------------------------------------------
-- Member redeem: single-step spend + assign code (no geofence, no vault)
-- ---------------------------------------------------------------------------

create or replace function private.redeem_discount_code_offer(
  p_member_id uuid,
  p_offer_id uuid,
  p_request_id uuid,
  p_commit boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.redemptions%rowtype;
  v_member uuid;
  v_offer public.offers%rowtype;
  v_partner public.partners%rowtype;
  v_balance integer;
  v_available integer;
  v_code private.offer_discount_codes%rowtype;
  v_new public.redemptions%rowtype;
begin
  if p_commit is not true and p_commit is not false then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if p_member_id is null or p_offer_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if p_commit then
    if p_request_id is null then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    select * into v_existing
    from public.redemptions
    where member_id = p_member_id
      and client_request_id = p_request_id;

    if v_existing.id is not null then
      return private.discount_code_redemption_result(v_existing);
    end if;
  end if;

  select id into v_member
  from public.members
  where id = p_member_id
  for update;

  if v_member is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_onboarded');
  end if;

  select * into v_offer
  from public.offers
  where id = p_offer_id
  for update;

  if v_offer.id is null
    or v_offer.offer_type is distinct from 'discount_code'
    or v_offer.status is distinct from 'active'
    or (v_offer.starts_at is not null and v_offer.starts_at > pg_catalog.now())
    or (v_offer.expires_at is not null and v_offer.expires_at <= pg_catalog.now())
    or v_offer.partner_id is null
  then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'offer_unavailable');
  end if;

  select * into v_partner
  from public.partners
  where id = v_offer.partner_id;

  if v_partner.id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'offer_unavailable');
  end if;

  v_available := private.discount_code_available_count(v_offer.id);
  if v_available < 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'sold_out');
  end if;

  insert into public.member_balances (member_id, balance)
  values (p_member_id, 0)
  on conflict (member_id) do nothing;

  select balance into v_balance
  from public.member_balances
  where member_id = p_member_id
  for update;

  if v_balance < v_offer.points_cost then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_balance',
      'balance', v_balance
    );
  end if;

  if p_commit is not true then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'reason', 'eligible',
      'offer_id', v_offer.id,
      'partner', v_partner.name,
      'title', v_offer.title,
      'value_label', v_offer.value_label,
      'points_cost', v_offer.points_cost,
      'instructions', v_offer.instructions,
      'store_url', v_partner.store_url,
      'balance', v_balance
    );
  end if;

  begin
    select * into v_code
    from private.offer_discount_codes
    where offer_id = v_offer.id
      and redemption_id is null
    order by created_at, id
    for update skip locked
    limit 1;

    if v_code.id is null then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'sold_out');
    end if;

    update public.member_balances
    set
      balance = balance - v_offer.points_cost,
      updated_at = pg_catalog.now()
    where member_id = p_member_id
      and balance >= v_offer.points_cost
    returning balance into v_balance;

    if v_balance is null then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'insufficient_balance',
        'balance', (
          select balance from public.member_balances where member_id = p_member_id
        )
      );
    end if;

    insert into public.redemptions (
      member_id,
      partner_id,
      location_id,
      offer_id,
      partner_name,
      location_name,
      offer_title,
      points_spent,
      value_label,
      client_request_id,
      fulfillment_code,
      instructions,
      store_url
    )
    values (
      p_member_id,
      v_partner.id,
      null,
      v_offer.id,
      v_partner.name,
      'Online',
      v_offer.title,
      v_offer.points_cost,
      v_offer.value_label,
      p_request_id,
      v_code.code,
      v_offer.instructions,
      v_partner.store_url
    )
    returning * into v_new;

    update private.offer_discount_codes
    set
      redemption_id = v_new.id,
      assigned_at = pg_catalog.now()
    where id = v_code.id
      and redemption_id is null;

    if not found then
      -- Abort the whole redeem rather than leaving a points spend without a code.
      raise exception 'code_assign_failed';
    end if;

    insert into private.point_redemptions (
      redemption_id,
      member_id,
      offer_id,
      points,
      solana_status
    )
    values (
      v_new.id,
      p_member_id,
      v_offer.id,
      v_offer.points_cost,
      'blocked'
    );
  exception
    when unique_violation then
      select * into v_existing
      from public.redemptions
      where member_id = p_member_id
        and client_request_id = p_request_id;

      if v_existing.id is null then
        return pg_catalog.jsonb_build_object('ok', false, 'reason', 'unavailable');
      end if;

      return private.discount_code_redemption_result(v_existing);
  end;

  return private.discount_code_redemption_result(v_new);
end;
$$;

create or replace function public.redeem_discount_code_offer(
  p_member_id uuid,
  p_offer_id uuid,
  p_request_id uuid,
  p_commit boolean
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.redeem_discount_code_offer(
    p_member_id,
    p_offer_id,
    p_request_id,
    p_commit
  );
$$;

-- ---------------------------------------------------------------------------
-- Admin: partners
-- ---------------------------------------------------------------------------

create or replace function private.admin_upsert_partner(
  p_id uuid,
  p_name text,
  p_store_url text,
  p_logo_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_store text := nullif(pg_catalog.btrim(coalesce(p_store_url, '')), '');
  v_logo text := nullif(pg_catalog.btrim(coalesce(p_logo_url, '')), '');
begin
  if char_length(v_name) = 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if p_id is null then
    insert into public.partners (name, store_url, logo_url)
    values (v_name, v_store, v_logo)
    returning id into v_id;
  else
    update public.partners
    set
      name = v_name,
      store_url = v_store,
      logo_url = v_logo
    where id = p_id
    returning id into v_id;

    if v_id is null then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
  end if;

  return pg_catalog.jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.admin_upsert_partner(
  p_id uuid,
  p_name text,
  p_store_url text,
  p_logo_url text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_upsert_partner(p_id, p_name, p_store_url, p_logo_url);
$$;

-- ---------------------------------------------------------------------------
-- Admin: discount offers
-- ---------------------------------------------------------------------------

create or replace function private.admin_upsert_discount_offer(
  p_offer_id uuid,
  p_partner_id uuid,
  p_slug text,
  p_title text,
  p_description text,
  p_value_label text,
  p_list_price_cents integer,
  p_pay_price_cents integer,
  p_points_cost integer,
  p_quantity integer,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_instructions jsonb,
  p_image_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_partner uuid;
  v_slug text := pg_catalog.btrim(coalesce(p_slug, ''));
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_value_label text := pg_catalog.btrim(coalesce(p_value_label, ''));
  v_image text := nullif(pg_catalog.btrim(coalesce(p_image_url, '')), '');
  v_instructions jsonb := coalesce(p_instructions, '[]'::jsonb);
  v_existing public.offers%rowtype;
begin
  if p_partner_id is null
    or char_length(v_slug) = 0
    or char_length(v_title) = 0
    or char_length(v_description) = 0
    or char_length(v_value_label) = 0
    or p_list_price_cents is null or p_list_price_cents <= 0
    or p_pay_price_cents is null or p_pay_price_cents < 0
    or p_pay_price_cents > p_list_price_cents
    or p_points_cost is null or p_points_cost <= 0
    or (p_quantity is not null and p_quantity < 1)
    or (
      p_starts_at is not null
      and p_expires_at is not null
      and p_starts_at >= p_expires_at
    )
    or not private.instructions_are_strings(v_instructions)
  then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select id into v_partner
  from public.partners
  where id = p_partner_id;

  if v_partner is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'partner_not_found');
  end if;

  if p_offer_id is null then
    insert into public.offers (
      partner_id,
      location_id,
      slug,
      title,
      description,
      value_label,
      points_cost,
      list_price_cents,
      pay_price_cents,
      quantity,
      starts_at,
      expires_at,
      instructions,
      image_url,
      offer_type,
      status
    )
    values (
      p_partner_id,
      null,
      v_slug,
      v_title,
      v_description,
      v_value_label,
      p_points_cost,
      p_list_price_cents,
      p_pay_price_cents,
      p_quantity,
      p_starts_at,
      p_expires_at,
      v_instructions,
      v_image,
      'discount_code',
      'draft'
    )
    returning id into v_id;

    return pg_catalog.jsonb_build_object('ok', true, 'id', v_id, 'status', 'draft');
  end if;

  select * into v_existing
  from public.offers
  where id = p_offer_id
  for update;

  if v_existing.id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_existing.offer_type is distinct from 'discount_code' then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'wrong_offer_type');
  end if;

  update public.offers
  set
    partner_id = p_partner_id,
    location_id = null,
    slug = v_slug,
    title = v_title,
    description = v_description,
    value_label = v_value_label,
    points_cost = p_points_cost,
    list_price_cents = p_list_price_cents,
    pay_price_cents = p_pay_price_cents,
    quantity = p_quantity,
    starts_at = p_starts_at,
    expires_at = p_expires_at,
    instructions = v_instructions,
    image_url = v_image
  where id = p_offer_id
  returning id into v_id;

  return pg_catalog.jsonb_build_object('ok', true, 'id', v_id, 'status', v_existing.status);
exception
  when unique_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'slug_taken');
end;
$$;

create or replace function public.admin_upsert_discount_offer(
  p_offer_id uuid,
  p_partner_id uuid,
  p_slug text,
  p_title text,
  p_description text,
  p_value_label text,
  p_list_price_cents integer,
  p_pay_price_cents integer,
  p_points_cost integer,
  p_quantity integer,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_instructions jsonb,
  p_image_url text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_upsert_discount_offer(
    p_offer_id,
    p_partner_id,
    p_slug,
    p_title,
    p_description,
    p_value_label,
    p_list_price_cents,
    p_pay_price_cents,
    p_points_cost,
    p_quantity,
    p_starts_at,
    p_expires_at,
    p_instructions,
    p_image_url
  );
$$;

create or replace function private.admin_set_discount_offer_status(
  p_offer_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.offers%rowtype;
  v_available integer;
begin
  if p_status is null or p_status not in ('draft', 'active', 'paused', 'removed') then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select * into v_offer
  from public.offers
  where id = p_offer_id
  for update;

  if v_offer.id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_offer.offer_type is distinct from 'discount_code' then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'wrong_offer_type');
  end if;

  -- draft means never published; cannot return to draft after leaving it.
  if p_status = 'draft' and v_offer.status is distinct from 'draft' then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'cannot_draft_after_publish');
  end if;

  if p_status = 'active' then
    v_available := private.discount_code_available_count(v_offer.id);
    if v_available < 1 then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'needs_codes');
    end if;
  end if;

  update public.offers
  set status = p_status
  where id = p_offer_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'id', p_offer_id,
    'status', p_status,
    'available_codes', private.discount_code_available_count(p_offer_id)
  );
end;
$$;

create or replace function public.admin_set_discount_offer_status(
  p_offer_id uuid,
  p_status text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_discount_offer_status(p_offer_id, p_status);
$$;

create or replace function private.admin_upload_discount_codes(
  p_offer_id uuid,
  p_codes text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.offers%rowtype;
  v_raw text;
  v_code text;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_seen text[] := array[]::text[];
begin
  if p_offer_id is null or p_codes is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select * into v_offer
  from public.offers
  where id = p_offer_id
  for update;

  if v_offer.id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_offer.offer_type is distinct from 'discount_code' then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'wrong_offer_type');
  end if;

  foreach v_raw in array p_codes
  loop
    v_code := pg_catalog.btrim(coalesce(v_raw, ''));
    if char_length(v_code) = 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_code = any (v_seen) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_seen := pg_catalog.array_append(v_seen, v_code);

    begin
      insert into private.offer_discount_codes (offer_id, code)
      values (p_offer_id, v_code);
      v_inserted := v_inserted + 1;
    exception
      when unique_violation then
        v_skipped := v_skipped + 1;
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'offer_id', p_offer_id,
    'inserted', v_inserted,
    'skipped', v_skipped,
    'available', private.discount_code_available_count(p_offer_id),
    'total', (
      select count(*)::integer
      from private.offer_discount_codes
      where offer_id = p_offer_id
    )
  );
end;
$$;

create or replace function public.admin_upload_discount_codes(
  p_offer_id uuid,
  p_codes text[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_upload_discount_codes(p_offer_id, p_codes);
$$;

create or replace function private.admin_discount_offer_inventory(p_offer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_offer public.offers%rowtype;
  v_total integer;
  v_assigned integer;
  v_available integer;
begin
  select * into v_offer
  from public.offers
  where id = p_offer_id;

  if v_offer.id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_offer.offer_type is distinct from 'discount_code' then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'wrong_offer_type');
  end if;

  select count(*)::integer into v_total
  from private.offer_discount_codes
  where offer_id = p_offer_id;

  select count(*)::integer into v_assigned
  from private.offer_discount_codes
  where offer_id = p_offer_id
    and redemption_id is not null;

  v_available := v_total - v_assigned;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'offer_id', p_offer_id,
    'status', v_offer.status,
    'quantity', v_offer.quantity,
    'total', v_total,
    'assigned', v_assigned,
    'available', v_available
  );
end;
$$;

create or replace function public.admin_discount_offer_inventory(p_offer_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_discount_offer_inventory(p_offer_id);
$$;

create or replace function private.admin_list_partner_discount_offers(p_partner_id uuid)
returns table (
  id uuid,
  slug text,
  title text,
  description text,
  status text,
  quantity integer,
  points_cost integer,
  list_price_cents integer,
  pay_price_cents integer,
  value_label text,
  starts_at timestamptz,
  expires_at timestamptz,
  instructions jsonb,
  image_url text,
  codes_total integer,
  codes_available integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    offers.id,
    offers.slug,
    offers.title,
    offers.description,
    offers.status,
    offers.quantity,
    offers.points_cost,
    offers.list_price_cents,
    offers.pay_price_cents,
    offers.value_label,
    offers.starts_at,
    offers.expires_at,
    offers.instructions,
    offers.image_url,
    (
      select count(*)::integer
      from private.offer_discount_codes
      where offer_discount_codes.offer_id = offers.id
    ) as codes_total,
    private.discount_code_available_count(offers.id) as codes_available,
    offers.created_at
  from public.offers
  where offers.partner_id = p_partner_id
    and offers.offer_type = 'discount_code'
  order by offers.created_at desc;
$$;

create or replace function public.admin_list_partner_discount_offers(p_partner_id uuid)
returns table (
  id uuid,
  slug text,
  title text,
  description text,
  status text,
  quantity integer,
  points_cost integer,
  list_price_cents integer,
  pay_price_cents integer,
  value_label text,
  starts_at timestamptz,
  expires_at timestamptz,
  instructions jsonb,
  image_url text,
  codes_total integer,
  codes_available integer,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_list_partner_discount_offers(p_partner_id);
$$;

-- ---------------------------------------------------------------------------
-- Keep legacy campaign inserts on the paused venue path
-- ---------------------------------------------------------------------------

create or replace function private.admin_insert_campaign_offer(
  p_budget_id uuid,
  p_location_id uuid,
  p_slug text,
  p_title text,
  p_description text,
  p_value_label text,
  p_list_price_cents integer,
  p_pay_price_cents integer,
  p_points_cost integer,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_partner_id uuid;
begin
  if p_quantity is null or p_quantity < 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'quantity_required');
  end if;

  select partner_id into v_partner_id
  from public.locations
  where id = p_location_id;

  if v_partner_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'location_unavailable');
  end if;

  insert into public.offers (
    partner_id,
    location_id,
    slug,
    title,
    description,
    value_label,
    points_cost,
    list_price_cents,
    pay_price_cents,
    quantity,
    offer_type,
    status
  ) values (
    v_partner_id,
    p_location_id,
    p_slug,
    p_title,
    p_description,
    p_value_label,
    p_points_cost,
    p_list_price_cents,
    p_pay_price_cents,
    p_quantity,
    'venue',
    'paused'
  )
  returning id into v_id;
  insert into private.offer_budgets (offer_id, budget_id, active)
  values (v_id, p_budget_id, true);
  return pg_catalog.jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants / revokes
-- ---------------------------------------------------------------------------


revoke all on function private.instructions_are_strings(jsonb) from public, anon, authenticated;
revoke all on function private.discount_code_available_count(uuid) from public, anon, authenticated;
revoke all on function private.discount_code_redemption_result(public.redemptions) from public, anon, authenticated;
revoke all on function private.redeem_discount_code_offer(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.redeem_discount_code_offer(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.admin_upsert_partner(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_upsert_partner(uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.admin_upsert_discount_offer(uuid, uuid, text, text, text, text, integer, integer, integer, integer, timestamptz, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_upsert_discount_offer(uuid, uuid, text, text, text, text, integer, integer, integer, integer, timestamptz, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function private.admin_set_discount_offer_status(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_set_discount_offer_status(uuid, text) from public, anon, authenticated;
revoke all on function private.admin_upload_discount_codes(uuid, text[]) from public, anon, authenticated;
revoke all on function public.admin_upload_discount_codes(uuid, text[]) from public, anon, authenticated;
revoke all on function private.admin_discount_offer_inventory(uuid) from public, anon, authenticated;
revoke all on function public.admin_discount_offer_inventory(uuid) from public, anon, authenticated;
revoke all on function private.admin_list_partner_discount_offers(uuid) from public, anon, authenticated;
revoke all on function public.admin_list_partner_discount_offers(uuid) from public, anon, authenticated;

grant execute on function private.redeem_discount_code_offer(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.redeem_discount_code_offer(uuid, uuid, uuid, boolean) to service_role;
grant execute on function private.admin_upsert_partner(uuid, text, text, text) to service_role;
grant execute on function public.admin_upsert_partner(uuid, text, text, text) to service_role;
grant execute on function private.admin_upsert_discount_offer(uuid, uuid, text, text, text, text, integer, integer, integer, integer, timestamptz, timestamptz, jsonb, text) to service_role;
grant execute on function public.admin_upsert_discount_offer(uuid, uuid, text, text, text, text, integer, integer, integer, integer, timestamptz, timestamptz, jsonb, text) to service_role;
grant execute on function private.admin_set_discount_offer_status(uuid, text) to service_role;
grant execute on function public.admin_set_discount_offer_status(uuid, text) to service_role;
grant execute on function private.admin_upload_discount_codes(uuid, text[]) to service_role;
grant execute on function public.admin_upload_discount_codes(uuid, text[]) to service_role;
grant execute on function private.admin_discount_offer_inventory(uuid) to service_role;
grant execute on function public.admin_discount_offer_inventory(uuid) to service_role;
grant execute on function private.admin_list_partner_discount_offers(uuid) to service_role;
grant execute on function public.admin_list_partner_discount_offers(uuid) to service_role;
