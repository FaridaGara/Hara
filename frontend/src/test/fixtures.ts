import type { HaraEventDetail, Order, Payment, Ticket } from "@/lib/api";

export const eventFixture: HaraEventDetail = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "Bakı Caz Axşamı",
  slug: "baki-caz-axsami",
  description: "Canlı musiqi proqramı",
  cover_image_url: "",
  category: { id: 1, name: "Musiqi", slug: "musiqi" },
  venue: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Rotunda Hall",
    city: "Bakı",
    address: "Neftçilər prospekti",
    latitude: null,
    longitude: null,
  },
  start_at: "2026-08-10T18:00:00Z",
  end_at: "2026-08-10T20:00:00Z",
  status: "published",
  is_featured: true,
  ticket_types: [
    {
      id: 12,
      name: "Standard",
      price: "20.00",
      currency: "AZN",
      available_quantity: 8,
      sales_start_at: null,
      sales_end_at: null,
      min_quantity: 1,
      max_quantity: 8,
      sales_status: "AVAILABLE",
      is_available: true,
    },
  ],
};

export function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    status: "pending",
    total_amount: "40.00",
    currency: "AZN",
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    items: [
      {
        id: 1,
        ticket_type_id: 12,
        ticket_type_name: "Standard",
        event_slug: eventFixture.slug,
        event_title: eventFixture.title,
        quantity: 2,
        unit_price: "20.00",
      },
    ],
    ...overrides,
  };
}

export function paymentFixture(overrides: Partial<Payment> = {}): Payment {
  const id = "30000000-0000-4000-8000-000000000001";
  return {
    id,
    order_id: orderFixture().id,
    status: "initiated",
    amount: "40.00",
    currency: "AZN",
    provider: "sandbox",
    provider_reference: "sandbox_reference",
    checkout_url: `/api/payments/sandbox/${id}/complete/`,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    ...overrides,
  };
}

export const ticketFixture: Ticket = {
  id: "50000000-0000-4000-8000-000000000001",
  qr_code: "60000000-0000-4000-8000-000000000001",
  event_slug: eventFixture.slug,
  event_title: eventFixture.title,
  event_start_at: eventFixture.start_at,
  event_end_at: eventFixture.end_at,
  event_location_name: eventFixture.venue.name,
  event_cover_image_url: eventFixture.cover_image_url,
  ticket_type_name: "Standard",
  unit_price: "20.00",
  currency: "AZN",
  status: "valid",
  owner_display_name: "Aysel",
  is_checked_in: false,
  checked_in_at: null,
  created_at: "2026-08-01T12:00:00Z",
};
