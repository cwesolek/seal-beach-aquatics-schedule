import { test } from "node:test";
import assert from "node:assert/strict";
import { validateShiftRequest } from "../lib/shift-request-input";

test("ordinary cover routes to the selected coworker with no exchange or additional shift", () => {
  assert.equal(validateShiftRequest({shiftId:"first",recipientId:"recipient"},"requester"),null);
});
test("exchange and full-day covers are valid without notes", () => {
  assert.equal(validateShiftRequest({shiftId:"first",recipientId:"recipient",recipientShiftId:"second"},"requester"),null);
  assert.equal(validateShiftRequest({shiftId:"first",recipientId:"recipient",additionalShiftId:"second"},"requester"),null);
});
test("conflicting IDs, self-requests, and missing recipients are rejected", () => {
  for(const body of [
    {shiftId:"first",recipientId:"recipient",additionalShiftId:"first"},
    {shiftId:"first",recipientId:"recipient",recipientShiftId:"first"},
    {shiftId:"first",recipientId:"recipient",recipientShiftId:"second",additionalShiftId:"third"},
    {shiftId:"first",recipientId:"requester"},
    {shiftId:"first"},
  ]) assert.ok(validateShiftRequest(body,"requester"));
});
