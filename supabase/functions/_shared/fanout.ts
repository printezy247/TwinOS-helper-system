/**
 * Fan one master post out to the other platforms (plan §6, Phase 3).
 *
 * The master is the Telegram item. Each target platform gets its own content
 * item with one variant: the caption adapted for that platform
 * (_shared/platforms.ts), the same media, its own approval and its own publish
 * job. One item per platform keeps the item/variant status mirror (migration
 * 0011 §25) honest: a post that went out on Instagram never marks the
 * Facebook variant published. TikTok, YouTube and X children are kits.
 */
import { admin, setting } from "./supabase.ts";
import { createDraft } from "./content.ts";
import { HttpError, notFound } from "./http.ts";
import type { Lang, Platform, PostType } from "./compliance.ts";
import { adaptCaption, FANOUT_DEFAULT, type FanResult, isKitPlatform, validatePlatform, withSignature } from "./platforms.ts";
import { nextCta, nextHook } from "./hooks.ts";
import { renderScriptKit, scriptKit, type KitLang, type KitPlatform } from "./kits.ts";

type Media = { kind: "photo" | "video"; url?: string; asset_id?: string; file_id?: string };

/**
 * A retry backlog at or past this size pages the Desk (the per-minute drain
 * clears one job per call, so a growing queue means failures outpace it).
 */
export const FANOUT_STUCK_THRESHOLD = 5;

/** Pure gate for the stuck-queue watch. */
export function isStuckQueue(queuedRetries: number, threshold = FANOUT_STUCK_THRESHOLD): boolean {
  return queuedRetries >= threshold;
}

export async function fanOut(
  masterId: string,
  opts: { platforms?: string[]; assetId?: string | null; actor: string; enqueueRetry?: boolean },
): Promise<FanResult[]> {
  const db = admin();
  const { data: item } = await db.from("content_items")
    .select("id, post_type, lang, status, pillar, title, scheduled_at, source").eq("id", masterId).maybeSingle();
  if (!item) throw notFound("content item");
  if (item.status === "rejected" || item.status === "failed") {
    throw new HttpError(409, "conflict", `cannot fan out an item in status ${item.status}`);
  }
  if ((item.source as { via?: string } | null)?.via === "fanout") {
    throw new HttpError(409, "conflict", "this is already a fan-out copy; fan out the master");
  }
  const { data: master } = await db.from("content_variants")
    .select("body, media").eq("content_id", masterId).eq("platform", "telegram").limit(1).maybeSingle();
  if (!master) throw notFound("telegram variant");

  let media: Media[] = Array.isArray(master.media) ? master.media as Media[] : [];
  const assetId = opts.assetId ?? media.find((m) => m.asset_id)?.asset_id ?? null;
  let meta: { kind: "photo" | "video"; duration_s?: number | null; bytes?: number | null } | undefined;
  if (assetId) {
    const { data: a } = await db.from("assets").select("kind, duration_s, bytes").eq("id", assetId).maybeSingle();
    if (!a) throw notFound("asset");
    const kind = /video|clip|reel/i.test(String(a.kind)) ? "video" : "photo";
    media = [{ kind, asset_id: assetId }];
    meta = { kind, duration_s: a.duration_s === null ? null : Number(a.duration_s), bytes: a.bytes === null ? null : Number(a.bytes) };
  } else if (media[0] && (media[0].kind === "photo" || media[0].kind === "video")) {
    meta = { kind: media[0].kind };
  }

  const wanted = [...new Set((opts.platforms?.length ? opts.platforms : [...FANOUT_DEFAULT]))]
    .filter((p) => p !== "telegram" && (FANOUT_DEFAULT as readonly string[]).includes(p));
  const { data: existing } = await db.from("content_items").select("source").contains("source", { via: "fanout", parent: masterId });
  const done = new Set((existing ?? []).map((e) => (e.source as { platform?: string }).platform));

  const results: FanResult[] = [];
  const lang = (item.lang === "ms" ? "ms" : "en") as KitLang;
  for (const platform of wanted) {
    if (done.has(platform)) continue;
    try {
      results.push(await fanOutOne(db, masterId, item, master.body as string, media, meta, platform, lang, opts));
    } catch (err) {
      // One platform's failure no longer sinks the rest (Wave 4 item 4):
      // queue a retry unless this IS the retry.
      if (opts.enqueueRetry !== false) {
        await db.from("jobs").insert({
          kind: "fanout_platform",
          payload: { parent: masterId, platform, asset_id: opts.assetId ?? null },
          status: "queued",
          created_by: opts.actor,
        });
      }
      results.push({
        platform: platform as Platform, content_id: "", kit: isKitPlatform(platform), body: "",
        notes: [err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)],
        findings: [], complianceOk: false, retryQueued: opts.enqueueRetry !== false,
      });
    }
  }
  return results;
}

