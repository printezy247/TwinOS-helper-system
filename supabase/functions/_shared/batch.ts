/**
 * The Wednesday batch (plan §9.C.18): next week's channel posts drafted in one go.
 *
 *   7 lessons (5 skill + 2 Start Safe), the Channel Audit, the Monday poll and
 *   the Saturday offer, numbered in posting order so Jack can answer "3: shorter".
 *
 * Pure planning only. The times come from calendar_slots (the seeded channel
 * rhythm), nothing here invents one: a post type with no slot is left out.
 * Writing the drafts and talking to the Desk is content/index.ts's job.
 */

export type BatchType = "lesson" | "poll" | "channel_audit" | "offer";

export interface BatchSlot {
  /** 1 = Monday .. 7 = Sunday; null = every day. */
  dow: number | null;
  /** Wall-clock time in the channel's timezone, "HH:MM" or "HH:MM:SS". */
  time_local: string | null;
  post_type: string | null;
}

export interface BatchItem {
  n: number;
  post_type: BatchType;
  pillar: "skill" | "start_safe" | null;
  label: string;
  title: string | null;
  /** UTC instant the post should go out. */
  when: string;
  dow: number;
}

export interface PlanOptions {
  monday: string;
  slots: BatchSlot[];
  tz: string;
  /** Titles for the first skill lesson and the first Start Safe lesson. */
  topics?: { lesson?: string | null; start_safe?: string | null };
  /** Keep only these post types. Numbers stay as in the full plan. */
  only?: string[];
  /** The week already has an offer post: at most one a week (settings.offer_posts_per_week_max). */
  offerAlready?: boolean;
}

/** Weekend lessons are the two Start Safe ones (Saturday and Sunday). */
export const START_SAFE_DOWS: readonly number[] = [6, 7];

// Same-minute order: poll, offer, audit, then the lesson.
const TYPE_ORDER: Record<BatchType, number> = { poll: 0, offer: 1, channel_audit: 2, lesson: 3 };
const SINGLE_TYPES: BatchType[] = ["poll", "channel_audit", "offer"];

