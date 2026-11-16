# Discount-code offers — Edge / DB contract

Admin Edge Functions (`admin-partners`, `admin-offers`) and redeem `get-code` depend on schema owned by the DB agent. Expected shape:

## Tables / columns

### `public.partners`
- existing: `id`, `name`, `created_at`
- add: `logo_url text null`, `store_url text null`

### `public.offers`
- `location_id` **nullable**
- add: `partner_id uuid null` references partners
- add: `offer_type text` (`discount_code` | reserved others)
- add: `starts_at timestamptz null`
- add: `instructions jsonb` (ordered string array)
- `status` includes **`draft` | `paused` | `active` | `removed`**

### `public.offer_discount_codes`
- `id uuid pk`
- `offer_id uuid not null` → offers
- `code text not null` **unique globally**
- `redemption_id uuid null` → redemptions (set once when assigned)
- `created_at timestamptz`

### `public.redemptions`
- `location_id` nullable for online
- optional denormalized `discount_code text` for My rewards re-show (or join via `offer_discount_codes`)

### Catalog
- expose `offer_type`, `instructions`, `starts_at`, partner `logo_url` / `store_url`
- filter active + start/end; prefer hide when no unused codes (or fail redeem `sold_out`)

## Member RPC (required by `redeem`)

`public.redeem_discount_code(p_member_id, p_offer_id, p_request_id, p_commit boolean) returns jsonb`

- Idempotent on `(member_id, client_request_id)`
- On commit: deduct points, insert redemption, assign one unused code (`FOR UPDATE SKIP LOCKED`), no vault / till
- Reasons: `eligible` | `redeemed` | `not_onboarded` | `offer_unavailable` | `sold_out` | `insufficient_balance` | `wrong_offer_type` | `invalid_payload`
- Success fields include `discount_code`, `store_url`, `instructions`, `partner`, `title`, `value_label`, `points_spent`, `redeemed_at`, `redemption_id`, `balance`

## Admin Edge (implemented; service-role table access)

- `admin-partners` GET list / GET `?id=` / POST create|update
- `admin-offers` GET `?partnerId=` / GET `?id=` / POST create|update|set-status|add-codes
- Publish (`status=active`) rejected with `codes_required` when pool empty
