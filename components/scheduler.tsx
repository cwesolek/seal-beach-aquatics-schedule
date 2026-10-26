"use client";

import { useClerk } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";

type Staff = { id: string; name: string; firstName: string; lastName: string; email: string; phone: string | null; role: string; active: boolean };
type AssignedStaff = { id: string; name: string; scheduledStartsAt?: string | null; scheduledEndsAt?: string | null; actualStartsAt?: string | null; actualEndsAt?: string | null; isRecurring?: boolean };
type Shift = { id: string; templateId?: string | null; date: string; title: string; startsAt: string; endsAt: string; assignee: string; assignedStaff?: AssignedStaff[]; requiredStaff: number; assignedCount: number; status: string };
type ShiftTemplate = { id: string; title: string; dayOfWeek: number; startsAt: string; endsAt: string; requiredStaff: number };
type PayPeriod = { start: string; end: string; dueDate: string; defaultDueDate: string };
type HourAdjustment = { id: string; shiftId: string; staffId: string; staff: string; shiftTitle: string; shiftDate: string; scheduledStartsAt: string; scheduledEndsAt: string; requestedStartsAt: string; requestedEndsAt: string; note: string | null; status: string };
type Swap = { id: string; shiftId?: string; recipientShiftId?: string | null; additionalShiftId?: string | null; requesterId?: string; recipientId?: string | null; recipientAccepted?: boolean; requester: string; shift: string; recipient: string; recipientShift?: string | null; additionalShift?: string | null; note?: string | null; status: string; managerDismissed?: boolean; acceptedAt?: string | null };
type PendingProfile = { id: string; name: string; email: string; requestedOn: string };
type AvailabilityNote = { id: string; staff: string; note: string; status: string; startsOn: string; endsOn: string };
type TimesheetEntry = { staffId?: string; rowType: TimesheetRowType; entryKey: string; hours: number };
type TimesheetRowType = "regular" | "sick" | "overtime" | "other";
type Snapshot = { demo: boolean; approvalRequired?: boolean; rejected?: boolean; viewer: { id: string; name: string; firstName: string; lastName: string; email: string; phone: string | null; role: string }; staff: Staff[]; shifts: Shift[]; templates?: ShiftTemplate[]; swaps: Swap[]; availability: AvailabilityNote[]; hourAdjustments?: HourAdjustment[]; timesheetEntries?: TimesheetEntry[]; pendingProfiles?: PendingProfile[]; aquaticsExcludedWeeks?: string[]; payPeriod: PayPeriod; periodOffset?: number };
type ApiPayload = { ok?: boolean; error?: string; message?: string; shift?: Shift };
type PersonalShift = Shift & { sourceShifts: Shift[] };

function staffSortName(person: Staff) {
  const nameParts = person.name.trim().split(/\s+/).filter(Boolean);
  return {
    lastName: person.lastName.trim() || nameParts.at(-1) || "",
    firstName: person.firstName.trim() || nameParts.slice(0, -1).join(" ") || person.name.trim(),
  };
}

function staffByLastName(left: Staff, right: Staff) {
  const leftName = staffSortName(left);
  const rightName = staffSortName(right);
  return leftName.lastName.localeCompare(rightName.lastName, undefined, { sensitivity: "base" }) || leftName.firstName.localeCompare(rightName.firstName, undefined, { sensitivity: "base" }) || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function sortedStaff(staff: Staff[]) { return [...staff].sort(staffByLastName); }

function staffLastNameFirst(person: Staff) {
  const { firstName, lastName } = staffSortName(person);
  if (!lastName) return firstName || person.name;
  if (!firstName || firstName.localeCompare(lastName, undefined, { sensitivity: "base" }) === 0) return lastName;
  return `${lastName}, ${firstName}`;
}

function fullNameLastNameFirst(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name;
  return `${parts.at(-1)}, ${parts.slice(0, -1).join(" ")}`;
}

const tabs = ["Dashboard", "My shifts", "Timesheet", "Schedule", "Staff", "Availability", "Open shifts", "Swaps", "Hours"] as const;
const staffTabs: Tab[] = ["My shifts", "Timesheet", "Schedule", "Staff", "Availability", "Swaps", "Hours"];
type Tab = (typeof tabs)[number];

function readableDate(date: string) { return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function readableLongDate(date: string) { return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function rosterDate(date: string) {
  const value = new Date(`${date}T12:00:00`);
  return {
    date: new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" }).format(value),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(value),
  };
}
function compactRosterTime(time: string) { return time.replace(":", "").replace(/^0/, ""); }
function assignmentHourTotals(shifts: Shift[], includeApprovedWorkedTimes: boolean) {
  const rangesByStaffDay = new Map<string, { staffId: string; name: string; ranges: Array<{ startsAt: string; endsAt: string }> }>();
  shifts.forEach((shift) => shift.assignedStaff?.forEach((person) => {
    const useActual = includeApprovedWorkedTimes && person.actualStartsAt && person.actualEndsAt;
    const startsAt = useActual ? person.actualStartsAt! : person.scheduledStartsAt ?? shift.startsAt;
    const endsAt = useActual ? person.actualEndsAt! : person.scheduledEndsAt ?? shift.endsAt;
    const key = `${person.id}:${shift.date}`;
    const day = rangesByStaffDay.get(key) ?? { staffId: person.id, name: person.name, ranges: [] };
    day.ranges.push({ startsAt, endsAt });
    rangesByStaffDay.set(key, day);
  }));

  const totals = new Map<string, { name: string; hours: number }>();
  rangesByStaffDay.forEach(({ staffId, name, ranges }) => {
    const merged = [...ranges].sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.endsAt.localeCompare(right.endsAt)).reduce<Array<{ startsAt: string; endsAt: string }>>((result, range) => {
      const previous = result.at(-1);
      if (previous && range.startsAt <= previous.endsAt) {
        if (range.endsAt > previous.endsAt) previous.endsAt = range.endsAt;
      } else {
        result.push({ ...range });
      }
      return result;
    }, []);
    const hours = merged.reduce((total, range) => total + duration(range.startsAt, range.endsAt), 0);
    const existing = totals.get(staffId);
    totals.set(staffId, { name, hours: (existing?.hours ?? 0) + hours });
  });
  return totals;
}
function sumAssignmentHours(totals: Map<string, { name: string; hours: number }>) { return Array.from(totals.values()).reduce((sum, person) => sum + person.hours, 0); }
function formatHours(hours: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(hours); }
function formatTimesheetHours(hours: number) { return hours ? hours < 0 ? `(${Math.abs(hours).toFixed(2)})` : hours.toFixed(2) : ""; }
function nearestHalfHour(time: string) { const [hour, minute] = time.split(":").map(Number); const total = Math.min(23 * 60 + 30, Math.round((hour * 60 + minute) / 30) * 30); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
function mergeOverlappingShiftTimes(shifts: Shift[]) {
  const ranges = [...shifts]
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.endsAt.localeCompare(right.endsAt))
    .map((shift) => ({ id: shift.id, startsAt: shift.startsAt, endsAt: shift.endsAt }));
  return ranges.reduce<Array<{ id: string; startsAt: string; endsAt: string }>>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.startsAt <= previous.endsAt) {
      previous.id = `${previous.id}+${range.id}`;
      if (range.endsAt > previous.endsAt) previous.endsAt = range.endsAt;
    } else {
      merged.push({ ...range });
    }
    return merged;
  }, []);
}
function duration(start: string, end: string) { const [a, b] = [start, end].map((value) => { const [hour, minute] = value.split(":").map(Number); return hour + minute / 60; }); return Math.max(0, b - a); }
const quarterHourTimes = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4); const minute = (index % 4) * 15; const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { value, label: `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}` };
});

function QuarterHourSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const options = quarterHourTimes.some((option) => option.value === value) ? quarterHourTimes : [...quarterHourTimes, { value, label: value }].sort((left, right) => left.value.localeCompare(right.value));
  return <label>{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} required>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function PriorAdjustmentInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const formatted = value < 0 ? `(${Math.abs(value)})` : value ? String(value) : "";
  const [draft, setDraft] = useState(formatted);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(formatted); }, [editing, formatted]);
  const applyDraft = (raw: string) => {
    const normalized = raw.trim().replace(/^\((.*)\)$/, "-$1");
    const next = normalized ? Number(normalized) : 0;
    if (Number.isFinite(next) && next >= -999.5 && next <= 999.5 && Math.round(next * 2) === next * 2) onChange(next);
  };
  const step = (amount: number) => onChange(Math.max(-999.5, Math.min(999.5, Math.round((value + amount) * 2) / 2)));
  return <span className="prior-adjustment-input"><input aria-label={label} type="text" inputMode="decimal" value={draft} onFocus={() => { setEditing(true); setDraft(value ? String(value) : ""); }} onChange={(event) => { setDraft(event.target.value); applyDraft(event.target.value); }} onBlur={() => { setEditing(false); setDraft(value < 0 ? `(${Math.abs(value)})` : value ? String(value) : ""); }}/><span className="prior-stepper-controls"><button type="button" tabIndex={-1} aria-label={`Increase ${label} by half an hour`} onClick={() => step(0.5)}>▲</button><button type="button" tabIndex={-1} aria-label={`Decrease ${label} by half an hour`} onClick={() => step(-0.5)}>▼</button></span></span>;
}

