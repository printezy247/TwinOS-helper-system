/**
 * Integration status for health (plan §17 Wave 3 item 1).
 *
 * Which providers TwinOS can talk to, and what is missing. Secret NAMES
 * only: values never leave the function (the tests pin that).
 *
 * Each spec also carries the guidance a person needs when a secret is
 * missing: what it is for, where to get it, and the command that sets it.
 * That is what the dashboard's Keyring panel renders, so "why is this
 * broken?" and "where do I go?" are the same screen. The URLs point at the
 * provider's own console, never at TwinOS, and the commands take their
 * values from the keyring rather than from a line Jack types into a shell
 * that saves history.
 */
export interface ProviderSpec {
  provider: string;
  label: string;
  /** One line on what this provider does for the channel. */
  purpose: string;
  /** Function-secret names; empty-string counts as missing. */
  secrets: string[];
  /** Where the secret comes from, in the order it is listed in `secrets`. */
  get_url: string;
  /** The command that stores the value. `{secret}` is the matching secret name. */
  set_command: string;
  /** Whether health/check also runs a live check (Wave 3 item 2). */
  live: boolean;
}

export interface IntegrationState {
  provider: string;
  label: string;
  purpose: string;
  ready: boolean;
  missing: string[];
  get_url: string;
  set_command: string;
  live: boolean;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    provider: "telegram",
    label: "Telegram ops bot",
    purpose: "Reads the EzyMap Desk group and sends drafts, alerts and the daily cards.",
    secrets: ["TWINOS_OPS_BOT_TOKEN"],
    get_url: "https://t.me/BotFather",
    set_command: "supabase secrets set TWINOS_OPS_BOT_TOKEN=\"$(secret-tool lookup service twinos key ops_bot_token)\"",
    live: true,
  },
  {
    provider: "tradingview",
    label: "TradingView alerts",
    purpose: "Accepts alert webhooks and turns them into signal card drafts.",
    secrets: ["TWINOS_TV_SECRET"],
    get_url: "https://www.tradingview.com/chart/#alerts",
    set_command: "supabase secrets set TWINOS_TV_SECRET=\"$(secret-tool lookup service twinos key tv_secret)\"",
    live: true,
  },
  {
    provider: "instagram",
    label: "Instagram",
    purpose: "Publishes the repurposed TikTok cuts and photos to the professional account.",
    secrets: ["TWINOS_META_IG_USER_ID", "TWINOS_META_IG_TOKEN"],
    get_url: "https://developers.facebook.com/tools/explorer/",
    set_command: "supabase secrets set TWINOS_META_IG_TOKEN=\"$(secret-tool lookup service twinos key ig_token)\"",
    live: true,
  },
  {
    provider: "facebook",
    label: "Facebook Page",
    purpose: "Publishes to the Page as part of the one-TikTok-seven-places fan-out.",
    secrets: ["TWINOS_META_PAGE_ID", "TWINOS_META_PAGE_TOKEN"],
    get_url: "https://developers.facebook.com/tools/explorer/",
    set_command: "supabase secrets set TWINOS_META_PAGE_TOKEN=\"$(secret-tool lookup service twinos key page_token)\"",
    live: true,
  },
  {
    provider: "threads",
    label: "Threads",
    purpose: "Publishes the chart screenshot and the two-line takeaway.",
    secrets: ["TWINOS_THREADS_USER_ID", "TWINOS_THREADS_TOKEN"],
    get_url: "https://developers.facebook.com/tools/explorer/",
    set_command: "supabase secrets set TWINOS_THREADS_TOKEN=\"$(secret-tool lookup service twinos key threads_token)\"",
    live: true,
  },
  {
    provider: "youtube",
    label: "YouTube",
    purpose: "Uploads the shorts and, from Q2 2027, the Sunday long-form cut.",
    secrets: ["TWINOS_YT_REFRESH_TOKEN"],
    get_url: "https://console.cloud.google.com/apis/credentials",
    set_command: "supabase secrets set TWINOS_YT_REFRESH_TOKEN=\"$(secret-tool lookup service twinos key yt_refresh_token)\"",
    live: false,
  },
];

export function integrationStatus(env: Record<string, string | undefined>): IntegrationState[] {
  return PROVIDERS.map((p) => {
    const missing = p.secrets.filter((s) => !env[s]);
    return {
      provider: p.provider,
      label: p.label,
      purpose: p.purpose,
      ready: missing.length === 0,
      missing,
      get_url: p.get_url,
      set_command: p.set_command,
      live: p.live,
    };
  });
}