function parseIso(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 1 = Monday .. 7 = Sunday for an ISO date. */
function dowOf(iso: string): number {
  const [y, m, d] = parseIso(iso);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** The Monday strictly after today, by the calendar in `tz`. */
export function nextMonday(now: Date, tz: string): string {
  const today = now.toLocaleDateString("en-CA", { timeZone: tz });
  return addDays(today, 8 - dowOf(today));
}

/** How far the wall clock in `tz` is ahead of UTC at this instant, in ms. */
function offsetMs(tz: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at;
}

/** The UTC instant of `time` on the `dow` day of the week starting `monday`, read in `tz`. */
export function slotToInstant(monday: string, dow: number, time: string, tz: string): string {
  const [y, m, d] = parseIso(addDays(monday, dow - 1));
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let at = wall - offsetMs(tz, wall);
  at = wall - offsetMs(tz, at); // second pass settles a daylight-saving edge
  return new Date(at).toISOString();
}

export function planBatch(opts: PlanOptions): BatchItem[] {
  const { monday, slots, tz } = opts;
  type Raw = Omit<BatchItem, "n" | "label" | "title">;
  const raw: Raw[] = [];

  const lessonSlots = slots.filter((s) => s.post_type === "lesson" && s.time_local);
  for (let dow = 1; dow <= 7; dow++) {
    const slot = lessonSlots.find((s) => s.dow === dow) ?? lessonSlots.find((s) => s.dow === null);
    if (!slot) continue;
    raw.push({
      post_type: "lesson",
      pillar: START_SAFE_DOWS.includes(dow) ? "start_safe" : "skill",
      when: slotToInstant(monday, dow, slot.time_local!, tz),
      dow,
    });
  }
  for (const type of SINGLE_TYPES) {
    if (type === "offer" && opts.offerAlready) continue;
    const slot = slots.find((s) => s.post_type === type && s.dow !== null && s.time_local);
    if (!slot) continue;
    raw.push({ post_type: type, pillar: null, when: slotToInstant(monday, slot.dow!, slot.time_local!, tz), dow: slot.dow! });
  }

  raw.sort((a, b) => a.when.localeCompare(b.when) || TYPE_ORDER[a.post_type] - TYPE_ORDER[b.post_type]);

  let skill = 0;
  let safe = 0;
  const plan: BatchItem[] = raw.map((r, i) => {
    let label: string;
    let title: string | null = null;
    if (r.post_type === "lesson") {
      if (r.pillar === "start_safe") {
        safe += 1;
        label = `Start Safe ${safe}`;
        if (safe === 1) title = opts.topics?.start_safe ?? null;
      } else {
        skill += 1;
        label = `Lesson ${skill}`;
        if (skill === 1) title = opts.topics?.lesson ?? null;
      }
    } else {
      label = { poll: "Poll", channel_audit: "Channel Audit", offer: "Offer" }[r.post_type];
    }
    return { ...r, n: i + 1, label, title };
  });

  return opts.only?.length ? plan.filter((i) => opts.only!.includes(i.post_type)) : plan;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "3. Wed 13:00 · Lesson 3 — title · needs: text", one line per item, HTML-safe for the Desk. */
export function summaryLines(plan: BatchItem[], needed: Map<number, string[]>, tz: string): string[] {
  return plan.map((i) => {
    const at = new Date(i.when);
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(at);
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
    const open = needed.get(i.n) ?? [];
    const state = open.length ? `needs: ${open.map(esc).join(", ")}` : "ready";
    return `${i.n}. ${day} ${hm} · ${esc(i.label)}${i.title ? ` — ${esc(i.title)}` : ""} · ${state}`;
  });
}

/** The Monday of the week an ISO date falls in. */
export function mondayOf(iso: string): string {
  return addDays(iso, 1 - dowOf(iso));
}

/** ISO week number (1-53) of an ISO date. */
function isoWeek(iso: string): number {
  const [y, m, d] = parseIso(iso);
  const thursday = new Date(Date.UTC(y, m - 1, d + (4 - dowOf(iso))));
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
}

/** Which week (1-4) of the 28-day TikTok calendar the week starting `monday` falls on. */
export function cycleWeek(monday: string): number {
  return ((isoWeek(monday) - 1) % 4) + 1;
}

/** "L (Start Safe): 3 scam red flags" -> "3 scam red flags". Calendar topics carry a pillar prefix. */
export function topicTitle(topic: string | null | undefined): string | null {
  if (!topic) return null;
  return topic.replace(/^[A-Z]{1,3}(?: \([^)]*\))?:\s*/, "").trim() || null;
}

export interface ReadyState {
  status: string;
  needed: string[];
  claims: string[];
  blocked: boolean;
}

/**
 * `/batch ok` may approve this item. Claims (a price, a level, a result, an
 * offer) are always Jack's own tap, a [NEEDED] field means not ready, and a
 * blocking finding means it must be edited first. The approve function still
 * runs its own gate on every call; this only decides who is worth asking it about.
 */
export function readyToApprove(s: ReadyState): boolean {
  return isEditable(s.status) &&
    s.needed.length === 0 && s.claims.length === 0 && !s.blocked;
}

/** "N: text" may rewrite a post only while it is a draft or waiting for Jack. */
export function isEditable(status: string): boolean {
  return status === "draft" || status === "pending_approval";
}

/** A batch stays open until each of its posts has gone out or been dropped. */
export function isOpenBatchItem(status: string): boolean {
  return isEditable(status) || status === "approved" || status === "scheduled";
}

export interface SweepItem extends ReadyState {
  id: string;
  n: number;
  when: string;
  hasJob: boolean;
}

export interface SweepResult {
  /** Approved, slot still ahead, but no publish job: queue one. */
  enqueue: string[];
  /** Still waiting on Jack, with the reason in a few words. */
  nudge: Array<{ n: number; why: string }>;
  /** The slot has already gone and nothing was queued. */
  missed: number[];
}

/** The Thursday sweep over the batch: self-heal what is approved, nudge what is not. */
export function sweepPlan(items: SweepItem[], now: Date): SweepResult {
  const out: SweepResult = { enqueue: [], nudge: [], missed: [] };
  for (const i of items) {
    const gone = new Date(i.when).getTime() < now.getTime();
    if (i.status === "approved" || i.status === "scheduled") {
      if (i.hasJob) continue;
      if (gone) out.missed.push(i.n);
      else out.enqueue.push(i.id);
    } else if (i.status === "draft" || i.status === "pending_approval") {
      if (gone) { out.missed.push(i.n); continue; }
      const why = i.needed.length
        ? `needs ${i.needed.join(", ")}`
        : i.blocked
        ? "blocked by a check"
        : i.claims.length
        ? "needs your tap"
        : "ready: /batch ok";
      out.nudge.push({ n: i.n, why });
    }
  }
  return out;
}
