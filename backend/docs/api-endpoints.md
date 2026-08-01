# HARA API Endpoint Inventory

This inventory reflects the URL patterns connected to `config.urls` on
2026-07-27. There are 20 routes and 30 HTTP operations. Responses are JSON
unless noted otherwise. Datetimes use ISO 8601 and money values are serialized
as decimal strings. No DRF pagination is configured.

Access notation:

- Public: no Bearer token is required.
- JWT: `Authorization: Bearer <access-token>` is required.
- Organizer: JWT plus organizer account type; staff is accepted by the current
  permission class.
- Owned: database queries are scoped to the authenticated user. Cross-owner
  object access returns 404.

## Documentation and health

| Method | Path | URL name | Access | Request / query | Success | Main errors | Purpose |
|---|---|---|---|---|---|---|---|
| GET | `/api/schema/` | `api-schema` | Public | None | 200 OpenAPI 3 document | 500 generation failure | Machine-readable API schema |
| GET | `/api/docs/` | `api-docs` | Public | None | 200 HTML | 500 rendering failure | Interactive Swagger UI |
| GET | `/api/health/` | `health` | Public | None | 200 `{status, service}` | — | Service liveness |

## Authentication

| Method | Path | URL name | Access | Request / query | Success | Main errors | Purpose |
|---|---|---|---|---|---|---|---|
| POST | `/api/auth/login/` | `auth-login` | Public | Body: `email`, `password` | 200 `{access, refresh}` | 400 invalid input; 401 invalid credentials | Obtain JWT pair |
| POST | `/api/auth/refresh/` | `auth-refresh` | Public | Body: `refresh` | 200 `{access}` and optional rotated refresh according to JWT settings | 400 malformed input; 401 invalid/expired refresh token | Refresh access token |

## Public events

Public event detail includes active ticket types in `ticket_types`. Each entry
contains `id`, `name`, decimal-string `price`, `currency` (`AZN`),
`available_quantity`, the nullable sales window, `min_quantity`,
`max_quantity`, `sales_status`, and `is_available`. `sales_status` is one of
`UPCOMING`, `AVAILABLE`, `SOLD_OUT`, or `ENDED`; availability uses the same
paid-sale and unexpired-reservation inventory calculation as checkout.

| Method | Path | URL name | Access | Request / query | Success | Main errors | Purpose |
|---|---|---|---|---|---|---|---|
| GET | `/api/events/` | `events:event-list` | Public | Query: `category` slug, `city`, `featured=true\|false`, `search`, `ordering=start_at\|created_at` | 200 event array | Invalid `featured` is currently ignored | Published event discovery |
| GET | `/api/events/<slug>/` | `events:event-detail` | Public | Slug path parameter | 200 event with attendee `ticket_types` | 404 missing, draft, inactive category or inactive venue | Published event and purchasable inventory detail |

## Organizer events

| Method | Path | URL name | Access | Request / query | Success | Main errors | Purpose |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/events/` | `organizer-event-list` | Organizer; own events, staff sees all | None | 200 event array | 401 unauthenticated; 403 non-organizer | Organizer event list |
| POST | `/api/organizer/events/` | `organizer-event-list` | Organizer | Body: `title`, `description`, `category_id`, `venue_id`, `start_at`, `end_at`, `status`; optional `cover_image_url` | 201 event | 400 validation; 401; 403 | Create organizer-owned event |
| GET | `/api/organizer/events/<slug>/` | `organizer-event-detail` | Organizer; Owned, staff bypass | Slug path parameter | 200 event | 401; 403; 404 ownership/not found | Organizer event detail |
| PUT | `/api/organizer/events/<slug>/` | `organizer-event-detail` | Organizer; Owned, staff bypass | Full organizer event body | 200 event | 400 validation; 401; 403; 404; 409 ticketed event lock | Replace event |
| PATCH | `/api/organizer/events/<slug>/` | `organizer-event-detail` | Organizer; Owned, staff bypass | Partial organizer event body | 200 event | 400; 401; 403; 404; 409 ticketed event lock | Update event |
| DELETE | `/api/organizer/events/<slug>/` | `organizer-event-detail` | Organizer; Owned, staff bypass | None | 204 | 401; 403; 404; 409 ticket history exists | Delete unticketed event |

## Organizer ticket types

Ticket type reads include `capacity`, current read-only `available_quantity`,
`sales_start_at`, `sales_end_at`, and read-only `is_available`.

| Method | Path | URL name | Access | Request / query | Success | Main errors | Purpose |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/events/<event_slug>/ticket-types/` | `organizer-ticket-type-list` | Organizer; event owner, staff bypass | Event slug | 200 ticket type array | 401; 403; 404 ownership/not found | Ticket type inventory |
| POST | `/api/organizer/events/<event_slug>/ticket-types/` | `organizer-ticket-type-list` | Organizer; event owner, staff bypass | Body: `name`, `price`, `capacity`, `max_per_order`; optional sales window and `is_active` | 201 ticket type | 400 validation; 401; 403; 404 | Create ticket type |
| GET | `/api/organizer/events/<event_slug>/ticket-types/<id>/` | `organizer-ticket-type-detail` | Organizer; Owned, staff bypass | Slug and integer ID | 200 ticket type | 401; 403; 404 | Ticket type detail |
| PUT | `/api/organizer/events/<event_slug>/ticket-types/<id>/` | `organizer-ticket-type-detail` | Organizer; Owned, staff bypass | Full ticket type body | 200 ticket type | 400; 401; 403; 404; 409 lifecycle/capacity floor | Replace ticket type |
| PATCH | `/api/organizer/events/<event_slug>/ticket-types/<id>/` | `organizer-ticket-type-detail` | Organizer; Owned, staff bypass | Partial ticket type body | 200 ticket type | 400; 401; 403; 404; 409 lifecycle/capacity floor | Update ticket type |
| DELETE | `/api/organizer/events/<event_slug>/ticket-types/<id>/` | `organizer-ticket-type-detail` | Organizer; Owned, staff bypass | None | 204 | 401; 403; 404; 409 sold ticket history | Delete unsold ticket type |

