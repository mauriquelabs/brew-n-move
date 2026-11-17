# Discount-code offers — Edge / DB contract

Admin Edge Functions (`admin-partners`, `admin-offers`) and member redeem depend on the discount-code schema migration. Mutations go through Postgres RPCs — not direct writes to the private code pool.

## Tables / columns

### `public.partners`
- `id`, `name`, `created_at`
- `logo_url text null`, `store_url text null`

### `public.offers`
- `location_id` nullable
- `partner_id uuid` (required for `discount_code`)
- `offer_type text` (`discount_code` | reserved others)
- `starts_at timestamptz null`
- `instructions jsonb` (ordered string array)
- `status`: **`draft` | `paused` | `active` | `removed`**
  - `removed` is terminal
  - `draft` only when staff saves a draft (or create defaults to draft)
  - create may publish directly as `active` when codes are supplied
  - activate requires ≥1 unused code

### `private.offer_discount_codes`
- Not exposed on the Data API
- `offer_id`, globally unique `code`, `redemption_id` / `assigned_at`
- Assigned rows cascade-delete with their redemption (no re-pool)

### `public.redemptions`
- `location_id` nullable for online
- Snapshot fields: `fulfillment_code`, `instructions`, `store_url`

## Admin RPCs (service_role execute)

- `admin_upsert_partner(p_id, p_name, p_store_url, p_logo_url)`
- `admin_upsert_discount_offer(..., p_status default draft, p_codes default null)`
- `admin_set_discount_offer_status(p_offer_id, p_status)`
- `admin_upload_discount_codes(p_offer_id, p_codes)`
- `admin_discount_offer_inventory(p_offer_id)`
- `admin_list_partner_discount_offers(p_partner_id)`

## Admin Edge

- `admin-partners` GET list / GET `?id=` / POST create|update via `admin_upsert_partner`
- Partner detail offers come from `admin_list_partner_discount_offers` (removed hidden)
- `admin-offers` GET `?partnerId=` / GET `?id=` / POST create|update|set-status|add-codes via the RPCs above
- Edge maps `needs_codes` → `codes_required` for the admin UI

## Member redeem

`public.redeem_discount_code_offer(p_member_id, p_offer_id, p_request_id, p_commit boolean)`

- Idempotent on `(member_id, client_request_id)`
- On commit: deduct points, insert redemption, assign one unused code (`FOR UPDATE SKIP LOCKED`)
- No vault / till / geofence
