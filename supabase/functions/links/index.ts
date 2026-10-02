/**
 * links — named invite links (plan §5, §9.H.69).
 *
 *   POST /links   { source, campaign, yymm?, name?, partner?, cost_usd?,
 *                   creates_join_request?, member_limit?, expires_at?, notes?, chat_id? }
 *     → asks Telegram for an invite link named `source-campaign-yymm` and stores it.
 *   GET  /links?source=&campaign=&active=1   → the links, newest first
 *
 * Who: jack, abdul (plan §11). Every link is created here, never by hand, so
 * Telechurn and the bot see the same names. The same name on the same chat is
 * idempotent: the existing link comes back rather than a duplicate.
 *
 * The channel chat id defaults to settings.channel_chat_id.
 */
import { serve, json, readJson, reqString, oneOf, optString, optNumber, bad, HttpError } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin, requireSetting, SETTING_KEYS } from "_shared/supabase.ts";
import { createChatInviteLink } from "_shared/tg.ts";
import { inviteLinkName, LINK_NAME_RE, LINK_SOURCES, yymmOf } from "_shared/links.ts";
import { logAction } from "_shared/log.ts";

serve(async (req) => {
  const caller = await authenticate(req);
  requireRole(caller.role, "links.create");
  const db = admin();

  if (req.method === "GET") {
    const url = new URL(req.url);
    let q = db.from("invite_links").select("*").order("created_at", { ascending: false }).limit(200);
    const source = url.searchParams.get("source");
    const campaign = url.searchParams.get("campaign");
    if (source) q = q.eq("source", source);
    if (campaign) q = q.eq("campaign", campaign);
    if (url.searchParams.get("active") === "1") q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw new HttpError(503, "upstream_failed", `invite_links: ${error.message}`);
    return json({ links: data ?? [] });
  }
  if (req.method !== "POST") throw bad("POST only");

  const body = await readJson(req);
  const source = oneOf(body, "source", LINK_SOURCES);
  const campaign = reqString(body, "campaign", { max: 40 });
  const yymm = optString(body, "yymm", 4) ?? yymmOf();
  const name = optString(body, "name", 60) ?? inviteLinkName(source, campaign, yymm);
  if (!LINK_NAME_RE.test(name)) {
    throw bad(`name must look like src-campaign-yymm (lowercase), got '${name}'`, { name });
  }
  const chatId = optNumber(body, "chat_id") ?? Number(await requireSetting(SETTING_KEYS.channelId, "TWINOS_CHANNEL_ID"));

  // Same name on the same chat: hand back the link that already exists.
  const { data: existing } = await db.from("invite_links").select("*").eq("chat_id", chatId).eq("name", name).maybeSingle();
  if (existing) return json({ ok: true, link: existing, existing: true });

  const expiresAt = optString(body, "expires_at", 40);
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) throw bad("expires_at must be an ISO timestamp");
  const memberLimit = optNumber(body, "member_limit");
  const joinRequest = body.creates_join_request === true;

  const inv = await createChatInviteLink(chatId, name, {
    creates_join_request: joinRequest,
    member_limit: memberLimit ?? undefined,
    expire_date: expiresAt ? Math.floor(Date.parse(expiresAt) / 1000) : undefined,
  });

  const { data, error } = await db.from("invite_links").insert({
    chat_id: chatId,
    name,
    link: inv.invite_link,
    source,
    campaign,
    partner: optString(body, "partner", 60),
    cost_usd: optNumber(body, "cost_usd"),
    creates_join_request: joinRequest,
    member_limit: memberLimit,
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    notes: optString(body, "notes", 500),
    created_by: caller.actor,
  }).select("*").single();
  if (error || !data) throw new HttpError(503, "upstream_failed", `invite_links: ${error?.message}`);

  await logAction({ actor: caller.actor, action: "links.create", target: data.id, payload: { name, source, campaign } });
  return json({ ok: true, link: data }, 201);
});