## Orders and checkout

`POST /api/orders/` calculates prices server-side, locks ticket types in stable
ID order, and reserves all items atomically. `expires_at` is server-controlled.
The optional `Idempotency-Key` header is scoped by user.

| Method | Path | URL name | Access | Request / query | Success | Main errors | Purpose |
|---|---|---|---|---|---|---|---|
| GET | `/api/orders/` | `order-create` | JWT; Owned | None | 200 order array | 401 | List owned orders and persist due pending orders as expired |
| POST | `/api/orders/` | `order-create` | JWT | Body: `items[{ticket_type_id, quantity}]`; optional header `Idempotency-Key` | 201 new order; 200 idempotent replay | 400 validation; 401; 409 capacity/idempotency/sales conflict | Atomic checkout reservation |
| GET | `/api/orders/<order_id>/` | `order-detail` | JWT; Owned | UUID order ID | 200 order | 401; 404 ownership/not found | Order detail |
| POST | `/api/orders/<order_id>/cancel/` | `order-cancel` | JWT; Owned | No body | 200 cancelled order | 401; 404; 409 elapsed or terminal order | Cancel active reservation |

Capacity conflict:

```json
{
  "detail": "“Standard” üçün yalnız 1 bilet qalıb.",
  "code": "INSUFFICIENT_CAPACITY",
  "ticket_type_id": 12,
  "requested_quantity": 2,
  "available_quantity": 1
}
```

Reusing one idempotency key with a different canonical payload returns 409
with code `IDEMPOTENCY_KEY_REUSED`.

## Payments

| Method | Path | URL name | Access | Request / query | Success | Main errors | Purpose |
|---|---|---|---|---|---|---|---|
| POST | `/api/orders/<order_id>/payments/` | `payment-initiate` | JWT; Owned | No body; amount/provider fields from clients are ignored | 201 new payment; 200 idempotent replay | 401; 404 ownership/not found; 409 inactive/expired order; 503 provider unavailable | Initiate server-priced payment |
| POST | `/api/payments/sandbox/<payment_id>/complete/` | `sandbox-payment-complete` | JWT; Owned | Body: `result=succeeded\|failed` | 200 payment | 400 validation; 401; 404 disabled/not owned; 409 terminal order conflict | Development-only sandbox completion |
| POST | `/api/payments/webhook/sandbox/` | `sandbox-payment-webhook` | Public Bearer-wise; signed header | Header: `X-HARA-SIGNATURE: sha256=<digest>`; body: `event_id`, `event_type`, `provider_reference`, `amount`, `currency` | 200 `{status: processed\|duplicate\|ignored}` | 400 malformed/mismatch; 401 signature; 404 payment reference; 409 inactive order | Idempotent signed sandbox webhook |

The webhook is not a Chewick endpoint. Duplicate provider event IDs do not
issue a second set of tickets. Signing secrets and example signatures are not
documented.

## User tickets

Ticket responses expose display names but never email or phone. The QR payload
is an unpredictable, stable UUID; no QR image is stored in the database.
Wallet list and detail responses explicitly include the model's lowercase
`status`, `currency`, `is_checked_in`, and nullable `checked_in_at`.

| Method | Path | URL name | Access | Request / query | Success | Main errors | Purpose |
|---|---|---|---|---|---|---|---|
| GET | `/api/tickets/` | `ticket-list` | JWT; Owned | Query: `event_status=upcoming\|past`, `is_checked_in=true\|false` | 200 ticket array | 400 invalid filter; 401 | List owned tickets |
| GET | `/api/tickets/<ticket_id>/` | `ticket-detail` | JWT; Owned | UUID ticket ID | 200 ticket | 401; 404 ownership/not found | Owned ticket detail |

## Organizer check-in

Unlike other organizer CRUD views, this route requires exact event ownership;
the current code has no staff bypass.

| Method | Path | URL name | Access | Request / query | Success | Main errors | Purpose |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/events/<event_slug>/check-ins/` | `organizer-ticket-check-in` | JWT; exact event owner | Event slug | 200 checked-in ticket array | 401; 404 ownership/not found | Event check-in audit list |
| POST | `/api/organizer/events/<event_slug>/check-ins/` | `organizer-ticket-check-in` | JWT; exact event owner | Body: `qr_code` UUID | 200 `{result: checked_in, ...}` | 400 missing/malformed UUID; 401; 404 event/ticket; 409 invalid or already checked in | Atomic ticket check-in |

Duplicate scans return the original timestamp:

```json
{
  "detail": "Bu bilet artıq check-in edilib.",
  "result": "already_checked_in",
  "checked_in_at": "2026-08-10T17:45:00Z"
}
```

## Not exposed by the current URL configuration

There are currently no connected API routes for registration, user profile,
organizer profile/verification, standalone venue CRUD, a dedicated event
publish action, refunds, settlements, or Chewick. They are intentionally not
represented as endpoints in this inventory.
