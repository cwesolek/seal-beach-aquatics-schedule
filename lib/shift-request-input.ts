export type ShiftRequestInput = { shiftId?: string; recipientId?: string; recipientShiftId?: string; additionalShiftId?: string };

export function validateShiftRequest(body: ShiftRequestInput, requesterId: string): string | null {
  if (!body.shiftId || !body.recipientId) return "Choose the coworker you want to ask.";
  if (body.recipientId === requesterId) return "Choose another staff member.";
  if (body.recipientShiftId === body.shiftId) return "Choose two different shifts.";
  // Missing optional IDs are not two selections of the same shift.
  if (body.additionalShiftId && (body.additionalShiftId === body.shiftId || body.additionalShiftId === body.recipientShiftId)) return "Choose different shifts for the request.";
  if (body.additionalShiftId && body.recipientShiftId) return "A full-day coverage request cannot also be a shift exchange.";
  return null;
}
