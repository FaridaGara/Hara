export type EventCategory = {
  id: number;
  name: string;
  slug: string;
};

export type EventVenue = {
  id: string;
  name: string;
  city?: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

export type HaraEvent = {
  id: string;
  title: string;
  slug: string;
  description: string;
  cover_image_url: string;
  category: EventCategory;
  venue: EventVenue;
  start_at: string;
  end_at: string;
  status: "draft" | "published" | "cancelled" | "completed";
  is_featured: boolean;
};

export type TicketSalesStatus =
  | "UPCOMING"
  | "AVAILABLE"
  | "SOLD_OUT"
  | "ENDED";

export type PublicTicketType = {
  id: number;
  name: string;
  price: string;
  currency: "AZN";
  available_quantity: number;
  sales_start_at: string | null;
  sales_end_at: string | null;
  min_quantity: number;
  max_quantity: number;
  sales_status: TicketSalesStatus;
  is_available: boolean;
};

export type HaraEventDetail = HaraEvent & {
  ticket_types: PublicTicketType[];
};

export type AuthTokenPair = {
  access: string;
  refresh: string;
};

export type SocialProvider = "google" | "apple";

export type UserRole = "user" | "organizer" | "admin" | "superadmin";

export type UserProfile = {
  id: number;
  email: string;
  display_name: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  avatar_url: string;
  birth_date: string | null;
  interests: string[];
  account_type: "user" | "organizer" | "admin";
  role: UserRole;
  providers: SocialProvider[];
  is_email_verified: boolean;
};

export type AuthSessionResponse = AuthTokenPair & {
  user: UserProfile;
};

export type RegistrationRequest = {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  password: string;
  password_confirm: string;
  accept_terms: boolean;
};

export type VerificationPurpose = "registration" | "password_reset";

export type AuthDeliveryResponse = {
  detail: string;
  email?: string;
  expires_at?: string;
  retry_after?: number;
};

export type PasswordResetTokenResponse = {
  reset_token: string;
};

export type UserProfileUpdate = Pick<
  UserProfile,
  | "display_name"
  | "first_name"
  | "last_name"
  | "phone_number"
  | "avatar_url"
  | "birth_date"
  | "interests"
>;

export type AuthRefreshResponse = {
  access: string;
  refresh?: string;
};

export type OrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "refunded"
  | "cancelled";

export type OrderCreateItem = {
  ticket_type_id: number;
  quantity: number;
};

export type OrderCreateRequest = {
  items: OrderCreateItem[];
};

export type OrderItem = {
  id: number;
  ticket_type_id: number;
  ticket_type_name: string;
  event_slug: string;
  event_title: string;
  quantity: number;
  unit_price: string;
};

export type Order = {
  id: string;
  status: OrderStatus;
  total_amount: string;
  currency: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
};

export type OrderConflictCode =
  | "INSUFFICIENT_CAPACITY"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDEMPOTENCY_REQUEST_IN_PROGRESS";

export type OrderConflictPayload = {
  detail: string;
  code?: OrderConflictCode;
  ticket_type_id?: number;
  requested_quantity?: number;
  available_quantity?: number;
};

export type PaymentStatus = "initiated" | "succeeded" | "failed" | "refunded";

export type Payment = {
  id: string;
  order_id: string;
  status: PaymentStatus;
  amount: string;
  currency: string;
  provider: string;
  provider_reference: string | null;
  checkout_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Ticket = {
  id: string;
  qr_code: string;
  event_slug: string;
  event_title: string;
  event_start_at: string;
  event_end_at: string;
  event_location_name: string;
  event_cover_image_url?: string;
  ticket_type_name: string;
  unit_price: string;
  currency: string;
  status: "valid" | "used" | "cancelled" | "refunded";
  owner_display_name: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
  created_at: string;
};

export type EventListFilters = {
  category?: string;
  city?: string;
  featured?: boolean;
  search?: string;
  ordering?: "start_at" | "created_at";
};

export type TicketListFilters = {
  event_status?: "upcoming" | "past";
  is_checked_in?: boolean;
};
