/**
 * Integration status for health (plan §17 Wave 3 item 1).
 *
 * Which providers TwinOS can talk to, and what is missing. Secret NAMES
 * only: values never leave the function (the tests pin that).
 */
export interface ProviderSpec {
  provider: string;
  label: string;
  /** Function-secret names; empty-string counts as missing. */
  secrets: string[];
  /** Whether health/check also runs a live check (Wave 3 item 2). */
  live: boolean;
}

export interface IntegrationState {
  provider: string;
  ready: boolean;
  missing: string[];
  live: boolean;
}

export const PROVIDERS: ProviderSpec[] = [
  { provider: "telegram", label: "Telegram ops bot", secrets: ["TWINOS_OPS_BOT_TOKEN"], live: true },
  { provider: "tradingview", label: "TradingView alerts", secrets: ["TWINOS_TV_SECRET"], live: false },
  { provider: "instagram", label: "Instagram", secrets: ["TWINOS_META_IG_USER_ID", "TWINOS_META_IG_TOKEN"], live: true },
  { provider: "facebook", label: "Facebook Page", secrets: ["TWINOS_META_PAGE_ID", "TWINOS_META_PAGE_TOKEN"], live: true },
  { provider: "threads", label: "Threads", secrets: ["TWINOS_THREADS_USER_ID", "TWINOS_THREADS_TOKEN"], live: true },
  { provider: "youtube", label: "YouTube", secrets: ["TWINOS_YT_REFRESH_TOKEN"], live: false },
];

export function integrationStatus(env: Record<string, string | undefined>): IntegrationState[] {
  return PROVIDERS.map((p) => {
    const missing = p.secrets.filter((s) => !env[s]);
    return { provider: p.provider, ready: missing.length === 0, missing, live: p.live };
  });
}
