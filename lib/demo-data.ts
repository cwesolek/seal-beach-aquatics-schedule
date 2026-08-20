import { isoDate, weekStart } from "@/lib/date";

const staff = [
  ["Alex Johnson", "manager"], ["Jordan Lee", "manager"], ["Maya Smith", "staff"],
  ["Noah Garcia", "staff"], ["Sam Wilson", "staff"], ["Taylor Brown", "staff"],
  ["Riley Chen", "staff"], ["Avery Davis", "staff"],
];

export function demoSnapshot() {
  const monday = weekStart();
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday); date.setDate(date.getDate() + index); return isoDate(date);
  });
  const shiftRows = dates.flatMap((date, dayIndex) => {
    const weekend = dayIndex === 5 || dayIndex === 6;
    const shifts = weekend
      ? [["Weekend coverage", "07:45", "12:15", "Maya Smith"], ["Afternoon coverage", "12:15", "17:15", "Open"]]
      : [["Morning", "05:45", "10:45", "Alex Johnson"], ["Midday", "10:45", "15:15", "Noah Garcia"], ["Evening", "18:45", "21:15", dayIndex === 2 ? "Open" : "Taylor Brown"]];
    return shifts.map(([title, startsAt, endsAt, assignee], index) => ({ id: `demo-${date}-${index}`, date, title, startsAt, endsAt, assignee, status: assignee === "Open" ? "open" : "assigned" }));
  });
  return {
    demo: true,
    viewer: { name: "Preview manager", role: "manager" },
    staff: staff.map(([name, role], index) => ({ id: `staff-${index}`, name, role, active: true })),
    shifts: shiftRows,
    swaps: [{ id: "swap-1", requester: "Sam Wilson", shift: "Thu evening", recipient: "Riley Chen", status: "pending" }],
    availability: [{ staff: "Maya Smith", note: "Available weekdays after 10:30 AM" }, { staff: "Riley Chen", note: "Unavailable Saturday" }],
  };
}
