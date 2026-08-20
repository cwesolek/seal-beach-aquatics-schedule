import { defaultTimesheetDueDate, isoDate, payPeriodEnd, payPeriodStart } from "@/lib/date";

const staff = [
  ["Alex Johnson", "manager"], ["Jordan Lee", "manager"], ["Maya Smith", "staff"],
  ["Noah Garcia", "staff"], ["Sam Wilson", "staff"], ["Taylor Brown", "staff"],
  ["Riley Chen", "staff"], ["Avery Davis", "staff"],
];

export function demoSnapshot() {
  const periodStart = payPeriodStart();
  const dates = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(periodStart); date.setDate(date.getDate() + index); return isoDate(date);
  });
  const shiftRows = dates.flatMap((date, dayIndex) => {
    const weekend = dayIndex % 7 === 0 || dayIndex % 7 === 6;
    const shifts = weekend
      ? [["Weekend coverage", "07:45", "12:15", "Maya Smith"], ["Afternoon coverage", "12:15", "17:15", "Open"]]
      : [["Morning", "05:45", "10:45", "Alex Johnson"], ["Midday", "10:45", "15:15", "Noah Garcia"], ["Evening", "18:45", "21:15", dayIndex === 2 ? "Open" : "Taylor Brown"]];
    return shifts.map(([title, startsAt, endsAt, assignee], index) => ({ id: `demo-${date}-${index}`, date, title, startsAt, endsAt, assignee, requiredStaff: 2, assignedCount: assignee === "Open" ? 0 : 1, status: "open" }));
  });
  return {
    demo: true,
    viewer: { name: "Preview manager", email: "manager@example.com", phone: "(562) 555-0148", role: "manager" },
    payPeriod: { start: isoDate(periodStart), end: isoDate(payPeriodEnd()), dueDate: isoDate(defaultTimesheetDueDate()), defaultDueDate: isoDate(defaultTimesheetDueDate()) },
    staff: staff.map(([name, role], index) => ({ id: `staff-${index}`, name, email: `${name.toLowerCase().replace(" ", ".")}@example.com`, phone: index < 2 ? "(562) 555-0148" : index === 5 ? null : "(562) 555-0120", role, active: true })),
    templates: [
      { id: "template-morning", title: "Morning", dayOfWeek: 1, startsAt: "05:45", endsAt: "10:45", requiredStaff: 2 },
      { id: "template-midday", title: "Midday", dayOfWeek: 1, startsAt: "10:45", endsAt: "15:15", requiredStaff: 2 },
      { id: "template-evening", title: "Evening", dayOfWeek: 1, startsAt: "18:45", endsAt: "21:15", requiredStaff: 2 },
      { id: "template-weekend", title: "Weekend", dayOfWeek: 0, startsAt: "07:45", endsAt: "12:15", requiredStaff: 2 },
    ],
    shifts: shiftRows,
    swaps: [{ id: "swap-1", requester: "Sam Wilson", shift: "Thu evening", recipient: "Riley Chen", status: "pending" }],
    availability: [{ staff: "Maya Smith", note: "Available weekdays after 10:30 AM" }, { staff: "Riley Chen", note: "Unavailable Saturday" }],
  };
}