function combineConnectedShifts(shifts: Shift[]): PersonalShift[] {
  const sorted = [...shifts].sort((left, right) => `${left.date} ${left.startsAt}`.localeCompare(`${right.date} ${right.startsAt}`));
  const used = new Set<string>(); const combined: PersonalShift[] = [];
  for (const shift of sorted) {
    if (used.has(shift.id)) continue;
    const group = [shift]; used.add(shift.id);
    let currentTitle = shift.title.toLowerCase(); let currentEnd = shift.endsAt;
    while (currentTitle === "morning" || currentTitle === "midday") {
      const nextTitle = currentTitle === "morning" ? "midday" : "aquatics class";
      const next = sorted.find((candidate) => !used.has(candidate.id) && candidate.date === shift.date && candidate.title.toLowerCase() === nextTitle && candidate.startsAt <= currentEnd);
      if (!next) break;
      group.push(next); used.add(next.id); currentTitle = nextTitle; if (next.endsAt > currentEnd) currentEnd = next.endsAt;
    }
    const titles = group.map((item) => item.title.toLowerCase());
    const title = titles.includes("morning") && titles.includes("midday") ? (titles.includes("aquatics class") ? "Full day + Aquatics class" : "Full day shift") : titles.includes("midday") && titles.includes("aquatics class") ? "Midday + Aquatics class" : shift.title;
    combined.push({ ...shift, id: group.map((item) => item.id).join("+"), title, endsAt: currentEnd, sourceShifts: group });
  }
  return combined;
}

export default function Scheduler() {
  const [tab, setTab] = useState<Tab>("Dashboard"); const [data, setData] = useState<Snapshot | null>(null); const [notice, setNotice] = useState(""); const [periodOffset, setPeriodOffset] = useState(0);
  const loadVersion = useRef(0);
  const refresh = async () => {
    const version = ++loadVersion.current;
    try {
      const response = await fetch(`/api/schedule?periodOffset=${periodOffset}`, { cache: "no-store" });
      const body = await response.json();
      if (version === loadVersion.current) setData(body);
    } catch { if (version === loadVersion.current) setNotice("Could not load the schedule."); }
  };
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15000);
    const onFocus = () => { refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { ++loadVersion.current; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [periodOffset]);
  const openShifts = (data?.shifts ?? []).filter((shift) => shift.status === "open");
  const scheduledHours = useMemo(() => sumAssignmentHours(assignmentHourTotals(data?.shifts ?? [], false)), [data]);
  async function api(path: string, method: string, body?: unknown) {
    if (data?.demo) { setNotice("Preview mode: sign in to save this change."); return false; }
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const payload = await response.json().catch(() => ({})) as ApiPayload;
      setNotice(payload.error || payload.message || (payload.ok ? "Saved." : "Something went wrong."));
      if (payload.ok && payload.shift) {
        setData((current) => current ? { ...current, shifts: current.shifts.some((shift) => shift.id === payload.shift?.id) ? current.shifts.map((shift) => shift.id === payload.shift?.id ? payload.shift as Shift : shift) : [...current.shifts, payload.shift as Shift] } : current);
      } else if (payload.ok) {
        await refresh();
      }
      return Boolean(payload.ok);
    } catch { setNotice("That request could not be completed. Please try again."); return false; }
  }
  if (!data) return <main className="loading">Loading the schedule…</main>;
  if (data.approvalRequired) return <PendingApproval viewer={data.viewer} rejected={Boolean(data.rejected)} />;
  const visibleTabs: readonly Tab[] = data.viewer.role === "manager" ? tabs : staffTabs;
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0];
  const incomingSwapCount = data.swaps.filter((swap) => swap.status === "pending" && swap.recipientId === data.viewer.id).length;
  return <main>
    <header><div className="topbar"><div><strong>Seal Beach Aquatics Schedule</strong><span>{data.demo ? "Interactive preview" : `${data.viewer.role} view`}</span></div>{data.demo ? <a href="/sign-in">Sign in</a> : <div style={{ display: "flex", alignItems: "center", gap: "10px" }}><span>Signed in as {data.viewer.name}</span><SignOutButton /></div>}</div></header>
    <section className="wrap"><div className="title-row"><div><p className="eyebrow">Operations center</p><h1>Clear coverage, calmer days.</h1><p className="muted">Plan the pay period, coordinate changes, and keep every lifeguard in the loop.</p></div>{data.demo && <div className="preview-note">Sign in to use the secure staff schedule and save changes.</div>}</div>
      <nav className="tabs" aria-label="Scheduling areas">{visibleTabs.map((item) => <button key={item} className={activeTab === item ? "tab active" : "tab"} onClick={() => setTab(item)}>{item}</button>)}</nav>
      {incomingSwapCount > 0 && <div className="notice swap-alert"><span><strong>Shift request waiting:</strong> someone requested an exchange or coverage.</span><button onClick={() => setTab("Swaps")}>Review and accept</button></div>}
      {notice && <p className="notice">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></p>}
      {activeTab === "Dashboard" && data.viewer.role === "manager" && <><ProfileApprovals profiles={data.pendingProfiles ?? []} api={api} /><Dashboard data={data} openCount={openShifts.length} hours={scheduledHours} setTab={setTab} api={api} /></>}
      {activeTab === "My shifts" && <MyShifts data={data} api={api} periodOffset={periodOffset} setPeriodOffset={setPeriodOffset} />}
      {activeTab === "Timesheet" && <Timesheet data={data} api={api} periodOffset={periodOffset} setPeriodOffset={setPeriodOffset} />}
      {activeTab === "Schedule" && <Schedule data={data} api={api} periodOffset={periodOffset} setPeriodOffset={setPeriodOffset} />}
      {activeTab === "Staff" && <Directory data={data} api={api} />}
      {activeTab === "Availability" && <Availability data={data} api={api} />}
      {activeTab === "Open shifts" && data.viewer.role === "manager" && <OpenShifts shifts={openShifts} api={api} />}
      {activeTab === "Swaps" && <Swaps data={data} api={api} />}
      {activeTab === "Hours" && <Hours data={data} scheduledHours={scheduledHours} api={api} />}
    </section>
  </main>;
}

function SignOutButton() {
  const { signOut } = useClerk();
  return <button className="secondary small-button" onClick={() => signOut({ redirectUrl: "/" })}>Sign out</button>;
}

function AccountSecurityButton() {
  const { openUserProfile } = useClerk();
  return <button type="button" className="secondary" onClick={() => openUserProfile()}>Change password</button>;
}

function PendingApproval({ viewer, rejected }: { viewer: { name: string; email: string }; rejected: boolean }) {
  return <main className="approval-page"><section className="card approval-card"><p className="eyebrow">Account security</p><h1>{rejected ? "Access not approved" : "Manager approval required"}</h1><p>{rejected ? "A manager did not approve this profile for schedule access." : "Your profile has been created, but you cannot view schedules or staff information until a manager approves it."}</p><div className="approval-identity"><strong>{viewer.name}</strong><span>{viewer.email}</span></div><p className="muted">{rejected ? "Contact an SBA Schedule manager if you believe this was a mistake." : "You can leave this page and return after a manager reviews your request."}</p><SignOutButton /></section></main>;
}

