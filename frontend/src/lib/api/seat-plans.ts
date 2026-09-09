import { apiRequest } from './client';
import type { SeatPlanDraft } from '../seat-plan';
export type SavedSeatPlan = { id: string; name: string; seat_count: number; blocked_count: number; layout?: SeatPlanDraft };
export const seatPlansApi = {
  list: (venueKey: string) => apiRequest<SavedSeatPlan[]>(`/api/seat-plans/?${new URLSearchParams({ venue_key: venueKey })}`, { auth: 'required' }),
  get: (id: string) => apiRequest<SavedSeatPlan>(`/api/seat-plans/${id}/`, { auth: 'required' }),
  save: (layout: SeatPlanDraft) => apiRequest<SavedSeatPlan>(`/api/seat-plans/${layout.id}/`, { auth: 'required', method: 'PUT', body: { layout } }),
};
