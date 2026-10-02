/**
 * Named invite links (plan §5, §9.H.69).
 *
 * Every link is created through TwinOS so Telechurn and the bot see the same
 * name: `src-campaign-yymm` — lowercase, e.g. `tt-live-2610`,
 * `swap-macronews-2611`, `ig-bio-2610`. The DB enforces the shape with
 * `invite_links_name_convention`; these helpers build it and keep the two in
 * step. Kept out of the function so the convention is testable.
 */

export const LINK_NAME_RE = /^[a-z0-9]+-[a-z0-9]+-[0-9]{4}$/;

export const LINK_SOURCES = [
  "tt", "ig", "fb", "yt", "threads", "x", "swap", "ad", "referral", "bio", "bot",
] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

/** `yymm` for a date: October 2026 → "2610". */
export function yymmOf(now: Date = new Date()): string {
  return `${String(now.getUTCFullYear() % 100).padStart(2, "0")}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Lowercase, spaces to dashes, and drop anything the DB check would refuse. */
export function slug(part: string): string {
  return part.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export function inviteLinkName(source: string, campaign: string, yymm: string): string {
  return `${slug(source)}-${slug(campaign)}-${yymm}`;
}