function Dashboard({ data, openCount, hours, setTab, api }: { data: Snapshot; openCount: number; hours: number; setTab: (tab: Tab) => void; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) { return <><div className="metrics"><Metric label="Active staff" value={data.staff.length} /><Metric label="Open shifts" value={openCount} /><Metric label="Pending swaps" value={data.swaps.filter((item) => item.status === "pending").length} /><Metric label="Scheduled this pay period" value={`${hours} hrs`} /></div><section className="card pay-period-card"><div><p className="eyebrow">Current pay period</p><h2>{readableDate(data.payPeriod.start)} – {readableDate(data.payPeriod.end)}</h2><p className="muted">Two weeks, Sunday through Saturday. Scheduled hours and coverage include the entire pay period.</p></div><div className="due-date"><span>Timesheets due</span><strong>{readableLongDate(data.payPeriod.dueDate)}</strong>{data.payPeriod.dueDate !== data.payPeriod.defaultDueDate && <em>Manager-adjusted deadline</em>}{data.viewer.role === "manager" && <DueDateForm payPeriod={data.payPeriod} api={api} />}</div></section><section className="card action-card"><div><p className="eyebrow">Manager dashboard</p><h2>Pay period at a glance</h2><p className="muted">Review coverage gaps, availability conflicts, and staff requests from one place.</p></div><button onClick={() => setTab("Schedule")}>Open schedule builder</button></section><section className="two-col"><article className="card"><h2>Needs attention</h2>{openCount ? <p>{openCount} open shift{openCount === 1 ? "" : "s"} still need coverage.</p> : <p>All scheduled shifts are covered.</p>}<button className="secondary" onClick={() => setTab("Open shifts")}>Review open shifts</button></article><article className="card"><h2>Availability notes</h2>{data.availability.map((item) => <AvailabilityNoteRow key={item.id} item={item} manager api={api} />)}</article></section></> }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric card"><span>{label}</span><strong>{value}</strong></div>; }
function ProfileApprovals({ profiles, api }: { profiles: PendingProfile[]; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) { if (!profiles.length) return null; return <section className="card profile-approvals"><p className="eyebrow">Security review</p><h2>New profiles awaiting approval</h2><p className="muted">Only approve people you recognize as current SBA staff.</p>{profiles.map((profile) => <article className="profile-approval" key={profile.id}><div><strong>{profile.name}</strong><span>{profile.email} · Requested {readableDate(profile.requestedOn)}</span></div><div><button onClick={() => api("/api/staff", "PATCH", { action: "approveProfile", staffId: profile.id })}>Approve</button><button className="danger" onClick={() => { if (window.confirm(`Reject schedule access for ${profile.name}?`)) api("/api/staff", "PATCH", { action: "rejectProfile", staffId: profile.id }); }}>Reject</button></div></article>)}</section>; }
function MyShifts({ data, api, periodOffset, setPeriodOffset }: { data: Snapshot; api: (path: string, method: string, body?: unknown) => Promise<boolean>; periodOffset: number; setPeriodOffset: (offset: number) => void }) {
  const assignedShifts = data.shifts
    .filter((shift) => shift.assignedStaff?.some((person) => person.id === data.viewer.id) || shift.assignee.split(", ").includes(data.viewer.name))
    .map((shift) => { const assignment = shift.assignedStaff?.find((person) => person.id === data.viewer.id); return { ...shift, startsAt: assignment?.scheduledStartsAt ?? shift.startsAt, endsAt: assignment?.scheduledEndsAt ?? shift.endsAt }; })
    .sort((left, right) => `${left.date} ${left.startsAt}`.localeCompare(`${right.date} ${right.startsAt}`));
  const shifts = combineConnectedShifts(assignedShifts);
  const totalHours = shifts.reduce((total, shift) => total + duration(shift.startsAt, shift.endsAt), 0);
  return <section className="card my-shifts"><p className="eyebrow">Personal schedule</p><h2>{periodOffset < 0 ? "Previous" : periodOffset > 0 ? "Future" : "Current"} pay period · My shifts</h2><p className="muted">{readableDate(data.payPeriod.start)} through {readableDate(data.payPeriod.end)}</p><div className="schedule-controls"><button className="secondary" onClick={() => setPeriodOffset(periodOffset - 1)} disabled={periodOffset <= -26}>Previous pay period</button><button className="secondary" onClick={() => setPeriodOffset(0)} disabled={periodOffset === 0}>Current pay period</button><button className="secondary" onClick={() => setPeriodOffset(periodOffset + 1)} disabled={periodOffset >= 26}>Next pay period</button></div><div className="my-shifts-summary"><strong>{shifts.length}</strong><span>shift{shifts.length === 1 ? "" : "s"}</span><strong>{totalHours} hrs</strong><span>scheduled</span></div>{shifts.length ? <div className="my-shifts-list">{shifts.map((shift) => <PersonalShiftCard key={shift.id} shift={shift} data={data} api={api} />)}</div> : <div className="my-shifts-empty"><strong>No shifts assigned this pay period.</strong><span>Your assigned shifts will appear here automatically.</span></div>}</section>;
}

const timesheetRows: Array<{ type: TimesheetRowType; label: string; fund: string }> = [
  { type: "regular", label: "PT Aquatics", fund: "101-230-0073-50030" },
  { type: "sick", label: "Sick", fund: "" },
  { type: "overtime", label: "Overtime", fund: "101-230-0073-50070" },
  { type: "other", label: "Other", fund: "" },
];

function timesheetDates(start: string) { const first = new Date(`${start}T12:00:00`); return Array.from({ length: 14 }, (_, index) => { const date = new Date(first); date.setDate(first.getDate() + index); return date.toISOString().slice(0, 10); }); }
function shortDate(date: string) { return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function weekdayShort(date: string) { return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${date}T12:00:00`)); }
function longDate(date: string) { return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function printTarget(target: "roster" | "timesheet") { document.body.dataset.printTarget = target; const cleanup = () => { delete document.body.dataset.printTarget; }; window.addEventListener("afterprint", cleanup, { once: true }); window.print(); window.setTimeout(cleanup, 1500); }

function Timesheet({ data, api, periodOffset, setPeriodOffset }: { data: Snapshot; api: (path: string, method: string, body?: unknown) => Promise<boolean>; periodOffset: number; setPeriodOffset: (offset: number) => void }) {
  const manager = data.viewer.role === "manager";
  const managerStaff = useMemo(() => sortedStaff(data.staff), [data.staff]);
  const [selectedStaffId, setSelectedStaffId] = useState(data.viewer.id);
  useEffect(() => {
    if (!manager) { setSelectedStaffId(data.viewer.id); return; }
    if (!managerStaff.some((person) => person.id === selectedStaffId)) setSelectedStaffId(managerStaff[0]?.id ?? data.viewer.id);
  }, [data.viewer.id, manager, managerStaff, selectedStaffId]);
  const selectedStaff = data.staff.find((person) => person.id === selectedStaffId);
  const selectedName = selectedStaff ? staffLastNameFirst(selectedStaff) : fullNameLastNameFirst(data.viewer.name);
  const dates = useMemo(() => timesheetDates(data.payPeriod.start), [data.payPeriod.start]);
  const automaticHours = useMemo(() => {
    const byDate = new Map<string, Array<{ startsAt: string; endsAt: string }>>();
    data.shifts.forEach((shift) => { const assignment = shift.assignedStaff?.find((person) => person.id === selectedStaffId); if (!assignment) return; const useActual = assignment.actualStartsAt && assignment.actualEndsAt; const ranges = byDate.get(shift.date) ?? []; ranges.push({ startsAt: useActual ? assignment.actualStartsAt! : assignment.scheduledStartsAt ?? shift.startsAt, endsAt: useActual ? assignment.actualEndsAt! : assignment.scheduledEndsAt ?? shift.endsAt }); byDate.set(shift.date, ranges); });
    const totals = new Map<string, number>();
    byDate.forEach((ranges, date) => { const merged = [...ranges].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).reduce<Array<{ startsAt: string; endsAt: string }>>((result, range) => { const previous = result.at(-1); if (previous && range.startsAt <= previous.endsAt) { if (range.endsAt > previous.endsAt) previous.endsAt = range.endsAt; } else result.push({ ...range }); return result; }, []); const hours = merged.reduce((sum, range) => sum + duration(range.startsAt, range.endsAt), 0); totals.set(date, Math.round(hours * 2) / 2); });
    return totals;
  }, [data.shifts, selectedStaffId]);
  const [values, setValues] = useState<Record<string, number>>({});
  useEffect(() => { const saved = new Map((data.timesheetEntries ?? []).filter((entry) => !entry.staffId || entry.staffId === selectedStaffId).map((entry) => [`${entry.rowType}:${entry.entryKey}`, entry.hours])); const next: Record<string, number> = {}; timesheetRows.forEach((row) => [...dates, "flex", "prior"].forEach((key) => { const id = `${row.type}:${key}`; next[id] = saved.has(id) ? saved.get(id)! : row.type === "regular" && dates.includes(key) ? automaticHours.get(key) ?? 0 : 0; })); setValues(next); }, [automaticHours, data.timesheetEntries, dates, selectedStaffId]);
  const value = (row: TimesheetRowType, key: string) => values[`${row}:${key}`] ?? 0;
  const setValue = (row: TimesheetRowType, key: string, hours: number) => setValues((current) => ({ ...current, [`${row}:${key}`]: hours }));
  const rowTotal = (row: TimesheetRowType) => [...dates, "flex", "prior"].reduce((sum, key) => sum + value(row, key), 0);
  const grandTotal = timesheetRows.reduce((sum, row) => sum + rowTotal(row.type), 0);
  const sectionTotal = (rows: TimesheetRowType[], key: string) => rows.reduce((sum, row) => sum + value(row, key), 0);
  const renderBlankRow = (key: string) => <tr className="timesheet-blank-row" key={key}>{Array.from({ length: 18 }, (_, index) => <td key={index}/>)}</tr>;
  const renderSubtotalRow = (key: string, rows: TimesheetRowType[]) => <tr className="timesheet-subtotal" key={key}>{dates.map((date) => <td key={date}>{formatTimesheetHours(sectionTotal(rows, date))}</td>)}{["flex", "prior"].map((entryKey) => <td key={entryKey}>{formatTimesheetHours(sectionTotal(rows, entryKey))}</td>)}<td className="line-total">{formatTimesheetHours(rows.reduce((sum, row) => sum + rowTotal(row), 0))}</td><td/></tr>;
  const save = () => api("/api/timesheet", "PUT", { staffId: selectedStaffId, periodStart: data.payPeriod.start, periodEnd: data.payPeriod.end, entries: timesheetRows.flatMap((row) => [...dates, "flex", "prior"].map((entryKey) => ({ rowType: row.type, entryKey, hours: value(row.type, entryKey) }))) });
  const renderRow = (row: (typeof timesheetRows)[number]) => <tr key={row.type}>{dates.map((date) => <td key={date}><input aria-label={`${row.label} hours ${date}`} type="number" min="0" max="24" step="0.5" value={value(row.type, date) || ""} onChange={(event) => setValue(row.type, date, Number(event.target.value))}/><span className="timesheet-print-value">{formatTimesheetHours(value(row.type, date))}</span></td>)}{["flex", "prior"].map((key) => { const hours = value(row.type, key); return <td key={key} className="adjustment-cell">{key === "prior" ? <PriorAdjustmentInput label={`${row.label} prior adjustment`} value={hours} onChange={(next) => setValue(row.type, key, next)}/> : <input aria-label={`${row.label} flex adjustment`} type="number" min="0" max="999.5" step="0.5" value={hours || ""} onChange={(event) => setValue(row.type, key, Number(event.target.value))}/>}<span className="timesheet-print-value">{formatTimesheetHours(hours)}</span></td>; })}<td className="line-total">{formatTimesheetHours(rowTotal(row.type))}</td><td className="fund-cell">{row.fund}{row.fund && " "}{row.label}</td></tr>;
  return <section className="timesheet-area">{manager && <aside className="card timesheet-staff-picker"><div><p className="eyebrow">Staff timesheets</p><h2>Select an employee</h2><p className="muted">Your own timesheet is included. Choose anyone to view, edit, save, or print their timesheet for this pay period.</p></div><div className="timesheet-staff-list">{managerStaff.map((person) => <button type="button" key={person.id} className={person.id === selectedStaffId ? "timesheet-staff active" : "timesheet-staff"} onClick={() => setSelectedStaffId(person.id)}><span>{staffLastNameFirst(person)}{person.id === data.viewer.id ? " (You)" : ""}</span><small>{person.id === selectedStaffId ? "Selected" : "View timesheet"}</small></button>)}</div></aside>}<div className="card timesheet-controls"><div><p className="eyebrow">City timesheet</p><h2>{manager ? selectedName : "Part-Time Biweekly Time Sheet"}</h2><p className="muted">Regular hours are prefilled from the schedule and approved worked-time changes. Every hour box remains editable; negative prior-period adjustments subtract from the total.</p></div><div className="schedule-controls"><button className="secondary" onClick={() => setPeriodOffset(periodOffset - 1)} disabled={periodOffset <= -26}>Previous pay period</button><button className="secondary" onClick={() => setPeriodOffset(0)} disabled={periodOffset === 0}>Current pay period</button><button className="secondary" onClick={() => setPeriodOffset(periodOffset + 1)} disabled={periodOffset >= 26}>Next pay period</button><button onClick={save}>Save {manager ? `${selectedName}'s` : "timesheet"}</button><button onClick={() => printTarget("timesheet")}>Print {manager ? `${selectedName}'s` : "timesheet"}</button></div></div>
    <section className="card employee-timesheet-print">
      <header className="timesheet-header"><div className="timesheet-seal" aria-label="City of Seal Beach seal"/><h1>Part-Time Biweekly Time Sheet</h1><div><strong>Dept.: &nbsp; 001073</strong><strong>Employee Name: {selectedName}</strong><strong>PT</strong></div></header>
      <div className="timesheet-period"><strong>Pay Period Ending: {longDate(data.payPeriod.end)}</strong><span><b>{longDate(data.payPeriod.start)}</b><em>thru</em><b>{longDate(data.payPeriod.end)}</b></span></div>
      <strong className="timesheet-table-label">PAY PERIOD DATES:</strong><div className="timesheet-grid-wrap"><table className="timesheet-grid"><colgroup>{dates.map((date) => <col className="timesheet-day-column" key={date}/>) }<col className="timesheet-adjustment-column"/><col className="timesheet-adjustment-column"/><col className="timesheet-total-column"/><col className="timesheet-fund-column"/></colgroup><thead><tr>{dates.map((date) => <th key={date}>{weekdayShort(date)}</th>)}<th rowSpan={2}>Flex<br/>Adjustment</th><th rowSpan={2}>Prior Period<br/>Adjustment</th><th rowSpan={2}>LINE<br/>TOTALS</th><th rowSpan={2} className="fund-heading">Fund</th></tr><tr>{dates.map((date) => <th key={date}>{shortDate(date)}</th>)}</tr></thead><tbody><tr className="timesheet-section-bar"><th colSpan={17}/><th/></tr>{timesheetRows.slice(0, 2).map(renderRow)}{renderBlankRow("regular-blank-1")}{renderBlankRow("regular-blank-2")}{renderSubtotalRow("regular-subtotal", ["regular", "sick"])}<tr className="extra-hours-heading"><th colSpan={17}>EXTRA HOURS WORKED</th><th>Description</th></tr>{timesheetRows.slice(2).map(renderRow)}{renderBlankRow("extra-blank-1")}{renderBlankRow("extra-blank-2")}{renderSubtotalRow("extra-subtotal", ["overtime", "other"])}</tbody></table></div>
      <div className="timesheet-signatures"><span>Employee Signature</span><span>Date</span><span>Supervisor Signature</span><span>Date</span><strong>TOTAL HOURS THIS PERIOD</strong><b>{formatTimesheetHours(grandTotal) || "0.00"}</b></div>
      <p className="timesheet-instruction">Time sheets are to be completed and turned into your supervisor for review and approval.</p>
    </section>
  </section>;
}

function PersonalShiftCard({ shift, data, api }: { shift: PersonalShift; data: Snapshot; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const connected = shift.sourceShifts.length > 1;
  const morning = shift.sourceShifts.find((source) => source.title.toLowerCase() === "morning"); const midday = shift.sourceShifts.find((source) => source.title.toLowerCase() === "midday");
  const coveragePair = morning && midday ? [morning, midday] : undefined;
  const fullDayPending = coveragePair ? data.swaps.find((swap) => swap.status === "pending" && swap.requesterId === data.viewer.id && swap.shiftId === coveragePair[0].id && swap.additionalShiftId === coveragePair[1].id) : undefined;
  const portionPending = coveragePair ? data.swaps.some((swap) => swap.status === "pending" && swap.requesterId === data.viewer.id && !swap.additionalShiftId && coveragePair.some((source) => swap.shiftId === source.id)) : false;
  return <article className="my-shift"><div className="my-shift-details"><div><strong>{readableLongDate(shift.date)}</strong><span>{shift.title}</span></div><div><strong>{shift.startsAt}–{shift.endsAt}</strong><span>{duration(shift.startsAt, shift.endsAt)} scheduled hours</span></div></div>{coveragePair && (fullDayPending ? <p className="pending-swap">Morning and Midday coverage requested from <strong>{fullDayPending.recipient}</strong>; awaiting acceptance.</p> : portionPending ? <p className="muted full-day-unavailable">Combined Morning and Midday coverage is unavailable while a portion request is pending.</p> : <FullDayCoverageForm shifts={coveragePair} data={data} api={api} label={shift.sourceShifts.length > 2 ? "Morning + Midday" : "full-day"} />)}{shift.sourceShifts.map((source) => { const assignment = source.assignedStaff?.find((person) => person.id === data.viewer.id); const pending = data.hourAdjustments?.find((request) => request.shiftId === source.id && request.status === "pending"); const pendingSwap = data.swaps.find((swap) => swap.status === "pending" && !swap.additionalShiftId && swap.shiftId === source.id && swap.requesterId === data.viewer.id); const coveredByPair = Boolean(fullDayPending && coveragePair?.some((item) => item.id === source.id)); return <section className={connected ? "full-day-segment" : "my-shift-actions"} key={source.id}>{connected && <strong>{source.title} · {source.startsAt}–{source.endsAt}</strong>}{assignment?.actualStartsAt && assignment.actualEndsAt && <p className="approved-hours">Approved worked hours: <strong>{assignment.actualStartsAt}–{assignment.actualEndsAt}</strong></p>}{pending ? <p className="pending-hours">Pending manager approval: <strong>{pending.requestedStartsAt}–{pending.requestedEndsAt}</strong></p> : <WorkedHoursForm shift={source} api={api} />}{coveredByPair ? null : pendingSwap ? <p className="pending-swap">Awaiting acceptance from <strong>{pendingSwap.recipient}</strong>.</p> : <SwapRequestForm shift={source} data={data} api={api} coverageName={connected ? source.title : undefined} />}</section>; })}</article>;
}

function FullDayCoverageForm({ shifts, data, api, label }: { shifts: Shift[]; data: Snapshot; api: (path: string, method: string, body?: unknown) => Promise<boolean>; label: string }) {
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false); const [recipientId, setRecipientId] = useState("");
  const coworkers = data.staff.filter((person) => person.id !== data.viewer.id && shifts.every((shift) => !shift.assignedStaff?.some((assigned) => assigned.id === person.id)));
  if (!open) return <button type="button" className="secondary small-button full-day-cover" onClick={() => setOpen(true)}>Request {label} coverage</button>;
  return <form className="swap-request-form full-day-cover-form" onSubmit={async (event) => { event.preventDefault(); setSending(true); const saved = await api("/api/swaps", "POST", { shiftId: shifts[0].id, additionalShiftId: shifts[1].id, recipientId }); setSending(false); if (!saved) return; setOpen(false); setRecipientId(""); }}><p className="muted">Ask one coworker to cover both the Morning and Midday portions. Their acceptance transfers both shifts together.</p><label>Ask coworker<select value={recipientId} onChange={(event) => setRecipientId(event.target.value)} required><option value="">Choose a coworker…</option>{coworkers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><div><button type="submit" disabled={sending || !recipientId}>Send {label} request</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button></div></form>;
}
function WorkedHoursForm({ shift, api }: { shift: Shift; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) { const [editing, setEditing] = useState(false); const [startsAt, setStartsAt] = useState(() => nearestHalfHour(shift.startsAt)); const [endsAt, setEndsAt] = useState(() => nearestHalfHour(shift.endsAt)); const [note, setNote] = useState(""); if (!editing) return <button type="button" className="secondary small-button report-hours" onClick={() => setEditing(true)}>Report different hours</button>; return <form className="worked-hours-form" onSubmit={async (event) => { event.preventDefault(); await api("/api/hour-adjustments", "POST", { shiftId: shift.id, startsAt, endsAt, note }); setEditing(false); }}><label>Actual start<input type="time" step="1800" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><label>Actual end<input type="time" step="1800" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label><p className="muted quarter-hour-help">Choose times in 30-minute increments.</p><label className="hours-note">Note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional reason, such as left early or stayed late" /></label><div className="hours-form-actions"><button type="submit">Send for approval</button><button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button></div></form>; }
function SwapRequestForm({ shift, data, api, coverageName }: { shift: Shift; data: Snapshot; api: (path: string, method: string, body?: unknown) => Promise<boolean>; coverageName?: string }) {
  const [sending, setSending] = useState(false); const [mode, setMode] = useState<"exchange" | "cover" | null>(null); const [requestedAssignment, setRequestedAssignment] = useState(""); const [coveringStaffId, setCoveringStaffId] = useState("");
  const options = data.shifts.flatMap((coworkerShift) => coworkerShift.id === shift.id || coworkerShift.assignedStaff?.some((person) => person.id === data.viewer.id) ? [] : (coworkerShift.assignedStaff ?? []).filter((person) => person.id !== data.viewer.id && !shift.assignedStaff?.some((assigned) => assigned.id === person.id)).map((person) => ({ value: `${coworkerShift.id}:${person.id}`, shiftId: coworkerShift.id, staffId: person.id, label: `${person.name} — ${readableLongDate(coworkerShift.date)}, ${coworkerShift.startsAt}–${coworkerShift.endsAt} (${coworkerShift.title})` })));
  const coverStaff = data.staff.filter((person) => person.id !== data.viewer.id && !shift.assignedStaff?.some((assigned) => assigned.id === person.id));
  if (!mode) return <div className="shift-request-actions"><button type="button" className="secondary small-button request-swap" onClick={() => setMode("exchange")}>Request shift exchange</button><button type="button" className="secondary small-button request-swap" onClick={() => setMode("cover")}>Request {coverageName ? `${coverageName} coverage` : "coverage"}</button></div>;
  if (mode === "cover") return <form className="swap-request-form" onSubmit={async (event) => { event.preventDefault(); setSending(true); const saved = await api("/api/swaps", "POST", { shiftId: shift.id, recipientId: coveringStaffId }); setSending(false); if (!saved) return; setMode(null); setCoveringStaffId(""); }}><p className="muted">Ask a specific coworker to take this shift. You will not receive one of their shifts.</p><label>Ask coworker<select value={coveringStaffId} onChange={(event) => setCoveringStaffId(event.target.value)} required><option value="">Choose a coworker…</option>{coverStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><div><button type="submit" disabled={sending || !coveringStaffId}>Send coverage request</button><button type="button" className="secondary" onClick={() => setMode(null)}>Cancel</button></div></form>;
  return <form className="swap-request-form" onSubmit={async (event) => { event.preventDefault(); const selected = options.find((option) => option.value === requestedAssignment); if (!selected) return; setSending(true); const saved = await api("/api/swaps", "POST", { shiftId: shift.id, recipientShiftId: selected.shiftId, recipientId: selected.staffId }); setSending(false); if (!saved) return; setMode(null); setRequestedAssignment(""); }}><p className="muted">Offer this shift in exchange for a specific coworker&apos;s shift.</p><label>Shift you want<select value={requestedAssignment} onChange={(event) => setRequestedAssignment(event.target.value)} required><option value="">Choose a coworker&apos;s shift…</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{!options.length && <p className="muted">There are no eligible coworker shifts in this pay period.</p>}<div><button type="submit" disabled={sending || !requestedAssignment}>Send exchange request</button><button type="button" className="secondary" onClick={() => setMode(null)}>Cancel</button></div></form>;
}
function DueDateForm({ payPeriod, api }: { payPeriod: PayPeriod; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) { const [editing, setEditing] = useState(false); const [dueDate, setDueDate] = useState(payPeriod.dueDate); useEffect(() => setDueDate(payPeriod.dueDate), [payPeriod.dueDate]); if (!editing) return <button className="secondary small-button" onClick={() => setEditing(true)}>Change deadline</button>; return <form className="due-date-form" onSubmit={(event) => { event.preventDefault(); api("/api/pay-period", "PATCH", { dueDate, periodStart: payPeriod.start }); setEditing(false); }}><label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></label><button type="submit" className="small-button">Save</button><button type="button" className="secondary small-button" onClick={() => { setDueDate(payPeriod.dueDate); setEditing(false); }}>Cancel</button></form> }
function Schedule({ data, api, periodOffset, setPeriodOffset }: { data: Snapshot; api: (path: string, method: string, body?: unknown) => Promise<boolean>; periodOffset: number; setPeriodOffset: (offset: number) => void }) {
  const byDate = Object.groupBy(data.shifts, (shift) => shift.date);
  const dates = Array.from({ length: 14 }, (_, index) => { const date = new Date(`${data.payPeriod.start}T12:00:00`); date.setDate(date.getDate() + index); return date.toISOString().slice(0, 10); });
  const weekStarts = [dates[0], dates[7]]; const excludedAquaticsWeeks = new Set(data.aquaticsExcludedWeeks ?? []);
  const manager = data.viewer.role === "manager";
  return <>
    <section className="card schedule-head"><div><p className="eyebrow">{manager ? "Manager schedule builder" : "Team calendar"}</p><h2>{periodOffset < 0 ? "Previous" : periodOffset > 0 ? "Future" : "Current"} pay-period schedule</h2><p className="muted">{readableDate(data.payPeriod.start)} through {readableDate(data.payPeriod.end)} · Sunday–Saturday, two-week period.</p>{manager && <p className="builder-tip">Standard coverage shifts are ready in each day below. Assign staff or add non-standard shifts for the selected pay period.</p>}<div className="schedule-controls"><button className="secondary" onClick={() => setPeriodOffset(periodOffset - 1)} disabled={periodOffset <= -26}>Previous pay period</button><button className="secondary" onClick={() => setPeriodOffset(0)} disabled={periodOffset === 0}>Current pay period</button><button className="secondary" onClick={() => setPeriodOffset(periodOffset + 1)} disabled={periodOffset >= 26}>Next pay period</button>{manager && <button onClick={() => printTarget("roster")}>Print roster</button>}</div>{manager && <AquaticsWeekControls weekStarts={weekStarts} excludedWeeks={excludedAquaticsWeeks} api={api} />}</div>{manager && <ShiftForm staff={data.staff} payPeriod={data.payPeriod} onSubmit={(body) => api("/api/shifts", "POST", body)} />}</section>
    <section className="schedule-grid">{dates.map((date, index) => {
      const dayShifts = byDate[date] ?? [];
      const weekday = new Date(`${date}T12:00:00`).getDay();
      const weekStart = weekStarts[index < 7 ? 0 : 1];
      const templatesForDay = (data.templates ?? []).filter((template) => template.dayOfWeek === weekday && !(template.title.toLowerCase() === "aquatics class" && excludedAquaticsWeeks.has(weekStart)));
      return <article className="day card" key={date}><h3>{readableDate(date)}</h3>{dayShifts.filter((shift) => !manager || !shift.templateId).map((shift) => <ShiftCard api={api} manager={manager} data={data} key={shift.id} shift={shift} />)}{manager && templatesForDay.map((template) => { const matchingShift = dayShifts.find((shift) => shift.templateId === template.id || (shift.title === template.title && shift.startsAt === template.startsAt && shift.endsAt === template.endsAt)); return <StandardShiftSlots key={template.id} template={template} date={date} staff={data.staff} api={api} shift={matchingShift} />; })}</article>;
    })}</section>{manager && <PrintRoster staff={data.staff} shifts={data.shifts} dates={dates} payPeriod={data.payPeriod} />}</>
}

function AquaticsWeekControls({ weekStarts, excludedWeeks, api }: { weekStarts: string[]; excludedWeeks: Set<string>; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  return <section className="aquatics-week-controls"><strong>Aquatics class weeks</strong>{weekStarts.map((weekStart) => { const disabled = excludedWeeks.has(weekStart); const weekEnd = new Date(`${weekStart}T12:00:00`); weekEnd.setDate(weekEnd.getDate() + 6); return <div key={weekStart}><span>{readableDate(weekStart)}–{readableDate(weekEnd.toISOString().slice(0, 10))}</span><button type="button" className={disabled ? "secondary small-button" : "danger small-button"} onClick={() => { if (!disabled && !window.confirm(`Remove all Aquatics class shifts and assignments for the week of ${readableDate(weekStart)}?`)) return; api("/api/shifts", "POST", { action: "setAquaticsClassWeek", weekStart, enabled: disabled }); }}>{disabled ? "Restore this week" : "Remove this week"}</button></div>; })}</section>;
}

function ShiftCard({ shift, manager, data, api }: { shift: Shift; manager: boolean; data: Snapshot; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const assignedToViewer = Boolean(shift.assignedStaff?.some((person) => person.id === data.viewer.id));
  const pendingRequest = data.swaps.find((swap) => swap.status === "pending" && swap.requesterId === data.viewer.id && (swap.shiftId === shift.id || swap.additionalShiftId === shift.id));
  return <div className={shift.status === "open" ? "shift open" : "shift"}><strong>{shift.title}</strong><span>{shift.startsAt}–{shift.endsAt} · {duration(shift.startsAt, shift.endsAt)} hrs</span><b>{shift.assignedCount} of {shift.requiredStaff} assigned{manager ? "" : ` · ${shift.assignee}`}</b>{manager && <NonStandardAssignments shift={shift} staff={data.staff} api={api} />}{manager && <div className="shift-manager-actions"><ShiftTimeEditor shift={shift} api={api} /><button type="button" className="danger delete-shift" onClick={() => { if (window.confirm(`Delete ${shift.title} on ${readableDate(shift.date)}? This will also remove its assignments.`)) api("/api/shifts", "DELETE", { shiftId: shift.id }); }}>Delete shift</button></div>}{!manager && assignedToViewer && (pendingRequest ? <p className="pending-swap">Awaiting acceptance from <strong>{pendingRequest.recipient}</strong>.</p> : <SwapRequestForm shift={shift} data={data} api={api} />)}{!manager && !assignedToViewer && shift.status === "open" && <button className="secondary" onClick={() => api(`/api/open-shifts/${shift.id}/claim`, "POST")}>Claim shift</button>}</div>;
}

function NonStandardAssignments({ shift, staff, api }: { shift: Shift; staff: Staff[]; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) { return <div className="nonstandard-assignments">{Array.from({ length: shift.requiredStaff }, (_, position) => { const assigned = shift.assignedStaff?.[position]; return assigned ? <div className="assignment-filled" key={assigned.id}><strong>Position {position + 1}</strong><button type="button" className="danger assignment-remove" onClick={() => { if (window.confirm(`Remove ${assigned.name} from ${shift.title}?`)) api("/api/shifts", "POST", { action: "unassignFromShift", shiftId: shift.id, staffId: assigned.id }); }}>Remove</button><span>{assigned.name}</span></div> : <AssignmentPicker key={`empty-${position}`} position={position} shift={shift} staff={staff} api={api} />; })}</div>; }
function AssignmentPicker({ position, shift, staff, api }: { position: number; shift: Shift; staff: Staff[]; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) { const [staffId, setStaffId] = useState(""); const [saving, setSaving] = useState(false); const available = sortedStaff(staff.filter((person) => !shift.assignedStaff?.some((assigned) => assigned.id === person.id))); return <div className="assignment-row"><label className="assignment-control"><span>Position {position + 1}</span><select aria-label={`Assign ${shift.title} position ${position + 1}`} value={staffId} onChange={(event) => setStaffId(event.target.value)} disabled={saving}><option value="">Assign a staff member…</option>{available.map((person) => <option key={person.id} value={person.id}>{person.name}{person.role === "manager" ? " (Manager)" : ""}</option>)}</select></label><button type="button" disabled={!staffId || saving} onClick={async () => { setSaving(true); await api("/api/shifts", "POST", { action: "assignToShift", shiftId: shift.id, staffId }); setStaffId(""); setSaving(false); }}>Assign</button></div>; }

function AssignmentRemovalActions({ shift, person, saving, setSaving, api }: { shift: Shift; person: AssignedStaff; saving: boolean; setSaving: (saving: boolean) => void; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [showRecurringOptions, setShowRecurringOptions] = useState(false);

  async function remove(stopRecurring: boolean) {
    setShowRecurringOptions(false);
    setSaving(true);
    await api("/api/shifts", "POST", { action: "unassignFromShift", shiftId: shift.id, staffId: person.id, stopRecurring });
    setSaving(false);
  }

  function requestRemoval() {
    if (person.isRecurring) {
      setShowRecurringOptions(true);
      return;
    }
    if (window.confirm(`Remove ${person.name} from ${shift.title}?`)) void remove(false);
  }

  return <>
    <button type="button" className="danger assignment-remove" disabled={saving} onClick={requestRemoval}>Remove</button>
    {showRecurringOptions && <div className="recurring-remove-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowRecurringOptions(false); }}>
      <section className="recurring-remove-dialog" role="dialog" aria-modal="true" aria-labelledby={`remove-recurring-${shift.id}-${person.id}`}>
        <div><p className="eyebrow">Recurring assignment</p><h3 id={`remove-recurring-${shift.id}-${person.id}`}>Remove {person.name}?</h3></div>
        <p>This employee is assigned to this shift every week. Choose whether to remove only this occurrence or end the recurring assignment from this date forward.</p>
        <div className="recurring-remove-dialog-actions">
          <button type="button" className="secondary" disabled={saving} onClick={() => void remove(false)}>This shift only</button>
          <button type="button" className="danger" disabled={saving} onClick={() => void remove(true)}>This + future recurring shifts</button>
          <button type="button" className="secondary" disabled={saving} onClick={() => setShowRecurringOptions(false)}>Cancel</button>
        </div>
      </section>
    </div>}
  </>;
}

function StandardShiftSlots({ template, date, staff, api, shift }: { template: ShiftTemplate; date: string; staff: Staff[]; api: (path: string, method: string, body?: unknown) => Promise<boolean>; shift?: Shift }) {
  const positionCount = shift?.requiredStaff ?? template.requiredStaff; const aquaticsClass = template.title.trim().toLowerCase() === "aquatics class";
  const assignedCount = shift?.assignedCount ?? 0;
  const [selections, setSelections] = useState<string[]>([]); const [recurring, setRecurring] = useState<boolean[]>([]); const [saving, setSaving] = useState(false);
  const assignedNames = shift?.assignedStaff?.map((person) => person.name) ?? (shift?.assignee === "Open" || !shift ? [] : shift.assignee.split(", "));
  useEffect(() => { setSelections(Array(positionCount).fill("")); setRecurring(Array(positionCount).fill(false)); setSaving(false); }, [shift?.id, shift?.assignedCount, positionCount]);
  function setSelection(position: number, value: string) { setSelections((current) => Array.from({ length: positionCount }, (_, index) => index === position ? value : current[index] ?? "")); }
  function setRepeating(position: number, value: boolean) { setRecurring((current) => Array.from({ length: positionCount }, (_, index) => index === position ? value : current[index] ?? false)); }
  async function assign(position: number) { const staffId = selections[position]; if (!staffId || saving) return; const repeat = position < template.requiredStaff && Boolean(recurring[position]); setSaving(true); await api("/api/shifts", "POST", shift ? { action: "assignToShift", shiftId: shift.id, staffId, recurring: repeat } : { action: "assignTemplate", templateId: template.id, date, staffId, recurring: repeat }); setSelection(position, ""); setRepeating(position, false); setSaving(false); }
  async function setCapacity(requiredStaff: number) { setSaving(true); await api("/api/shifts", "POST", { action: "setAquaticsClassCapacity", templateId: template.id, date, requiredStaff }); setSaving(false); }
  return <section className="shift-slots"><div className="shift-slots-heading"><strong>{template.title}</strong><span>{template.startsAt}–{template.endsAt} · {duration(template.startsAt, template.endsAt)} hrs · {assignedCount} of {positionCount} assigned</span></div>{aquaticsClass && <label className="aquatics-capacity-control"><span>Guards required for this class</span><select aria-label={`Guards required for Aquatics class on ${date}`} value={positionCount} disabled={saving} onChange={(event) => setCapacity(Number(event.target.value))}>{[2, 3, 4, 5].map((count) => <option key={count} value={count} disabled={count < assignedCount}>{count} guards</option>)}</select>{assignedCount > 2 && <small>Remove assigned guards before choosing fewer than {assignedCount} positions.</small>}</label>}{Array.from({ length: positionCount }, (_, position) => { const assignedPerson = shift?.assignedStaff?.[position]; const assignedName = assignedPerson?.name ?? assignedNames[position]; return <div className="assignment-row" key={position}>{assignedName ? <div className="assignment-filled"><strong>Position {position + 1}{assignedPerson?.isRecurring ? " · Weekly recurring" : ""}</strong>{shift && assignedPerson && <AssignmentRemovalActions shift={shift} person={assignedPerson} saving={saving} setSaving={setSaving} api={api} />}<span>{assignedName}</span></div> : <><div className="assignment-control"><label><span>Position {position + 1}</span><select aria-label={`Assign ${template.title} position ${position + 1}`} value={selections[position] ?? ""} onChange={(event) => setSelection(position, event.target.value)} disabled={saving}><option value="">Assign a staff member…</option>{sortedStaff(staff).map((person) => <option key={person.id} value={person.id}>{person.name}{person.role === "manager" ? " (Manager)" : ""}</option>)}</select></label>{position < template.requiredStaff && <label className="recurring-choice"><input type="checkbox" checked={recurring[position] ?? false} onChange={(event) => setRepeating(position, event.target.checked)} /> Repeat this assignment every week</label>}</div><button type="button" onClick={() => assign(position)} disabled={saving || !selections[position]}>Assign</button></>}</div>; })}{shift && <ShiftTimeEditor shift={shift} api={api} />}</section>;
}

function ShiftTimeEditor({ shift, api }: { shift: Shift; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false); const [startsAt, setStartsAt] = useState(shift.startsAt); const [endsAt, setEndsAt] = useState(shift.endsAt);
  useEffect(() => { setStartsAt(shift.startsAt); setEndsAt(shift.endsAt); }, [shift.startsAt, shift.endsAt]);
  return <div className="shift-time-controls"><div className="employee-time-list">{shift.assignedStaff?.map((person) => <AssignmentTimeEditor key={person.id} shift={shift} person={person} api={api} />)}</div>{editing ? <form className="time-editor" onSubmit={(event) => { event.preventDefault(); api("/api/shifts", "PATCH", { shiftId: shift.id, startsAt, endsAt }); setEditing(false); }}><label>Shift start<input aria-label="Shift start time" type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>Shift end<input aria-label="Shift end time" type="time" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label><button type="submit">Save entire shift time</button><button type="button" className="secondary" onClick={() => { setStartsAt(shift.startsAt); setEndsAt(shift.endsAt); setEditing(false); }}>Cancel</button></form> : <button className="secondary text-button" onClick={() => setEditing(true)}>Edit time for entire shift</button>}</div>;
}

function AssignmentTimeEditor({ shift, person, api }: { shift: Shift; person: AssignedStaff; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false); const [startsAt, setStartsAt] = useState(person.scheduledStartsAt ?? shift.startsAt); const [endsAt, setEndsAt] = useState(person.scheduledEndsAt ?? shift.endsAt); const [recurring, setRecurring] = useState(Boolean(person.isRecurring));
  useEffect(() => { setStartsAt(person.scheduledStartsAt ?? shift.startsAt); setEndsAt(person.scheduledEndsAt ?? shift.endsAt); setRecurring(Boolean(person.isRecurring)); }, [person.scheduledStartsAt, person.scheduledEndsAt, person.isRecurring, shift.startsAt, shift.endsAt]);
  if (!editing) return <div className="employee-time-row"><span><strong>{person.name}</strong> · {person.scheduledStartsAt ?? shift.startsAt}–{person.scheduledEndsAt ?? shift.endsAt}{person.isRecurring ? " · weekly" : ""}</span><button type="button" className="secondary small-button" onClick={() => setEditing(true)}>Edit employee time</button></div>;
  return <form className="employee-time-form" onSubmit={async (event) => { event.preventDefault(); await api("/api/shifts", "POST", { action: "updateAssignmentTime", shiftId: shift.id, staffId: person.id, startsAt, endsAt, recurring }); setEditing(false); }}><strong>{person.name}</strong><QuarterHourSelect label="Start" value={startsAt} onChange={setStartsAt} /><QuarterHourSelect label="End" value={endsAt} onChange={setEndsAt} />{shift.templateId && <label className="recurring-choice"><input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /> Use this employee time every week</label>}<div><button type="submit" className="small-button">Save employee time</button><button type="button" className="secondary small-button" onClick={() => setEditing(false)}>Cancel</button></div></form>;
}
function PrintRoster({ staff, shifts, dates, payPeriod }: { staff: Staff[]; shifts: Shift[]; dates: string[]; payPeriod: PayPeriod }) {
  const scheduledStaff = staff.filter((person) => shifts.some((shift) => shift.assignedStaff?.some((assigned) => assigned.id === person.id)));
  const rosterStaff = sortedStaff(scheduledStaff);
  return <section className="card print-roster">
    <p className="eyebrow">Manager print roster</p>
    <h2>{readableDate(payPeriod.start)} – {readableDate(payPeriod.end)}</h2>
    <div className="print-roster-table-wrap">
      <table>
        <thead><tr><th>Last name</th><th>First name</th>{dates.map((date) => { const label = rosterDate(date); return <th key={date}><span>{label.date}</span><small>{label.weekday}</small></th>; })}</tr></thead>
        <tbody>{rosterStaff.map((person) => { const personName = staffSortName(person); return <tr key={person.id}><th>{personName.lastName}</th><th>{personName.firstName}</th>{dates.map((date) => { const assignments = shifts.filter((shift) => shift.date === date && shift.assignedStaff?.some((assigned) => assigned.id === person.id)).map((shift) => { const assigned = shift.assignedStaff?.find((item) => item.id === person.id); return { ...shift, startsAt: assigned?.scheduledStartsAt ?? shift.startsAt, endsAt: assigned?.scheduledEndsAt ?? shift.endsAt }; }); const displayShifts = mergeOverlappingShiftTimes(assignments); return <td key={date}>{displayShifts.map((shift) => <div key={shift.id}>{compactRosterTime(shift.startsAt)}-{compactRosterTime(shift.endsAt)}</div>)}</td>; })}</tr>; })}</tbody>
      </table>
    </div>
  </section>;
}
function ShiftForm({ staff, payPeriod, onSubmit }: { staff: Staff[]; payPeriod: PayPeriod; onSubmit: (body: Record<string, string | number>) => void }) { const [open, setOpen] = useState(false); const [form, setForm] = useState({ date: payPeriod.start, title: "", startsAt: "05:45", endsAt: "10:45", requiredStaff: 2, staffId: "" }); useEffect(() => setForm((current) => ({ ...current, date: payPeriod.start })), [payPeriod.start]); if (!open) return <button className="secondary" onClick={() => setOpen(true)}>Add non-standard shift</button>; return <form className="inline-form" onSubmit={(event) => { event.preventDefault(); onSubmit(form); setOpen(false); }}><input aria-label="Shift date" type="date" min={payPeriod.start} max={payPeriod.end} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required/><input placeholder="Shift name" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required/><input type="time" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })}/><input type="time" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })}/><label className="guard-count">Required guards<input type="number" min="1" max="20" value={form.requiredStaff} onChange={(event) => setForm({ ...form, requiredStaff: Number(event.target.value) })} required /></label><select value={form.staffId} onChange={(event) => setForm({ ...form, staffId: event.target.value })}><option value="">Post as open</option>{sortedStaff(staff).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select><button type="submit">Save</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button></form> }

function StaffDirectoryCard({ person, manager, api }: { person: Staff; manager: boolean; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(person.firstName);
  const [lastName, setLastName] = useState(person.lastName);
  useEffect(() => { setFirstName(person.firstName); setLastName(person.lastName); }, [person.firstName, person.lastName]);
  return <div className="person directory-person"><span className="avatar">{person.name.split(" ").map((word) => word[0]).join("")}</span><div><strong>{staffLastNameFirst(person)}</strong><span>{person.role === "manager" ? "Manager" : "Lifeguard"}</span><a href={`mailto:${person.email}`}>{person.email}</a><a href={person.phone ? `tel:${person.phone.replace(/[^+\d]/g, "")}` : undefined} className={person.phone ? "" : "missing-contact"}>{person.phone || "Phone not added yet"}</a></div>{manager && person.role === "staff" && <div className="directory-manager-actions"><button type="button" className="secondary small-button" onClick={() => setEditing((open) => !open)}>{editing ? "Cancel name edit" : "Edit name"}</button><button type="button" className="danger small-button" onClick={() => { if (window.confirm(`Remove ${person.name} from the active employee list? Their scheduling records will be kept.`)) api("/api/staff", "PATCH", { action: "deactivate", staffId: person.id }); }}>Remove</button></div>}{editing && <form className="staff-name-editor" onSubmit={async (event) => { event.preventDefault(); await api("/api/staff", "PATCH", { action: "updateStaffName", staffId: person.id, firstName, lastName }); setEditing(false); }}><label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></label><label>Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} required /></label><button type="submit" className="small-button">Save name</button></form>}</div>;
}

function Directory({ data, api }: { data: Snapshot; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [firstName, setFirstName] = useState(data.viewer.firstName);
  const [lastName, setLastName] = useState(data.viewer.lastName);
  const [phone, setPhone] = useState(data.viewer.phone ?? "");
  useEffect(() => setFirstName(data.viewer.firstName), [data.viewer.firstName]);
  useEffect(() => setLastName(data.viewer.lastName), [data.viewer.lastName]);
  useEffect(() => setPhone(data.viewer.phone ?? ""), [data.viewer.phone]);
  const manager = data.viewer.role === "manager";
  return <section className="directory-layout">
    <article className="card profile-card"><p className="eyebrow">My profile</p><h2>Your staff profile</h2><p className="muted">Your first and last name are shown on schedules and in the Staff list. You can update them and your password whenever you need to.</p>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); api("/api/staff", "PATCH", { action: "updateProfile", firstName, lastName, phone }); }}>
        <label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="First name" aria-label="First name" required /></label>
        <label>Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Last name" aria-label="Last name" required /></label>
        <label>Email<input value={data.viewer.email} readOnly aria-label="Email" /></label>
        <label>Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(555) 555-5555" aria-label="Phone number" required /></label>
        <button type="submit">Save profile</button>
        <AccountSecurityButton />
      </form>
    </article>
    <article className="card"><p className="eyebrow">Employee list</p><h2>Your aquatics team</h2><p className="muted">Contact details are visible only to signed-in aquatics staff. Managers can correct staff first and last names.</p><div className="directory">{sortedStaff(data.staff).map((person) => <StaffDirectoryCard key={person.id} person={person} manager={manager} api={api} />)}</div></article>
  </section>
}
function AvailabilityNoteRow({ item, manager, api }: { item: AvailabilityNote; manager: boolean; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) { return <div className="list-item availability-note"><strong>{item.staff}</strong><span>{item.note}</span><span>{readableDate(item.startsOn)} through {readableDate(item.endsOn)}</span>{manager && <button className="danger small-button" onClick={() => { if (window.confirm(`Delete ${item.staff}'s availability note?`)) api("/api/availability", "DELETE", { availabilityId: item.id }); }}>Delete</button>}</div>; }
function Availability({ data, api }: { data: Snapshot; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) { const [form, setForm] = useState({ startsOn: new Date().toISOString().slice(0, 10), endsOn: new Date().toISOString().slice(0, 10), status: "unavailable", note: "" }); const manager = data.viewer.role === "manager"; return <section className="two-col"><form className="card form-stack" onSubmit={(event) => { event.preventDefault(); api("/api/availability", "POST", form); }}><p className="eyebrow">Staff availability</p><h2>Share your schedule</h2><label>From<input type="date" value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })}/></label><label>Through<input type="date" value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })}/></label><label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="unavailable">Unavailable</option><option value="available">Available</option><option value="preferred">Preferred</option></select></label><label>Note<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Optional details for managers"/></label><button>Save availability</button></form><article className="card"><p className="eyebrow">{manager ? "Team visibility" : "Personal availability"}</p><h2>{manager ? "Persistent availability notes" : "My availability notes"}</h2><p className="muted">These notes remain visible across future pay periods until a manager deletes them.</p>{data.availability.map((item) => <AvailabilityNoteRow key={item.id} item={item} manager={manager} api={api} />)}</article></section> }
function OpenShifts({ shifts, api }: { shifts: Shift[]; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) { return <section className="card"><p className="eyebrow">Open shifts</p><h2>Coverage opportunities</h2>{shifts.length ? shifts.map((shift) => <div className="request" key={shift.id}><div><strong>{shift.title} · {readableDate(shift.date)}</strong><span>{shift.startsAt}–{shift.endsAt} · {duration(shift.startsAt, shift.endsAt)} hrs</span></div><button onClick={() => api(`/api/open-shifts/${shift.id}/claim`, "POST")}>Claim shift</button></div>) : <p className="muted">No open shifts right now.</p>}</section> }
function Swaps({ data, api }: { data: Snapshot; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const manager = data.viewer.role === "manager";
  async function act(id: string, method: string) {
    if (busy) return;
    setBusy(id);
    try { await api(`/api/swaps/${id}${method === "POST" ? "/accept" : ""}`, method); }
    finally { setBusy(null); }
  }
  return <section className="card"><p className="eyebrow">Shift changes</p><h2>{manager ? "Pending and accepted covers / swaps" : "Requests for acceptance"}</h2>
    {data.swaps.length ? data.swaps.map((swap) => {
      const pending = swap.status === "pending";
      const canAccept = pending && swap.recipientId === data.viewer.id;
      const exchange = Boolean(swap.recipientShiftId);
      const fullDay = Boolean(swap.additionalShiftId);
      return <div className="request" key={swap.id}><div>
        <strong>{exchange ? `${swap.requester} ↔ ${swap.recipient}` : `${swap.requester} requests ${fullDay ? "full-day " : ""}coverage from ${swap.recipient}`}</strong>
        <span>{swap.requester}&apos;s shift: {swap.shift}</span>
        {fullDay && <span>Plus: {swap.additionalShift ?? "Midday shift"}</span>}
        {exchange && <span>{swap.recipient}&apos;s shift: {swap.recipientShift ?? "Shift unavailable"}</span>}
        <b>{pending ? `Pending acceptance by ${swap.recipient}` : `Accepted by ${swap.recipient} — schedule and timesheets updated`}</b>
      </div><div>
        {canAccept && <button disabled={Boolean(busy)} onClick={() => act(swap.id,"POST")}>{busy === swap.id ? "Updating…" : `Accept ${exchange ? "swap" : "cover"}`}</button>}
        {manager && !swap.managerDismissed && <button className="secondary" disabled={Boolean(busy)} onClick={() => act(swap.id,"DELETE")}>Delete message</button>}
      </div></div>;
    }) : <p className="muted">{manager ? "No cover or swap messages." : "No requests are awaiting acceptance."}</p>}
    <p className="muted footnote">Acceptance automatically updates the schedule and regular timesheet hours.{manager && " Pending and accepted messages stay here until a manager deletes them. Deleting a message does not undo the shift change or cancel a pending request."}</p>
  </section>;
}
function Hours({ data, scheduledHours, api }: { data: Snapshot; scheduledHours: number; api: (path: string, method: string, body?: unknown) => Promise<boolean> }) { const totals = assignmentHourTotals(data.shifts, true); const workedTeamHours = sumAssignmentHours(totals); const pending = data.viewer.role === "manager" ? (data.hourAdjustments ?? []).filter((request) => request.status === "pending") : []; const manager = data.viewer.role === "manager"; const staffById = new Map(data.staff.map((person) => [person.id, person])); const toDisplayRow = ([staffId, person]: [string, { name: string; hours: number }]) => { const staff = staffById.get(staffId); return [staffId, { ...person, name: staff ? staffLastNameFirst(staff) : fullNameLastNameFirst(person.name) }] as [string, { name: string; hours: number }]; }; const visibleTotals = manager ? Array.from(totals.entries()).map(toDisplayRow).sort((left, right) => { const leftStaff = staffById.get(left[0]); const rightStaff = staffById.get(right[0]); return leftStaff && rightStaff ? staffByLastName(leftStaff, rightStaff) : left[1].name.localeCompare(right[1].name, undefined, { sensitivity: "base" }); }) : [toDisplayRow([data.viewer.id, totals.get(data.viewer.id) ?? { name: data.viewer.name, hours: 0 }])]; return <><section className="card"><p className="eyebrow">{manager ? "Pay period tracking" : "My time"}</p><h2>{manager ? "Worked hours" : "My worked hours"}</h2><p className="muted">{readableDate(data.payPeriod.start)} through {readableDate(data.payPeriod.end)} · approved adjustments are included below and overlapping time is counted once.</p>{manager && <div className="hours-total"><strong>{formatHours(scheduledHours)} hrs</strong><span>scheduled team total this pay period</span></div>}<div className="hours-total"><strong>{formatHours(manager ? workedTeamHours : totals.get(data.viewer.id)?.hours ?? 0)} hrs</strong><span>{manager ? "approved worked team total this pay period" : "my approved hours this pay period"}</span></div>{visibleTotals.map(([staffId, person]) => <div className="hours-row" key={staffId}><span>{person.name}</span><strong>{formatHours(person.hours)} hrs</strong></div>)}</section>{manager && <section className="card hour-approvals"><p className="eyebrow">Manager review</p><h2>Worked-hours requests</h2>{pending.length ? pending.map((request) => <article className="hour-request" key={request.id}><div><strong>{request.staff} · {request.shiftTitle}</strong><span>{readableDate(request.shiftDate)} · scheduled {request.scheduledStartsAt}–{request.scheduledEndsAt}</span><b>Requested {request.requestedStartsAt}–{request.requestedEndsAt}</b>{request.note && <em>{request.note}</em>}</div><div><button onClick={() => api("/api/hour-adjustments", "PATCH", { requestId: request.id, action: "approve" })}>Approve</button><button className="secondary" onClick={() => api("/api/hour-adjustments", "PATCH", { requestId: request.id, action: "decline" })}>Decline</button></div></article>) : <p className="muted">No worked-hours requests are waiting for review.</p>}</section>}</>; }
