# Database model

Target production-minded schema for Brew & Move core entities. Use this when adding tables or columns so we avoid repeated production migrations.

Some entities and columns below are **not on `main` yet**. Treat this document as the intended shape; migrations implement it slice by slice. Product rules in [`AGENTS.md`](../AGENTS.md) still govern what we collect and what we defer.

## Entity relationship diagram

```mermaid
erDiagram
  partners ||--o{ locations : has
  partners ||--o{ offers : owns
  partners ||--o{ community_partners : listed_in
  locations ||--o{ offers : venue_for
  offers ||--o{ offer_discount_codes : pool
  offers ||--o{ redemptions : redeemed_as
  members ||--o{ redemptions : makes
  members ||--o{ community_memberships : joins
  members ||--|| member_balances : has
  communities ||--o{ community_partners : features
  communities ||--o{ community_memberships : has
  partners ||--o{ redemptions : at_partner
  locations ||--o{ redemptions : at_location
  redemptions ||--o| offer_discount_codes : assigns
  redemptions ||--|| point_redemptions : ledger
  auth_users ||--|| members : onboarded_as

  partners {
    uuid id PK
    text name
    text slug UK
    text short_description
    text description
    text logo_url
    text store_url
    text website_url
    text support_email
    text status
    text internal_notes
    timestamptz created_at
    timestamptz updated_at
  }

  locations {
    uuid id PK
    uuid partner_id FK
    text name
    text address
    text locality
    text region
    text country_code
    text timezone
    float latitude
    float longitude
    text status
    timestamptz created_at
    timestamptz updated_at
  }

  members {
    uuid id PK
    text first_name
    text display_name
    text terms_version
    text privacy_version
    timestamptz terms_accepted_at
    timestamptz privacy_acknowledged_at
    text timezone
    text region
    text health_platform
    timestamptz email_verified_at
    timestamptz deletion_requested_at
    timestamptz deleted_at
    timestamptz created_at
    timestamptz updated_at
  }

  offers {
    uuid id PK
    uuid partner_id FK
    uuid location_id FK
    text offer_type
    text status
    text slug
    text title
    text description
    text value_label
    int points_cost
    int quantity
    timestamptz starts_at
    timestamptz expires_at
    jsonb instructions
    text image_url
  }

  offer_discount_codes {
    uuid id PK
    uuid offer_id FK
    text code UK
    uuid redemption_id FK
    timestamptz assigned_at
  }

  redemptions {
    uuid id PK
    uuid member_id FK
    uuid partner_id FK
    uuid location_id FK
    uuid offer_id FK
    text fulfillment_code
    jsonb instructions
    text store_url
  }

  communities {
    uuid id PK
    text name
    text slug
    text short_description
    text description
    text status
  }

  community_memberships {
    uuid member_id FK
    uuid community_id FK
    timestamptz joined_at
  }

  community_partners {
    uuid community_id FK
    uuid partner_id FK
  }

  member_balances {
    uuid member_id PK
    int balance
  }

  point_redemptions {
    uuid id PK
    uuid redemption_id FK
    int points
    text solana_status
  }

  auth_users {
    uuid id PK
    text email
  }
```

## Offer status

Discount-code offers use `draft | active | paused | removed`. This is a CHECK plus a single private transition RPC — not a formal state machine.

Locked rules:

1. `removed` is terminal.
2. `draft` only when staff saves a draft instead of publishing directly. Venue offers do not use a draft lifecycle.
3. Moving to `active` requires at least one unused discount code.

```mermaid
stateDiagram-v2
  [*] --> draft: create save draft
  [*] --> active: create publish with unused codes
  draft --> active: publish with unused codes
  draft --> removed: remove
  active --> paused: pause
  active --> removed: remove
  paused --> active: activate with unused codes
  paused --> removed: remove
  removed -->[*]: terminal
```

| from \ to | draft | active | paused | removed |
|-----------|:-----:|:------:|:------:|:-------:|
| **create (save draft)** | yes | — | — | — |
| **create (publish)** | — | yes\* | — | — |
| **draft** | noop | yes\* | — | yes |
| **active** | no | noop | yes | yes |
| **paused** | no | yes\* | noop | yes |
| **removed** | no | no | no | noop |

\* Guard: unused code pool count ≥ 1.

## Partners

| Field | Purpose |
|-------|---------|
| `name` | Display name |
| `slug` | Stable public / admin id |
| `short_description` | Card blurb |
| `description` | Long member-facing about copy |
| `logo_url` | Card / header identity |
| `store_url` | Post-redeem open-store CTA |
| `website_url` | Optional brand site, distinct from checkout |
| `support_email` | Staff ops contact — not a partner login |
| `status` | `active` / `paused` / `removed` |
| `internal_notes` | Staff-only; never expose on member catalog |
| `created_at` / `updated_at` | Audit |

Do not add yet: settlement bank details, tax IDs, partner balances, invoices, partner login, or scanner device ids. Those stay outside the MVP.

## Members

Email lives on `auth.users`. The member row is the onboarding profile.

| Field | Notes |
|-------|--------|
| `first_name` | Immutable after insert |
| `display_name` | Member-editable |
| Legal version + acceptance timestamps | Required at onboarding |
| `timezone` / `region` | Detected from device; should stay refreshable |
| `health_platform` | `apple_health` / `health_connect` / null |
| `email_verified_at` | Non-blocking for earn / redeem |
| `deletion_requested_at` / `deleted_at` | Production deletion scaffolding |
| `created_at` / `updated_at` | Audit |

Do not collect: surname, username, phone, gender, full date of birth, home address, profile photo, or a Solana wallet address.

## Related read paths

- Member Rewards catalog should read through a view such as `catalog_offers`, not the private code pool.
- Discount codes live in `private` and stay off the Data API; members see an assigned code only via a redemption snapshot (`fulfillment_code`, `instructions`, `store_url`).
- Café settlement tables and RPCs remain separate from the discount-code redeem path.
