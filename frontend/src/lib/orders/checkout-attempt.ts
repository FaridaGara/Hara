import {
  ApiError,
  ordersApi,
  type Order,
  type OrderConflictPayload,
  type OrderCreateItem,
  type OrderCreateRequest,
} from "@/lib/api";

type CreateOrder = (
  payload: OrderCreateRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) => Promise<Order>;

function createMutationKey() {
  const secureCrypto = globalThis.crypto;
  if (secureCrypto?.randomUUID) {
    return secureCrypto.randomUUID();
  }

  if (!secureCrypto?.getRandomValues) {
    throw new Error("Təhlükəsiz Idempotency-Key yaratmaq mümkün olmadı.");
  }
  const bytes = new Uint8Array(16);
  secureCrypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateQuantity(
  quantity: number,
  maxPerOrder: number,
  availableQuantity?: number,
) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return "Bilet sayı ən azı 1 olmalıdır.";
  }
  if (quantity > maxPerOrder) {
    return `Bir sifarişdə maksimum ${maxPerOrder} bilet seçilə bilər.`;
  }
  if (availableQuantity !== undefined && quantity > availableQuantity) {
    return `Hazırda yalnız ${availableQuantity} bilet mövcuddur.`;
  }

  return null;
}

export function orderCreationError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return {
      message:
        error instanceof ApiError ? error.message : "Sifarişi yaratmaq mümkün olmadı.",
    };
  }

  const payload = error.payload as OrderConflictPayload | null;
  if (payload?.code === "INSUFFICIENT_CAPACITY") {
    return {
      message:
        payload.available_quantity !== undefined
          ? `Seçilən bilet sayı artıq mövcud deyil. Qalan say: ${payload.available_quantity}.`
          : payload.detail,
      ticketTypeId: payload.ticket_type_id,
      availableQuantity: payload.available_quantity,
    };
  }
  if (payload?.code === "IDEMPOTENCY_KEY_REUSED") {
    return {
      message:
        "Bu checkout cəhdi fərqli seçim üçün istifadə olunub. Yeni checkout başladın.",
    };
  }

  return { message: error.message };
}

export class OrderCheckoutAttempt {
  readonly idempotencyKey: string;
  private inFlight: Promise<Order> | null = null;

  constructor(
    private readonly createOrder: CreateOrder = ordersApi.create,
    idempotencyKey = createMutationKey(),
  ) {
    this.idempotencyKey = idempotencyKey;
  }

  submit(items: OrderCreateItem[], signal?: AbortSignal) {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.createOrder(
      { items },
      this.idempotencyKey,
      signal,
    ).finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }
}