/**
 * The `platform_signatures` setting (Wave 4 item 2) is a JSON map of
 * platform → sign-off, or — when typed into the dashboard as free text —
 * one sign-off for every platform. Malformed or misshapen config must never
 * crash fan-out or paste raw junk under a post: it degrades to silence. A
 * type-confused value (a number, an array) is the crash case the raw
 * `signatures[platform]` had: withSignature calls .trim() on it.
 */
export function parseSignatures(raw: string | null | undefined): Record<string, string> {
  const s = (raw ?? "").trim();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) out[k] = v.trim();
      }
      return out;
    }
    return {}; // valid JSON of the wrong shape (array, number): not a sign-off
  } catch {
    // Not JSON at all. A plain sign-off signs every platform; something that
    // was meant to be config ("{...") must never reach a post as junk.
    return s.startsWith("{") ? {} : { "*": s };
  }
}

/** A platform's sign-off, falling back to the catch-all free-text one. */
export function signatureFor(map: Record<string, string>, platform: string): string | null {
  return map[platform] ?? map["*"] ?? null;
}

async function fanOutOne(
  db: ReturnType<typeof admin>,
  masterId: string,
  item: { post_type: string; lang: string; pillar: string | null; title: string | null; scheduled_at: string | null },
  masterBody: string,
  media: Media[],
  meta: { kind: "photo" | "video"; duration_s?: number | null; bytes?: number | null } | undefined,
  platform: string,
  lang: KitLang,
  opts: { assetId?: string | null; actor: string },
): Promise<FanResult> {
    const adapted = adaptCaption(masterBody as string, platform as Platform);
    // The saved per-platform sign-off rides below every adapted caption
    // (platform_signatures setting; research 2026-10-02: kit hygiene). The
    // setting is free text in the dashboard: a malformed value must degrade
    // to "no signatures", not sink every fan-out.
    const signatures = parseSignatures(await setting("platform_signatures"));
    const signed = withSignature(adapted.body, signatureFor(signatures, platform));
    if (signed.added) adapted.body = signed.body;
    const findings = validatePlatform({ platform: platform as Platform, body: adapted.body, media: meta });
    const kit = isKitPlatform(platform);
    // TikTok / YouTube kits ship a shooting script: hook + beats + the risk
    // line spoken, from the no-AI libraries (Wave 3 item 7).
    let scriptKitText: string | null = null;
    if (platform === "tiktok" || platform === "youtube") {
      const hook = await nextHook(db, { pillar: item.pillar as string | null, lang });
      const cta = await nextCta(db, { platform, lang });
      scriptKitText = renderScriptKit(scriptKit({
        platform: platform as KitPlatform,
        lang,
        hook: hook?.text ?? String(item.title ?? item.post_type),
        topic: String(item.title ?? item.post_type),
        cta: cta?.text ?? "",
      }));
    }
    const draft = await createDraft({
      post_type: item.post_type as PostType,
      lang: item.lang as Lang,
      platform: platform as Platform,
      fields: {},
      body_override: adapted.body,
      media,
      pillar: item.pillar as string | null,
      title: item.title as string | null,
      scheduled_at: item.scheduled_at as string | null,
      source: {
        via: "fanout", parent: masterId, platform, kit, notes: adapted.notes,
        platform_findings: findings, ...(scriptKitText ? { script_kit: scriptKitText } : {}),
      },
      actor: opts.actor,
    });
    if (kit) {
      await db.from("content_items").update({ desk_state: "kit", desk_state_at: new Date().toISOString() }).eq("id", draft.content_id);
    }
    return {
      platform: platform as Platform, content_id: draft.content_id, kit, body: adapted.body,
      notes: adapted.notes, findings, complianceOk: draft.compliance.ok, script_kit: scriptKitText,
    };
}
