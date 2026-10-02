/**
 * Rows for GET /content/pending — the Telegram Mini App's approval view.
 *
 * The Mini App has no Supabase login (RLS shows it nothing), so the list is
 * built here with the same rules approve and enqueuePublish apply: the shown
 * variant is the one that would publish (the picked AI angle, else the oldest
 * non-angle variant); unpicked angles never block and never allow Approve;
 * kits and items with nothing publishable cannot be approved.
 */
import { isKit, isPublishableVariant } from "./platforms.ts";

type Src = Record<string, unknown> | null | undefined;

export interface PendingItem {
  id: string;
  post_type: string;
  lang: string;
  status: string;
  title: string | null;
  created_at: string;
  scheduled_at: string | null;
  source?: Src;
}

export interface PendingVariant {
  id: string;
  content_id: string;
  platform: string;
  body: string | null;
  created_at: string;
  compliance?: { ok?: boolean; findings?: unknown[] } | null;
  source?: Src;
}

export interface PendingRow {
  id: string;
  post_type: string;
  lang: string;
  status: string;
  title: string | null;
  created_at: string;
  scheduled_at: string | null;
  kit: boolean;
  blocked: boolean;
  can_approve: boolean;
  findings: unknown[];
  variant: { id: string; platform: string; body: string | null } | null;
}

export function pendingRows(items: PendingItem[], variants: PendingVariant[]): PendingRow[] {
  const byItem = new Map<string, PendingVariant[]>();
  for (const v of [...variants].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const list = byItem.get(v.content_id) ?? [];
    list.push(v);
    byItem.set(v.content_id, list);
  }
  return items.map((it) => {
    const all = byItem.get(it.id) ?? [];
    const counted = all.filter((v) => isPublishableVariant(v.source as Src));
    const shown = counted.find((v) => (v.source as Record<string, unknown> | null)?.picked === true) ?? counted[0] ?? null;
    const blocked = counted.some((v) => v.compliance?.ok === false);
    const findings = counted.flatMap((v) => v.compliance?.findings ?? []);
    const kit = isKit(it.source as Src);
    const loaded = counted.length > 0 && counted.every((v) => Array.isArray(v.compliance?.findings));
    return {
      id: it.id,
      post_type: it.post_type,
      lang: it.lang,
      status: it.status,
      title: it.title,
      created_at: it.created_at,
      scheduled_at: it.scheduled_at,
      kit,
      blocked,
      can_approve: !kit && !blocked && loaded && !!shown?.body,
      findings,
      variant: shown ? { id: shown.id, platform: shown.platform, body: shown.body } : null,
    };
  });
}
