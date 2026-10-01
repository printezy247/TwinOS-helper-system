-- seed.sql — TwinOS Phase 0 seed. Idempotent (upsert on natural keys).
-- Sources: EzyMap Growth Plan 2026-27, EzyMap Channel Posting Kit, Jack's FYP
-- Content Plan (all 30 Sep 2026); printezy catalog.ts and translations.ts;
-- EzyAi formatting/message.py. Prompts and hooks are quoted from the PDFs.
-- "CONFIRM" marks values Jack must confirm (needs_confirm = true).

begin;

-- make the seed itself show up as 'system' in action_log
select set_config('request.jwt.claims', '{"twinos_role":"system_seed","role":"service_role"}', true);

-- ===========================================================================
-- settings
-- ===========================================================================
insert into public.settings (key, value, description, needs_confirm) values
  ('timezone', '"Asia/Kuala_Lumpur"', 'All posting times are MYT (UTC+8).', false),
  ('channel_handle', '"t.me/ezymap"', 'Public channel.', false),
  ('channel_chat_id', 'null', 'Telegram chat id of t.me/ezymap (bigint, negative -100...). CONFIRM: fill from the ops bot once it is admin.', true),
  ('desk_group_chat_id', 'null', 'Private EzyMap Desk group (Jack + ops bot). CONFIRM after the group is created (decision 17).', true),
  ('discussion_group_chat_id', 'null', 'Discussion group for comments, moderated by the ops bot. CONFIRM.', true),
  ('jack_telegram_user_id', 'null', 'Only this id may press Approve (§9.C.14). CONFIRM.', true),
  ('ops_bot_username', '"@EzyOps_bot"', 'Ops bot username, created in @BotFather (§16.4); token goes to Vault / keyring, never here.', true),
  ('sales_bot_username', '"@EzyRegisterBot"', 'The sales bot, the one front door for every sale (decision 15).', false),
  ('support_persona', '"Sarah"', 'Support persona only; checkout retired (Growth Plan §02).', false),
  ('board_url', '"https://printezy.money/ezyai"', 'Public board referenced by the scorecard (Posting Kit POST 7).', false),
  ('posting_times', '{
      "desk_input": "07:45", "desk_draft": "07:50", "desk_ok": "07:58",
      "gold_map": "08:00", "macro_card": "08:15", "lesson": "13:00",
      "signal": "London/NY session, 1-2 per day", "result": "on hit, as a reply under the signal",
      "news_alert": "15-30 min before CPI/NFP/FOMC", "evening_wrap": "20:00",
      "weekly": {"mon": "poll", "wed": "channel audit", "fri": "scorecard image", "sat": "one offer post", "sun": "weekly outlook"},
      "wednesday_batch": {"run": "14:30", "ready_by": "15:30", "schedule_by": "Thursday evening"},
      "map_reminder": "07:40", "evening_reminder": "19:55",
      "tiktok_slots": ["12:30-13:30", "20:00-22:00"],
      "lives": {"ny_session": {"days": ["Mon", "Wed", "Thu"], "from": "20:30", "to": "21:30"}, "sunday_outlook": {"days": ["Sun"], "from": "21:00", "to": "21:45"}, "channel_audit_live": "once a month, replaces one NY live"}
    }', 'Channel rhythm (Growth Plan §07, Posting Kit §01) and TikTok slots (FYP §05).', false),
  ('ib_numbers', '{
      "vantage": [
        {"number": "6709552", "status": "CONFIRM", "note": "found in one repo (§3.3)"},
        {"number": "26468008", "status": "CONFIRM", "note": "found in another repo (§3.3)"}
      ],
      "taurex": {"number": null, "status": "proposal sent, no IB yet"},
      "valetax": {"number": null, "status": "proposal sent, no IB yet"}
    }', 'IB numbers per broker. The two Vantage numbers differ between repos; Jack decides which is live.', true),
  ('trial_days', '3', 'MT5 tool trial length. Repos disagree (7 vs 3); the Posting Kit says 3-day trial. CONFIRM.', true),
  ('link_naming_convention', '{"pattern": "src-campaign-yymm", "regex": "^[a-z0-9]+-[a-z0-9]+-[0-9]{4}$", "examples": ["tt-live-2610", "swap-macronews-2611", "ig-bio-2610"], "rule": "lowercase; links are created only through the ops bot so name, source and campaign are stored at creation; Telechurn sees the same names"}', 'Invite-link naming (§5).', false),
  ('bot_link_tags', '{"pattern": "?start=<tag>", "examples": ["tt_live", "ch_pin"], "rule": "every bot link in a post carries a tag so /stats shows which post sells (§9.E.43)"}', 'Bot deep-link tagging.', false),
  ('signal_expiry_hours', '24', 'Stop-if window: a posted signal with no result reply this long after signal_at is flagged by v_stop_if. CONFIRM the window per style.', true),
  ('edge_base_url', 'null', 'Base URL of the TwinOS Edge Functions, e.g. https://<ref>.supabase.co/functions/v1. Set after the project exists; pg_cron reads it (0010_cron.sql).', true),
  ('cron_secret_name', '"twinos_cron_secret"', 'Name of the Vault secret pg_cron sends as a bearer token. Create it with vault.create_secret().', false),
  ('quarter_targets', '[
      {"quarter": "Q4 2026", "ends_on": "2026-12-31", "members": 2500, "active_funded": 80, "revenue_per_day": 150, "stop_if": "A signal posts without a result update even once"},
      {"quarter": "Q1 2027", "ends_on": "2027-03-31", "members": 5000, "active_funded": 200, "revenue_per_day": 450, "stop_if": "Cost per first-time depositor above $120 for 2 weeks"},
      {"quarter": "Q2 2027", "ends_on": "2027-06-30", "members": 10000, "active_funded": 400, "revenue_per_day": 1000, "stop_if": "Refund or complaint rate above 3%"}
    ]', 'Growth Plan §11 targets; v_quarter_targets reads this.', false),
  ('q4_weekly_goals', '{"net_joins_per_week": 150, "avg_views_pct_of_members": 35, "ib_accounts_per_month_by_dec": 40, "ftd_per_month_by_dec": 10, "active_funded_by_dec": 80, "renewal_rate_min_pct": 50, "results_coverage_pct": 100}', 'Growth Plan §14 Q4 goals per scoreboard number.', false),
  ('offer_posts_per_week_max', '1', 'One offer post per week (§9.E.41).', false),
  ('value_to_offer_ratio_target', '6', 'About 6 value posts per offer post (Growth Plan §07).', false),
  ('char_limit_default', '900', 'Posts stay under 900 characters unless long form (master prompt).', false),
  ('max_emojis_per_post', '5', 'Master prompt: max 5 emojis per post.', false),
  ('milestones', '[1000, 2500, 5000, 10000]', 'Member-count thresholds for milestone posts (§9.E.40).', false),
  ('tiktok_weekly_mix', '{"map_recap": 2, "channel_audit": 1, "lesson_or_start_safe": 2, "tool_demo": 1, "jacks_desk": 1}', 'FYP §02 fixed weekly mix.', false),
  ('tiktok_short_length_s', '{"min": 30, "max": 60}', 'FYP §01.', false),
  ('tiktok_hashtag_rule', '{"min": 3, "max": 5, "pattern": ["one market tag (#xauusd)", "one broad niche tag (#forex or #trading)", "one local tag (#forexmalaysia)", "one topic tag (#riskmanagement)", "at most one trending tag if it fits"]}', 'FYP §05 caption and hashtag pattern.', false),
  ('live_follower_threshold', '1000', 'TikTok LIVE needs about 1,000 followers; until then lives run as Telegram video chats (decision 8).', false),
  ('double_down_window_hours', '48', 'A video well above average gets a part 2 within 48 hours (FYP §04).', false),
  ('platform_daily_limits', '{"instagram": 100, "facebook": 30, "threads": 250}', 'Official API posting limits per 24 h (§9.F).', false),
  ('media_max_mb', '45', 'Storage: media ≤ 45 MB (§7).', false),
  ('snapshot_offsets', '["1h", "24h", "7d"]', 'Post view snapshot schedule (§9.H.66).', false),
  ('language_test', '{"blocks": ["ms_first", "ms_first", "en_first", "en_first"], "block_weeks": 1, "metric": "reactions per view"}', 'Two weeks BM-first, two weeks EN-first (§9.E.42).', false),
  ('language_codes', '{"malay": "ms", "note": "the sales bot and the ops dashboard use my; TwinOS uses ms (§3.3)"}', 'Language code convention.', false),
  ('vantage_rebate_per_active_client_usd', '40', 'Placeholder from Growth Plan §10. CONFIRM from the Vantage portal: last month rebates / clients who traded.', true),
  ('ad_cost_per_ftd_tested_usd', '66', 'Tested figure from the Taurex/Valetax proposals (Growth Plan §01).', false),
  ('repurpose_map', '{
      "instagram": "clean export, no TikTok watermark; shorter caption, 5 hashtags, link in bio",
      "facebook": "same as Instagram (Meta Business Suite cross-post)",
      "youtube": "under 60 s; searchable title like Where your stop goes on gold #shorts",
      "threads": "key chart screenshot, not the video; two-line takeaway plus a question",
      "x": "screenshot for recaps; 3-post thread for Channel Audits; one strong line, no hashtag spam",
      "telegram": "Saturday video of the week and lesson clips, tied to the lesson or scorecard",
      "youtube_long": "Sunday live recording, trimmed; Gold weekly outlook, [date]; from Q2 2027"
    }', 'FYP §08 one TikTok becomes seven posts.', false)
on conflict (key) do update set value = excluded.value, description = excluded.description, needs_confirm = excluded.needs_confirm;

-- ===========================================================================
-- brand_facts (quoted word for word; locked rows are pasted verbatim)
-- ===========================================================================
insert into public.brand_facts (key, lang, body, locked, source, sort_order) values
  ('promise', 'en', 'EzyMap maps gold every day, shows every result, and teaches you to trade the plan, not the hype.', true, 'Growth Plan §04', 1),
  ('pledge_1', 'en', 'Every free signal gets a result update in the replies: TP1, TP2, break-even or stop. Losses stay up.', true, 'Growth Plan §04', 10),
  ('pledge_2', 'en', 'Win rate is counted the strict way your board already uses: break-even trades are left out of the denominator, not counted as half a win.', true, 'Growth Plan §04', 11),
  ('pledge_3', 'en', 'We earn a commission when you trade through our broker link. You can get every free signal without it. Paid tools can be bought without any broker.', true, 'Growth Plan §04', 12),
  ('pledge_4', 'en', 'Education first. Signals are examples of a method, not financial advice, and never a promise of profit.', true, 'Growth Plan §04', 13),
  ('pledge_pinned', 'en', 'Our pledge: every loss stays up, win rate counted strictly, and we tell you openly that we earn a broker commission if you use our link. You never need it for the free content.', true, 'Posting Kit POST 15', 14),
  ('ib_disclosure', 'en', 'Honest note: we earn a commission when you trade through the link. You can keep getting the free map and signals without it.', true, 'Posting Kit POST 9 variant A', 20),
  ('ib_disclosure_short', 'en', 'We earn a commission when people trade through our broker link, and we say so openly.', true, 'Posting Kit master prompt', 21),
  ('strict_win_rate_rule', 'en', 'Win rate is counted strictly: break-even trades are excluded, never counted as half a win.', true, 'Posting Kit master prompt', 30),
  ('strict_win_rate_formula', 'en', 'Strict win rate = W / (W + L). Break-even excluded. Show the working: "67% (4 of 6, BE excluded)".', true, 'Posting Kit POST 7', 31),
  ('hashtag_index', 'en', '#GoldMap #Signal #Result #Lesson #StartSafe #Audit #Macro #Scorecard #Outlook #Tools', true, 'Posting Kit §03', 40),
  ('free_list', 'en', 'Free: daily gold map, 1-2 signals, lessons, weekly scorecard.', true, 'Posting Kit master prompt', 50),
  ('bot_line', 'en', 'Bot for everything else: @EzyRegisterBot. Support persona: Sarah.', true, 'Posting Kit master prompt', 51),
  ('education_line', 'en', 'Education only, not financial advice.', true, 'Posting Kit POST 15 / FYP §05', 60),
  ('risk_line_map', 'en', 'Map only, not advice. Manage your own risk.', true, 'Posting Kit POST 1', 61),
  ('risk_line_signal', 'en', 'Risk 1% or less.', true, 'Posting Kit POST 3', 63),
  ('result_footer', 'en', 'Results get posted as a reply under this message.', true, 'Posting Kit POST 3', 64),
  ('losses_line', 'en', 'Losses stay on the channel.', true, 'Posting Kit POST 4', 65),
  ('scam_warning', 'en', 'Jack never DMs you first and never asks for money in DMs. Only trust @EzyRegisterBot and t.me/ezymap.', true, 'FYP §07', 70),
  ('past_performance', 'en', 'Past performance is not indicative of future results. We do not publish win-rate or pip totals that cannot be independently verified.', true, 'printezy translations.ts track_record_disclaimer', 71),
  ('milestone_line', 'en', 'Same promise as day one: daily map, every result posted, no hype.', true, 'Posting Kit POST 14', 80),
  ('reference_channels_rule', 'en', 'Reference channels are never named in posts, never fed to the AI as examples, and the Channel Audit stays pattern-based.', true, 'UPGRADE-PLAN §4.10', 90)
on conflict (key) do update set lang = excluded.lang, body = excluded.body, locked = excluded.locked, source = excluded.source, sort_order = excluded.sort_order;

-- Malay counterparts of the locked lines (key suffix _ms; lang = ms)
insert into public.brand_facts (key, lang, body, locked, source, sort_order) values
  ('risk_line_map_ms', 'ms', 'Ini mapping, bukan nasihat kewangan.', true, 'Posting Kit POST 1 (BM example)', 62),
  ('losses_line_ms', 'ms', 'Kat EzyMap, semua loss kekal dalam channel.', true, 'Posting Kit POST 5 (BM example)', 66),
  ('past_performance_ms', 'ms', 'Prestasi lepas tidak menunjukkan hasil masa depan. Kami tidak menerbitkan kadar kemenangan atau jumlah pip yang tidak dapat disahkan secara bebas.', true, 'printezy translations.ts track_record_disclaimer (ms)', 72)
on conflict (key) do update set lang = excluded.lang, body = excluded.body, locked = excluded.locked, source = excluded.source, sort_order = excluded.sort_order;

-- ===========================================================================
-- products — three ladders (Growth Plan §06), prices from printezy catalog.ts
-- (USD, mirrors config/packages.json). price_usd NULL = Jack must supply
-- (UPGRADE-PLAN §16.2). billing: monthly | lifetime | one_time.
-- ===========================================================================
insert into public.products (sku, product_group, name, description, ladder, step, billing, price_usd, term_months, min_deposit_usd, bullets, badge, source, sort_order, notes) values
  -- Free ladder
  ('free_channel', 'free', 'Telegram channel', 'Gold map, 1-2 signals, lessons, weekly scorecard.', 'free', 1, 'one_time', 0, null, null, '["Gold map every day at 8am", "1-2 signals with every result posted", "Lessons, weekly scorecard, Sunday outlook"]', null, 'growth_plan', 10, 'Free (everyone), step 1.'),
  ('tier_beginner', 'tier', 'Beginner tier (via broker, no deposit)', 'Free ebook + EzyMap Lite via Beginner tier (account, no deposit).', 'free', 2, 'one_time', 0, null, 0, '["eBook: Technical Analysis & Mapping Like A Pro", "EzyMap Lite indicator (TradingView)", "Free public channel access"]', null, 'growth_plan', 11, 'Open an account under the broker link, no deposit needed. IB disclosure line required on any post that mentions it.'),
  ('free_top_trade_calls', 'free', 'Top Trade Calls (free TradingView script)', 'Free, MIT-licensed Pine confluence suite, 10 timeframes. Lead magnet on TradingView.', 'free', 3, 'one_time', 0, null, null, '["Public on TradingView", "Profile points to the channel"]', null, 'growth_plan', 12, null),
  -- Funded ladder (IB tiers). No price: earned by deposit through the broker link.
  ('tier_pro', 'tier', 'Pro tier (any deposit)', 'M1/M5 channel + strength meter.', 'funded', 1, 'one_time', null, null, 0, '["EzyScalper — M1 & M5 private signals", "MT5 Currency Strength Meter", "Everything in Beginner"]', null, 'growth_plan', 20, 'Any deposit (min_deposit_usd 0 = any). Price NULL on purpose: unlocked by deposit, not bought.'),
  ('tier_premium', 'tier', 'Premium tier ($100+)', 'EzyMap Pro + M15/M30 channel.', 'funded', 2, 'one_time', null, null, 100, '["EzyMap Pro indicator (TradingView) — M1–H4 signals", "MT5 Auto TPSL & MTF Bias", "EzyIntraday — M15 & M30 private signals", "Everything in Pro"]', 'Most popular', 'growth_plan', 21, 'Unlocked by a $100+ deposit.'),
  ('tier_elite', 'tier', 'Elite tier ($700+)', 'Swing channel, full MT5 set, 1-on-1. Elite Circle capped at 20 people (Growth Plan §11).', 'funded', 3, 'one_time', null, null, 700, '["Full MT5 indicator set incl. Drawdown Guardian & Bulk Close", "EzySwing — H1 & H4 private signals", "Ezy Elite Circle — 1-on-1 support", "Everything in Premium"]', null, 'growth_plan', 22, 'Unlocked by a $700+ deposit. Opens to 20 people in Dec 2026.'),
  -- Paid without broker, step 1: MT5 tool from $9/mo or EzyMap Lite $49
  ('mt5_drawdown_guardian_1m', 'mt5', 'Drawdown Guardian (1 Month)', 'Hard-stop protection that keeps prop-firm rules intact.', 'paid', 1, 'monthly', 9.00, 1, null, '["Daily & total drawdown limits", "Auto flatten on breach", "Live risk readout"]', 'Prop firm favorite', 'catalog.ts', 30, null),
  ('mt5_auto_tpsl_1m', 'mt5', 'Auto TPSL (1 Month)', 'Automatic take profit and stop loss on every fill.', 'paid', 1, 'monthly', 9.00, 1, null, '["Rule-based TP/SL", "Break-even & trailing modes", "Manual or EA trades"]', 'Trending', 'catalog.ts', 31, null),
  ('mt5_currency_strength_1m', 'mt5', 'Currency Strength Meter (1 Month)', 'See which currency is leading before you enter.', 'paid', 1, 'monthly', 9.00, 1, null, '["Real-time strength ranking", "Pair-by-pair comparison", "Included in Pro package"]', null, 'catalog.ts', 32, null),
  ('mt5_mtf_bias_1m', 'mt5', 'MTF Bias (1 Month)', 'Multi-timeframe direction bias in a single dashboard.', 'paid', 1, 'monthly', 9.00, 1, null, '["M1 to D1 bias grid", "Confluence scoring", "Alerts on bias flip"]', null, 'catalog.ts', 33, null),
  ('mt5_bulk_close_1m', 'mt5', 'Bulk Close — BONUS Layer Close (1 Month)', 'Close baskets or single layers of positions in one click.', 'paid', 1, 'monthly', 19.00, 1, null, '["One-click basket close", "Layer-by-layer partial close", "Chart hotkey panel"]', 'Top selling', 'catalog.ts', 34, '3-day trial product (Posting Kit offer B).'),
  ('tv_lite', 'tradingview', 'TradingView — EzyMap Lite', 'Entry-level mapping overlay for TradingView charts.', 'paid', 1, 'lifetime', 49.00, null, null, '["Auto support & resistance mapping", "Buy/sell bias arrows", "Lifetime updates"]', null, 'catalog.ts', 35, 'Lifetime SKU kept because already sold (decision 14).'),
  -- Paid step 2: EzyAI PRO $14.99/mo or Macro desk $19/mo
  ('ezyai_pro_1m', 'ezyai', 'EzyAI PRO — 1 Month', 'Live Watch alerts, Autopilot signals and deep Fundamentals in @ezytradeai_bot.', 'paid', 2, 'monthly', 14.99, 1, null, '["Live per-pair Watch alerts", "Autopilot signals", "Deep Fundamentals: scores, fair value, COT"]', null, 'catalog.ts', 40, 'Launch Q1 2027 with a founding price for the first 100 (offer D). Founding price not decided: Jack supplies it.'),
  ('macro_full_desk', 'macro', 'Full Macro Desk', 'All four premium heatmaps plus the macro desk digest.', 'paid', 2, 'monthly', 19.00, 1, null, '["Central bank divergence heatmap", "Recession probability heatmap", "Gold futures roll calendar", "Daily macro digest"]', 'Macro bestseller', 'catalog.ts', 41, null),
  ('macro_addon', 'macro', 'Macro Add-on (single card)', 'One premium card: news sentiment, whale alerts, options flow or Fed watch.', 'paid', 2, 'monthly', 9.00, 1, null, '["Pick any single premium card", "Delivered in the MacroTrader bot", "Cancel any time"]', null, 'catalog.ts', 42, null),
  ('macro_yield_optimizer', 'macro', 'Yield Optimizer', 'Stablecoin and treasury yield routing signals.', 'paid', 2, 'monthly', 12.00, 1, null, '["Best-yield venue tracking", "Risk-adjusted comparison", "Weekly rebalance note"]', null, 'catalog.ts', 43, null),
  -- Paid step 3: MT5 bundle $99/mo or EzyMap Pro $249
  ('mt5_bundle_1m', 'mt5', 'MT5 Indicator Bundle — 1 Month', 'Every MT5 tool in one licence (worth $999).', 'paid', 3, 'monthly', 99.00, 1, null, '["All MT5 indicators", "Priority setup help", "Prop-firm friendly settings"]', null, 'catalog.ts', 50, null),
  ('tv_pro', 'tradingview', 'TradingView — EzyMap Pro', 'The full M1–H4 signal engine used in the Premium package.', 'paid', 3, 'lifetime', 249.00, null, null, '["M1–H4 entry, SL and TP signals", "Multi-timeframe confluence filter", "Lifetime updates"]', 'Most complete', 'catalog.ts', 51, 'Lifetime SKU kept because already sold. Published invite-only on TradingView (Growth Plan §03).'),
  ('tv_pro_1m', 'tradingview', 'TradingView — EzyMap Pro (monthly)', 'Monthly option via invite-only script management.', 'paid', 3, 'monthly', null, 1, null, '["M1–H4 entry, SL and TP signals", "Multi-timeframe confluence filter", "Add/remove users monthly"]', null, 'growth_plan', 52, 'price_usd NULL: Growth Plan §03 proposes $29/mo next to the $249 lifetime; Jack must set it (UPGRADE-PLAN §16.2). Live from Nov 2026.'),
  -- Prepaid terms from catalog.ts (one_time for the stated term)
  ('mt5_bundle_6m', 'mt5', 'MT5 Indicator Bundle — 6 Months', 'Every MT5 tool in one licence (worth $999).', 'paid', 3, 'one_time', 499.00, 6, null, '["All MT5 indicators", "Priority setup help", "Save vs monthly"]', 'Best value', 'catalog.ts', 60, null),
  ('mt5_bundle_1y', 'mt5', 'MT5 Indicator Bundle — 1 Year', 'Every MT5 tool in one licence (worth $999).', 'paid', 3, 'one_time', 999.00, 12, null, '["All MT5 indicators", "Priority setup help", "Full year of updates"]', null, 'catalog.ts', 61, null),
  ('mt5_bulk_close_6m', 'mt5', 'Bulk Close — BONUS Layer Close (6 Months)', 'Close baskets or single layers of positions in one click.', 'paid', 1, 'one_time', 109.00, 6, null, '["One-click basket close", "Layer close function", "Save vs monthly"]', null, 'catalog.ts', 62, null),
  ('mt5_bulk_close_1y', 'mt5', 'Bulk Close — BONUS Layer Close (1 Year)', 'Close baskets or single layers of positions in one click.', 'paid', 1, 'one_time', 199.00, 12, null, '["One-click basket close", "Layer close function", "Full year of updates"]', null, 'catalog.ts', 63, null),
  ('mt5_drawdown_guardian_6m', 'mt5', 'Drawdown Guardian (6 Months)', 'Hard-stop protection that keeps prop-firm rules intact.', 'paid', 1, 'one_time', 49.00, 6, null, '["Daily & total drawdown limits", "Auto flatten on breach", "Save vs monthly"]', null, 'catalog.ts', 64, null),
  ('mt5_drawdown_guardian_1y', 'mt5', 'Drawdown Guardian (1 Year)', 'Hard-stop protection that keeps prop-firm rules intact.', 'paid', 1, 'one_time', 99.00, 12, null, '["Daily & total drawdown limits", "Auto flatten on breach", "Full year of updates"]', null, 'catalog.ts', 65, null),
  ('mt5_auto_tpsl_6m', 'mt5', 'Auto TPSL (6 Months)', 'Automatic take profit and stop loss on every fill.', 'paid', 1, 'one_time', 49.00, 6, null, '["Rule-based TP/SL", "Break-even & trailing modes", "Save vs monthly"]', null, 'catalog.ts', 66, null),
  ('mt5_auto_tpsl_1y', 'mt5', 'Auto TPSL (1 Year)', 'Automatic take profit and stop loss on every fill.', 'paid', 1, 'one_time', 99.00, 12, null, '["Rule-based TP/SL", "Break-even & trailing modes", "Full year of updates"]', null, 'catalog.ts', 67, null),
  ('mt5_currency_strength_6m', 'mt5', 'Currency Strength Meter (6 Months)', 'See which currency is leading before you enter.', 'paid', 1, 'one_time', 49.00, 6, null, '["Real-time strength ranking", "Pair-by-pair comparison", "Save vs monthly"]', null, 'catalog.ts', 68, null),
  ('mt5_currency_strength_1y', 'mt5', 'Currency Strength Meter (1 Year)', 'See which currency is leading before you enter.', 'paid', 1, 'one_time', 99.00, 12, null, '["Real-time strength ranking", "Pair-by-pair comparison", "Full year of updates"]', null, 'catalog.ts', 69, null),
  ('mt5_mtf_bias_6m', 'mt5', 'MTF Bias (6 Months)', 'Multi-timeframe direction bias in a single dashboard.', 'paid', 1, 'one_time', 49.00, 6, null, '["M1 to D1 bias grid", "Confluence scoring", "Save vs monthly"]', null, 'catalog.ts', 70, null),
  ('mt5_mtf_bias_1y', 'mt5', 'MTF Bias (1 Year)', 'Multi-timeframe direction bias in a single dashboard.', 'paid', 1, 'one_time', 99.00, 12, null, '["M1 to D1 bias grid", "Confluence scoring", "Full year of updates"]', null, 'catalog.ts', 71, null),
  ('ezyai_pro_6m', 'ezyai', 'EzyAI PRO — 6 Months', 'Six months of EzyAI PRO — the most popular plan, save 50%.', 'paid', 2, 'one_time', 44.99, 6, null, '["Everything in PRO", "Save 50% vs monthly", "Stacks on top of any active PRO time"]', 'Most popular', 'catalog.ts', 72, null),
  ('ezyai_pro_1y', 'ezyai', 'EzyAI PRO — 12 Months', 'A full year of EzyAI PRO, save 44%.', 'paid', 2, 'one_time', 99.99, 12, null, '["Everything in PRO", "Save 44% vs monthly", "Stacks on top of any active PRO time"]', null, 'catalog.ts', 73, null),
  -- No-broker one-time packs from catalog.ts (shown inside the bot after a lane is picked, Growth Plan §03/§06)
  ('signal_beginner', 'package', 'Beginner Package', 'Foundations, ebooks and the EzyMap Lite TradingView indicator.', null, null, 'one_time', 29.00, null, null, '["eBook: Technical Analysis & Mapping Like A Pro", "EzyMap Lite indicator (TradingView)", "Free public channel access"]', null, 'catalog.ts', 80, 'One-time no-broker price of the Beginner tier pack. Not on the front page.'),
  ('signal_pro', 'package', 'Pro Package', 'EzyScalper M1 & M5 private signal channel plus the MT5 strength meter.', null, null, 'one_time', 49.00, null, null, '["EzyScalper — M1 & M5 private signals", "MT5 Currency Strength Meter", "Everything in Beginner"]', null, 'catalog.ts', 81, 'Sarah shows RM49 for this $49 product to BM users — fix (§3.3).'),
  ('signal_premium', 'package', 'Premium Package', 'EzyMap Pro indicator, Auto TPSL, MTF Bias and the intraday signal channel.', null, null, 'one_time', 99.00, null, null, '["EzyMap Pro indicator (TradingView) — M1–H4 signals", "MT5 Auto TPSL & MTF Bias", "EzyIntraday — M15 & M30 private signals", "Everything in Pro"]', 'Most popular', 'catalog.ts', 82, null),
  ('signal_elite', 'package', 'Elite Package', 'The full MT5 indicator set, swing signals and 1-on-1 support.', null, null, 'one_time', 299.00, null, null, '["Full MT5 indicator set incl. Drawdown Guardian & Bulk Close", "EzySwing — H1 & H4 private signals", "Ezy Elite Circle — 1-on-1 support", "Everything in Premium"]', null, 'catalog.ts', 83, null)
on conflict (sku) do update set
  product_group = excluded.product_group, name = excluded.name, description = excluded.description,
  ladder = excluded.ladder, step = excluded.step, billing = excluded.billing, price_usd = excluded.price_usd,
  term_months = excluded.term_months, min_deposit_usd = excluded.min_deposit_usd, bullets = excluded.bullets,
  badge = excluded.badge, source = excluded.source, sort_order = excluded.sort_order, notes = excluded.notes;

-- ===========================================================================
-- personas — the six ICPs (Growth Plan §05, UPGRADE-PLAN §4.2)
-- ===========================================================================
insert into public.personas (id, key, name, who, wants, offer, entry_point, main_pillar, ladder, pain_points, seed_questions, notes) values
  (1, 'gold_beginner', 'Gold beginner (main)',
   '22 to 35, trades XAUUSD on a phone, small account, has blown one before.',
   'A clear daily plan and someone to follow who doesn''t lie.',
   'Free gold map, free signals, Beginner/Pro tiers, EzyMap Lite.',
   'TikTok, channel', 'map_recap', 'free',
   '["entered too early", "moved my stop", "overtrading", "lot size too big for the account", "blew an account chasing news"]',
   '{"en": ["how to map gold every morning", "where does my stop loss go on gold", "what lot size for a $500 account", "why do I keep getting stopped out"], "ms": ["macam mana nak mapping gold setiap pagi", "SL gold letak kat mana", "lot size untuk akaun RM2,000", "kenapa SL asyik kena"], "manglish": ["gold SL always kena, why ah", "small account can trade gold or not", "which zone to buy today"]}',
   'Main ICP. Offer ladder: Free → Beginner/Pro tiers, EzyMap Lite.'),
  (2, 'signal_refugee', 'Signal-channel refugee',
   'Joined VIP groups, lost money, now cynical about IB channels.',
   'Proof, honesty and a way to learn instead of copy.',
   'Transparency pledge, Channel Audit, scorecard, education.',
   'TikTok audits, referrals', 'channel_audit', 'free',
   '["paid for VIP and lost", "channels delete losing trades", "95% win rate screenshots", "deposit-to-unlock VIP", "admins DM asking for money"]',
   '{"en": ["is a 95% win rate real", "how to check if a signal channel is legit", "why do VIP groups ask to deposit first", "how is win rate calculated"], "ms": ["win rate 95% betul ke", "macam mana nak tahu channel signal scam", "kenapa group VIP suruh deposit dulu", "cara kira win rate"], "manglish": ["this channel legit or not", "VIP group all scam ah", "why they never show loss one"]}',
   'Entry through TikTok Channel Audit videos and referrals.'),
  (3, 'tool_trader', 'Tool-driven trader',
   'Uses TradingView and MT5, may be doing a prop firm challenge.',
   'Automation that saves time and protects the account.',
   'MT5 bundle, Drawdown Guardian, Bulk Close, EzyMap Pro.',
   '3-day trials, website', 'tool_demo', 'paid',
   '["closing layered trades one by one", "breaching prop-firm daily drawdown", "forgetting TP/SL on fills", "too many indicator subscriptions"]',
   '{"en": ["how to close all MT5 positions in one click", "best drawdown protection for prop firm challenge", "MT5 auto take profit stop loss indicator", "EzyMap Pro vs Lite"], "ms": ["cara close semua position MT5 sekali gus", "indicator drawdown untuk prop firm", "auto TP SL MT5"], "manglish": ["got tool to close all layer trades ah", "prop firm challenge keep failing daily DD"]}',
   'Entry: 3-day trials (settings.trial_days) and the website.'),
  (4, 'macro_trader', 'Macro trader',
   'Trades news and fundamentals across gold, FX and indices.',
   'Fast macro context without reading ten sites.',
   'Macro bot free digest, $19 macro desk.',
   'Macro bot, daily card in channel', 'macro_card', 'paid',
   '["too many sources", "missed the Fed speaker", "no idea what CPI does to gold", "no time for ten sites"]',
   '{"en": ["what does CPI do to gold", "how to read NFP for gold", "USD yields and gold in plain words", "fed watch heatmap"], "ms": ["CPI buat apa pada gold", "cara baca NFP untuk gold", "USD yield dan gold"], "manglish": ["CPI tonight gold up or down", "which news move gold the most"]}',
   'Macro desk $19/mo (products.macro_full_desk).'),
  (5, 'crypto_forex_generalist', 'Crypto + forex generalist',
   'Trades both, likes AI tools and dashboards.',
   'Signals with reasoning across many markets.',
   'EzyAI PRO ($14.99/mo), public board.',
   'Website board, Threads/X', null, 'paid',
   '["signals without reasoning", "no public track record", "too many markets to watch"]',
   '{"en": ["AI trading signals with reasoning", "crypto and forex signal bot with public results", "EzyAI board"], "ms": ["bot signal AI crypto forex", "signal dengan sebab"], "manglish": ["AI signal bot got track record one or not"]}',
   'Reached through Threads/X and the website board. EzyAI launch Q1 2027.'),
  (6, 'start_safe_seeker', 'General financial-solution seeker',
   'Salaried worker or student, curious about trading or side income, not trading yet, worried about scams.',
   'A safe way to learn and to spot scams before losing money.',
   'Free ebook, Start Safe lesson series, demo challenge, then Beginner tier.',
   'TikTok, website SEO in BM', 'start_safe', 'free',
   '["afraid of scams", "does not know where to start", "side income pressure", "no idea how much money to start with"]',
   '{"en": ["how to start trading gold safely", "trading scam red flags malaysia", "demo account first or real", "how much money to start trading"], "ms": ["cara mula trading gold dengan selamat", "red flag scam trading", "demo dulu ke terus real", "nak mula trading perlu berapa modal", "broker checklist malaysia"], "manglish": ["trading all scam one or not", "can start with RM500 ah", "demo first how long"]}',
   'Never pushed to deposit early: Start Safe series and a two-week demo challenge first (Growth Plan §05 note).')
on conflict (id) do update set
  key = excluded.key, name = excluded.name, who = excluded.who, wants = excluded.wants, offer = excluded.offer,
  entry_point = excluded.entry_point, main_pillar = excluded.main_pillar, ladder = excluded.ladder,
  pain_points = excluded.pain_points, seed_questions = excluded.seed_questions, notes = excluded.notes;

-- ===========================================================================
-- templates — the 15 post types (Posting Kit §04). prompt_text is the kit's
-- "PROMPT TO COPY" verbatim. Example numbers in the kit are illustrative only.
-- ===========================================================================
insert into public.templates (key, kit_number, name, schedule, prompt_text, fields, examples, required_lines, char_limit, hashtag, approval_rule, requires_approval, notes) values
  ('gold_map', 1, 'Morning gold map', 'Daily 08:00. Three moods: bullish, bearish, range.',
   $t$Write today's EzyMap gold map post.
Date: {DATE}
Bias: {BULLISH / BEARISH / RANGE}
Zones: S1 {S1}, S2 {S2}, R1 {R1}, R2 {R2}
Plan notes from Jack: {3-5 RAW LINES}
Invalidation: {LEVEL AND WHAT IT MEANS}
News today (MYT): {EVENT AND TIME, OR "none"}
Language: {EN / BM}
Use the map pin emoji, keep it under 700 characters, end with the risk line.$t$,
   '["DATE", "BIAS", "S1", "S2", "R1", "R2", "RAW_LINES", "INVALIDATION", "NEWS", "LANGUAGE"]',
   '[{"label": "BULLISH", "lang": "en", "body": "[map pin] *GOLD MAP | Tue 14 Oct*\n\nBias: buyers in control above *4,012 - 4,018* (S1).\n\nPlan\n- Buy reactions inside S1, targets R1 *4,046* then R2 *4,070*\n- Below *4,000* the idea is wrong, I stand aside\n\nNews: US retail sales at 20:30. Expect a spike, don''t chase it.\n\nMap only, not advice. Manage your own risk."}, {"label": "RANGE (BM)", "lang": "ms", "body": "[map pin] *GOLD MAP | Rabu 15 Okt*\n\nHari ni gold tengah sideways antara *4,020* dan *4,055*.\n\nPlan aku\n- Tepi bawah: tengok reaction untuk buy\n- Tepi atas: tengok reaction untuk sell\n- Tengah-tengah? Tak payah kacau\n\nNota: FOMC minutes malam ni. Kurangkan lot.\n\nIni mapping, bukan nasihat kewangan."}]',
   '{risk}', 700, '#GoldMap', 'Jack sends the screenshot and 3-5 raw lines at 07:45; replies OK or edits one line at 07:58. Published only after his OK.', true, 'Jack''s input comes through the Desk group (§9.C.13).'),
  ('macro_card', 2, 'Macro card', 'Daily 08:15, or before big news. Automatic from the macro bot once wired.',
   $t$Write a short macro card for the EzyMap channel.
Date: {DATE}
Events today in MYT with impact: {LIST}
One-line read on what each could do to gold (from Jack or the macro bot): {NOTES}
End with one line pointing to the macro bot. No predictions stated as certain.$t$,
   '["DATE", "LIST", "NOTES"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "*MACRO CHECK | Tue 14 Oct*\n\nToday''s key events (MYT)\n- 20:30 US Retail Sales (high impact)\n- 22:00 Fed speaker\n\nWhat it can mean for gold: a strong number usually lifts the dollar and pressures gold short term. A weak one does the opposite.\n\nFull heatmaps and Fed watch live in the macro bot."}]',
   '{}', 900, '#Macro', 'Automatic from the macro bot digest. No approval unless the claim detector flags a level or a certain prediction.', false, null),
  ('signal_card', 3, 'Free signal card', 'When an EzyMap alert fires and Jack approves it (London/NY session, 1-2 per day).',
   $t$Turn this EzyMap alert into a channel signal card.
Alert text: {PASTE ALERT}
TP1 and TP2 if different from alert: {TP1}, {TP2}
Signal number this week: {N}
Keep the exact numbers. Add the management plan line and the risk line. Use the right direction emoji.$t$,
   '["ALERT", "TP1", "TP2", "N"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "[green circle] *BUY | XAUUSD | M15*\n\nEntry zone: *4,014 - 4,017*\nStop loss: *4,006*\nTP1: *4,030* (1.5R)\nTP2: *4,046*\nConfluences: 3\n\nPlan: half off at TP1, stop to entry, let the rest run.\nRisk 1% or less. Free signal #3 this week.\n\nResults get posted as a reply under this message."}]',
   '{risk,result_footer}', 900, '#Signal', 'Jack taps approve on every signal card. If the alert says COUNTER-TREND, keep that warning line in the post.', true, 'Built from the real alert fields: direction, symbol, timeframe, entry, TP, SL, confluences. Source: TradingView webhook or EzyAi (§9.D.22–23).'),
  ('result_reply', 4, 'Result update (reply under the signal)', 'On hit. Every signal gets one, posted as a reply to the original card.',
   $t$Write a result reply for this EzyMap signal.
Original signal: {PASTE CARD}
Outcome: {TP1 / TP2 / BE / SL}
Result: {PIPS} and {R}
One-line reason from Jack (optional): {NOTE}
Max 3 lines. No excuses, no hype. For SL, state it plainly and mention the plan worked as designed if it did.$t$,
   '["CARD", "OUTCOME", "PIPS", "R", "NOTE"]',
   '[{"label": "TP1 HIT", "lang": "en", "body": "[check mark] TP1 hit: *+1.5R*\nHalf closed, stop moved to entry. Letting the rest run to TP2."}, {"label": "TP2 HIT", "lang": "en", "body": "[check mark] TP2 hit. Trade closed at *+2.4R* total.\nThat''s how the plan is meant to work: patience at the zone, partials on the way."}, {"label": "BREAK-EVEN", "lang": "en", "body": "[white circle] Stopped at entry after TP1. Net *+0.75R* from the partial.\nOn the scorecard this counts as break-even, not a win."}, {"label": "STOP LOSS", "lang": "en", "body": "[cross] Stop hit: *-1R*.\nPrice broke the zone on the news spike. The plan said stand aside below 4,006 and the stop did its job.\nLosses stay on the channel. Next setup when the map lines up."}]',
   '{board_ref}', 400, '#Result', 'Numbers come only from the board (board_refs required by the guard). Posted automatically when the board status changes; the guard forces approval because it carries result numbers — Phase 1 decides whether board-sourced replies get a standing approval.', true, 'Always a reply under the original card (signal_posts). Max 3 lines.'),
  ('lesson', 5, 'Lesson', 'Daily 13:00 from the weekly batch. Two flavours: trading skill, and Start Safe for new people.',
   $t$Write one EzyMap lesson post.
Topic: {TOPIC}
Type: {SKILL / START SAFE}
Level: beginner
Language: {EN / BM}
Structure: one-line problem, the idea in plain words, one tiny example with numbers, one-line takeaway, hashtag.
Under 600 characters. No selling.$t$,
   '["TOPIC", "TYPE", "LANGUAGE"]',
   '[{"label": "SKILL", "lang": "en", "body": "[books] *LESSON | Where your stop really goes*\n\nMost people put the stop a few pips under entry because it ''feels safe''. On gold that''s where the noise lives.\n\nPut it beyond the structure that proves you wrong, then size the lot so that distance equals 1% of your account.\n\nWide stop, small lot. Tight stop, bigger lot. Same risk.\n\nSave this. #Lesson"}, {"label": "START SAFE (BM)", "lang": "ms", "body": "[books] *START SAFE | 3 red flag channel signal*\n\n1. Tunjuk profit je, loss tak pernah ada\n2. Suruh deposit dulu baru dapat ''VIP''\n3. Admin DM korang dulu minta duit\n\nKalau jumpa tiga-tiga ni, lari.\nKat EzyMap, semua loss kekal dalam channel. #StartSafe"}]',
   '{}', 600, '#Lesson / #StartSafe', 'Drafted in the Wednesday batch, Jack reviews by number, ABDUL schedules. No selling, so no approval beyond the batch review.', false, 'Weekly batch: 5 skill + 2 Start Safe (§9.C.18).'),
  ('channel_audit', 6, 'Channel Audit', 'Wednesday. Takes apart a common pattern, never a named channel.',
   $t$Write this week's Channel Audit post.
Pattern to audit: {PATTERN}
How it misleads people (Jack's notes): {NOTES}
EzyMap's last 4 weeks from the board: {WINS}, {LOSSES}, {TOTAL R}
Do not name or hint at any real channel. Under 800 characters. End with a calm contrast, no insults.$t$,
   '["PATTERN", "NOTES", "WINS", "LOSSES", "TOTAL_R"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "*CHANNEL AUDIT | The 95% win rate*\n\nHow a channel gets to 95%:\n- Move every stop to entry early, count break-evens as wins\n- Delete the trades that hit SL\n- Post results without lot size or entry time\n\nOur rule: break-even is left out of the count, losses stay up, every card shows entry, SL and TP.\n\nLast 4 weeks on EzyMap: *11 wins, 6 losses, +9.4R total.*\n\nNot as pretty. Actually true. #Audit"}]',
   '{}', 800, '#Audit', 'Pattern-based only; never names a channel. The board numbers it quotes set claim_flags, which forces Jack''s approval through the guard.', false, 'Audit topics: the 95% win rate; deposit $500 for VIP; screenshot-only results; the 30-signals-a-day channel; martingale recovery (Growth Plan §04).'),
  ('scorecard', 7, 'Weekly scorecard', 'Friday evening. Numbers come from the public board only.',
   $t$Write the weekly scorecard post.
Week: {DATES}
From the board: signals {N}, wins {W}, losses {L}, BE {B}, total R {R}
Best trade: {DETAILS}. Worst trade: {DETAILS}.
Calculate strict win rate as W / (W + L) and show the working. Keep the tone flat and factual.$t$,
   '["DATES", "N", "W", "L", "B", "R", "BEST", "WORST"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "*WEEKLY SCORECARD | 6 to 10 Oct*\n\nSignals: 8\nWins: 4 Losses: 2 Break-even: 2\nStrict win rate: *67%* (4 of 6, BE excluded)\nTotal: *+5.1R*\n\nBest: XAUUSD M15 buy, +2.4R\nWorst: Thursday news spike, -1R\n\nEvery trade is on the board at printezy.money/ezyai. #Scorecard"}]',
   '{board_ref,past_performance}', 900, '#Scorecard', 'Generated from v_results_weekly as an image + text; board_refs required by the guard; Jack approves.', true, 'Posted to the channel and Threads; X kit if X stays manual (§9.D.28).'),
  ('outlook', 8, 'Sunday outlook', 'Sunday evening. Jack''s weekly levels plus the calendar.',
   $t$Write the Sunday weekly outlook.
Week: {DATES}
Last week in one line: {NOTE}
Weekly levels: {SUPPORT}, {RESISTANCE}
Big events with MYT times: {LIST}
Jack's plan in 1-2 lines: {PLAN}
Mention tonight's live at {TIME}. Under 800 characters.$t$,
   '["DATES", "NOTE", "SUPPORT", "RESISTANCE", "LIST", "PLAN", "TIME"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "*WEEKLY OUTLOOK | 13 to 17 Oct*\n\nGold closed the week near the top of its range.\n\nLevels I care about\n- Weekly support: 3,980 - 3,995\n- Weekly resistance: 4,085 - 4,100\n\nBig events (MYT): CPI Wed 20:30, retail sales Thu 20:30.\n\nPlan: buy dips into support while it holds, no chasing into CPI.\n\nLive walk-through tonight 21:00 on TikTok. #Outlook"}]',
   '{risk}', 800, '#Outlook', 'Jack writes the levels (about 45 min on Sunday); Jack approves because it names levels.', true, null),
  ('offer', 9, 'Offer post (one per week, Saturday)', 'Saturday. Four rotating variants. Jack approves every offer post.',
   $t$Write this week's EzyMap offer post.
Variant: {A free tier / B trial / C no-broker / D EzyAI waitlist}
Product details and price (exact): {DETAILS}
Button text: {BUTTON}
Include the IB disclosure line for variant A. One call to action. Under 500 characters. No urgency tricks unless the deadline is real: {DEADLINE OR "none"}.$t$,
   '["VARIANT", "DETAILS", "BUTTON", "DEADLINE"]',
   '[{"label": "A. FREE TIER VIA BROKER", "lang": "en", "body": "*Want the private signal groups?*\n\nOpen an account under our broker link and unlock the Beginner pack free (ebook + EzyMap Lite). Deposit any amount for the Pro pack with the M1/M5 group.\n\nHonest note: we earn a commission when you trade through the link. You can keep getting the free map and signals without it.\n\n[Button: See the free steps]"}, {"label": "B. 3-DAY TRIAL", "lang": "en", "body": "Tired of closing layered trades one by one?\n\nBulk Close does it in one tap. Try it free for 3 days on your MT5 account, no payment needed.\n\n[Button: Start 3-day trial]"}, {"label": "C. NO-BROKER BUYERS", "lang": "en", "body": "Prefer to keep your own broker?\n\nEvery EzyMap tool can be bought directly: MT5 tools from $9/month, EzyMap Lite $49 once, EzyMap Pro $249 once.\n\n[Button: Browse tools]"}, {"label": "D. EZYAI WAITLIST (Q1 2027)", "lang": "en", "body": "EzyAI has been running quietly on the public board. Every call, every result, nothing deleted.\n\nPRO opens soon with a founding price for the first 100.\n\n[Button: Join the waitlist]"}]',
   '{disclosure_if_broker,one_cta}', 500, '#Tools', 'Jack approves every offer post. Prices only from products. Max one offer post per week (settings.offer_posts_per_week_max). Variant A carries the IB disclosure line.', true, 'Buttons need the bot''s /post or the dashboard (inline buttons).'),
  ('poll', 10, 'Poll / engagement', 'Monday and whenever reactions dip.',
   $t$Write a Telegram poll for the EzyMap channel about {TOPIC}. Give the question plus 4 short options (max 25 characters each) and one line explaining how answers will be used.$t$,
   '["TOPIC"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "Quick one before the week starts.\n\nWhat''s your biggest problem right now?\n- Entering too early\n- Moving my stop\n- Overtrading\n- Not sure what to trade\n\n(Answers pick next week''s lessons.)"}]',
   '{}', 300, null, 'Native Telegram poll; results feed next week''s lesson topics (§9.E.36). No approval.', false, 'Options max 25 characters each.'),
  ('evening_wrap', 11, 'Evening wrap', 'Daily 20:00 or after the NY open. Jack sends one line.',
   $t$Turn Jack's note into a 2-3 line evening wrap: {NOTE}. Mention tomorrow's map time. No emojis except one if it fits.$t$,
   '["NOTE"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "Wrap for today: the S1 zone held and gave the TP1 move. R2 never came. Tomorrow I watch whether 4,046 flips to support.\n\nMap at 8am."}]',
   '{}', 400, null, 'From Jack''s own line; posts after ABDUL formats it. Levels Jack typed are his own numbers.', false, '19:55 reminder if no line arrived (§9.C.20).'),
  ('news_alert', 12, 'News alert (before a release)', '15 to 30 minutes before CPI, NFP, FOMC and similar.',
   $t$Write a pre-news alert for {EVENT} at {TIME MYT}. Two practical rules, one line that we'll post the reaction after. Under 350 characters.$t$,
   '["EVENT", "TIME"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "[warning] *NEWS IN 30 MIN: US CPI (20:30)*\n\nSpreads widen and gold can jump 20-40 dollars in seconds.\n- Not in a trade? Wait for the first candle to close.\n- In a trade? Know where your stop is now, not after.\n\nWe post the reaction after the release."}]',
   '{}', 350, null, 'Automatic from the economic calendar; approval only if it names levels (claim detector).', false, null),
  ('member_result', 13, 'Member result (with permission only)', 'When a member shares a result and agrees in writing to it being posted.',
   $t$Write a member result post from this message: {MESSAGE}. The member agreed to share: {YES}. Remove any name or account number. Add one line that results vary and one line praising the process, not the profit.$t$,
   '["MESSAGE", "PERMISSION"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "Shared with permission by a Premium member:\n\n\"Stopped chasing entries, waited for the zone. 3 trades this week, 2 wins, 1 loss, +2.8R on a $600 account.\"\n\nNot every week looks like this. What we like here is the process: fewer trades, planned stops."}]',
   '{permission,results_vary}', 900, null, 'No permission, no post. Never edit the member''s numbers. Written permission recorded; names and account numbers removed. Jack approves.', true, null),
  ('holiday', 14, 'Market closed / holiday / milestone', 'Weekends, public holidays and member milestones.',
   $t$Write a short {HOLIDAY NOTICE / MILESTONE} post. Details: {DETAILS}. Under 300 characters.$t$,
   '["KIND", "DETAILS"]',
   '[{"label": "HOLIDAY", "lang": "en", "body": "Markets are thin today for the Deepavali holiday. No map, no signals. Good day to review your journal. Back tomorrow at 8am."}, {"label": "MILESTONE", "lang": "en", "body": "We just passed *1,000 members*. Thank you for being here.\n\nSame promise as day one: daily map, every result posted, no hype. If EzyMap helped you, send the channel to one friend who trades."}]',
   '{}', 300, null, 'Holiday notices from the Malaysian holiday calendar; milestone drafts when members cross a threshold (settings.milestones). Member count is a number Jack verifies.', false, null),
  ('start_here', 15, 'Pinned Start here', 'Pinned at the top. Update when offers change.',
   $t$Update the pinned Start here post. Current free content: {LIST}. Current buttons: {BUTTONS}. Keep the pledge and disclosure lines word for word.$t$,
   '["LIST", "BUTTONS"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "*Welcome to EzyMap*\n\nWhat you get here, free:\n- Gold map every day at 8am\n- 1-2 signals with every result posted\n- Lessons, weekly scorecard, Sunday outlook\n\nOur pledge: every loss stays up, win rate counted strictly, and we tell you openly that we earn a broker commission if you use our link. You never need it for the free content.\n\nEducation only, not financial advice.\n\n[Today''s map] [Lessons] [Tools & signals]"}]',
   '{pledge_pinned,education,disclosure}', 900, null, 'Pledge and disclosure lines locked word for word (brand_facts). Jack approves any change.', true, 'Three buttons: Today''s map, Learn (lesson index), Get tools and signals (bot).')
on conflict (key) do update set
  kit_number = excluded.kit_number, name = excluded.name, schedule = excluded.schedule, prompt_text = excluded.prompt_text,
  fields = excluded.fields, examples = excluded.examples, required_lines = excluded.required_lines, char_limit = excluded.char_limit,
  hashtag = excluded.hashtag, approval_rule = excluded.approval_rule, requires_approval = excluded.requires_approval, notes = excluded.notes;

-- ===========================================================================
-- style_guide — master prompt, voice, banned words, emoji/format rules,
-- EN↔BM glossary stub, disclaimers, trade card format, checklist (Posting Kit
-- §03, §05; FYP §05, §07; printezy translations.ts; EzyAi message.py)
-- ===========================================================================
insert into public.style_guide (kind, key, lang, body, extra, source, sort_order) values
  ('master_prompt', 'master', 'en',
   $t$You are the copywriter for EzyMap (t.me/ezymap), a Telegram channel run by Jack that maps gold (XAUUSD) daily, shares 1-2 free signals, and teaches traders to follow a plan instead of hype.

VOICE
- Calm, direct, friendly. Like a mentor texting a friend. Short lines. No hype.
- Malaysian audience. Default to English with light Malay flavour; when I say BM, write casual Bahasa Melayu (korang, aku/saya, "jom") with English trading terms kept in English.
- Use a few house emojis: green circle BUY, red circle SELL, check mark TP, cross SL, white circle break-even, map pin for maps, books for lessons. Max 5 emojis per post.

RULES
- Never invent prices, levels, results, testimonials or member counts. Only use numbers I give you. If a number is missing, write [NEEDED].
- Never say guaranteed, sure profit, passive income, double your money, 100%, or "can't lose".
- Every signal or map post ends with a short risk line.
- Losses are reported as plainly as wins.
- One call to action per post, maximum. Offers only when I ask for an offer post.
- Posts stay under 900 characters unless I ask for long form.
- Format for Telegram: bold with *asterisks*, short paragraphs, no markdown headers, no tables.

BRAND FACTS
- Free: daily gold map, 1-2 signals, lessons, weekly scorecard.
- Bot for everything else: @EzyRegisterBot. Support persona: Sarah.
- Ladders: Free (channel), Funded (IB tiers Beginner/Pro/Premium/Elite via our broker link), Paid without broker (MT5 tools from $9/mo, EzyMap Lite $49, EzyMap Pro $249, EzyAI PRO $14.99/mo, Macro desk $19/mo).
- We earn a commission when people trade through our broker link, and we say so openly.
- Win rate is counted strictly: break-even trades are excluded, never counted as half a win.

OUTPUT
Give me the post ready to paste, then one alternative version, then nothing else.$t$,
   '{"note": "Prices in BRAND FACTS must match products; the drafting function substitutes them from the table before use."}', 'Posting Kit §03', 1),
  ('master_prompt', 'batch', 'en',
   $t$Batch for next week ({DATES}). Using the master rules, write:
1. Seven lessons (Mon-Sun). Topics: {LIST OR "pick from the lesson topic list, 5 skill + 2 Start Safe"}. Mix EN and BM: {RATIO}.
2. One Channel Audit on: {PATTERN}.
3. One Monday poll on: {TOPIC}.
4. One Saturday offer post, variant {A/B/C/D}, details: {DETAILS}.
Number each post, give a suggested posting time in MYT, and put [NEEDED] wherever a number is missing.$t$,
   '{"run_at": "Wednesday 14:30", "ready_by": "15:30", "edits_by_number": ["3: soften", "5: BM"], "schedule_by": "Thursday evening"}', 'Posting Kit §05', 2),
  -- voice rules
  ('voice_rule', 'tone', 'en', 'Calm, direct, friendly. Like a mentor texting a friend. Short lines. No hype.', null, 'Posting Kit §03', 10),
  ('voice_rule', 'language_default', 'en', 'Malaysian audience. Default to English with light Malay flavour.', null, 'Posting Kit §03', 11),
  ('voice_rule', 'bm_style', 'ms', 'When BM: casual Bahasa Melayu (korang, aku/saya, "jom") with English trading terms kept in English.', null, 'Posting Kit §03 / UPGRADE-PLAN §9.J.82', 12),
  ('voice_rule', 'no_invented_numbers', 'en', 'Never invent prices, levels, results, testimonials or member counts. Only use numbers Jack gives. If a number is missing, write [NEEDED].', null, 'Posting Kit §03', 13),
  ('voice_rule', 'losses_plain', 'en', 'Losses are reported as plainly as wins.', null, 'Posting Kit §03', 14),
  ('voice_rule', 'one_cta', 'en', 'One call to action per post, maximum. Offers only when Jack asks for an offer post.', null, 'Posting Kit §03', 15),
  ('voice_rule', 'risk_line', 'en', 'Every signal or map post ends with a short risk line.', null, 'Posting Kit §03', 16),
  ('voice_rule', 'no_named_channels', 'en', 'Channel Audit takes apart a common pattern, never a named channel. Do not name or hint at any real channel.', null, 'Growth Plan §04 / Posting Kit POST 6', 17),
  ('voice_rule', 'tiktok_no_selling', 'en', 'Nothing is sold on TikTok directly. The channel and the bot do the selling.', null, 'FYP §01', 18),
  -- emoji rules
  ('emoji_rule', 'house_emojis', 'en', 'House emojis: green circle for BUY, red circle for SELL, check mark for TP, cross for SL, white circle for break-even, map pin for the gold map, books for lessons, warning sign for news alerts.', '{"BUY": "🟢", "SELL": "🔴", "TP": "✅", "SL": "❌", "BE": "⚪", "MAP": "📍", "LESSON": "📚", "NEWS": "⚠️"}', 'Posting Kit §02–§03', 20),
  ('emoji_rule', 'max_emojis', 'en', 'Max 5 emojis per post. Evening wrap: no emojis except one if it fits.', '{"max": 5}', 'Posting Kit §03 / POST 11', 21),
  -- format rules
  ('format_rule', 'telegram_format', 'en', 'Format for Telegram: bold with *asterisks*, short paragraphs, no markdown headers, no tables. Bold only on key numbers.', null, 'Posting Kit §03, §05', 30),
  ('format_rule', 'char_limit', 'en', 'Posts stay under 900 characters unless long form is requested.', '{"default": 900}', 'Posting Kit §03', 31),
  ('format_rule', 'output_shape', 'en', 'Give the post ready to paste, then one alternative version, then nothing else.', null, 'Posting Kit §03', 32),
  ('trade_card_format', 'trade_card', 'en', 'One trade card format everywhere: pair, direction, entry zone, SL, TP1/TP2, R:R, invalidation, risk note. Same look on channel, TikTok and website.', '{"fields": ["pair", "direction", "entry_zone", "sl", "tp1", "tp2", "rr", "invalidation", "risk_note"]}', 'Growth Plan §07', 33),
  ('hashtag_index', 'index', 'en', '#GoldMap #Signal #Result #Lesson #StartSafe #Audit #Macro #Scorecard #Outlook #Tools', '{"tags": ["#GoldMap", "#Signal", "#Result", "#Lesson", "#StartSafe", "#Audit", "#Macro", "#Scorecard", "#Outlook", "#Tools"]}', 'Posting Kit §03', 34),
  ('caption_pattern', 'tiktok_caption', 'en', 'Caption: one line + question + 3 to 5 hashtags. Cover text of 3 to 5 words.', '{"example": "Gold respected the S1 zone to the pip this morning. Did you catch it?\nFull map drops free every day at 8am (link in bio).\n\n#xauusd #goldtrading #forexmalaysia #tradingview #belajartrading", "hashtags": {"min": 3, "max": 5}}', 'FYP §05', 35),
  ('caption_pattern', 'instagram', 'en', 'Shorter caption, 5 hashtags, link in bio. Warning placed before the "…more" cut.', null, 'FYP §08 / UPGRADE-PLAN §12', 36),
  ('caption_pattern', 'youtube_shorts', 'en', 'Keep under 60 seconds. Searchable title like "Where your stop goes on gold #shorts".', null, 'FYP §08', 37),
  ('caption_pattern', 'threads', 'en', 'Post the key chart screenshot, not the video. Two-line takeaway plus a question.', null, 'FYP §08', 38),
  ('caption_pattern', 'x', 'en', 'Screenshot for recaps; 3-post thread for Channel Audits. One strong line, no hashtag spam.', null, 'FYP §08', 39),
  -- tiktok rules
  ('tiktok_rule', 'signature_look', 'en', 'Keep one look: dark chart, EzyMap green for buys, red for sells, gold for zones, the same font for on-screen text and the same end card.', null, 'FYP §01', 40),
  ('tiktok_rule', 'first_two_seconds', 'en', 'Open on the chart moment or a bold line of text, never on "hi guys". Bold on-screen text for the hook and the key number, auto-captions on.', null, 'FYP §01', 41),
  ('tiktok_rule', 'bio_line', 'en', 'Put "Education only, not financial advice" in your bio and say it in lives.', null, 'FYP §05', 42),
  ('tiktok_rule', 'no_balances', 'en', 'Never show account balances as bait.', null, 'FYP §05', 43),
  ('tiktok_rule', 'disclosure_toggle', 'en', 'Own-business promotion needs the content-disclosure toggle on product posts.', null, 'UPGRADE-PLAN §12', 44),
  -- live rules
  ('live_rule', 'education_only', 'en', 'Say "education only, not financial advice" at the start and once in the middle.', null, 'FYP §07', 50),
  ('live_rule', 'no_promises', 'en', 'No account balances, no "join now or miss out", no promises about results.', null, 'FYP §07', 51),
  ('live_rule', 'no_trades_in_comments', 'en', 'Never take trade instructions or payments in live comments. Point people to the bot.', null, 'FYP §07', 52),
  ('live_rule', 'pinned_comment', 'en', 'Pin one comment: channel link and "type MAP to get tomorrow''s map".', null, 'FYP §07', 53),
  ('live_rule', 'moderator', 'en', 'Ask one trusted member to moderate: remove spam, scam links and fake "account managers" who DM your viewers.', null, 'FYP §07', 54),
  ('live_rule', 'notes_file', 'en', 'Keep a notes file open. Every good question becomes a short or a lesson post.', null, 'FYP §07', 55),
  ('live_rule', 'protect_viewers', 'en', 'Say in every live: "Jack never DMs you first and never asks for money in DMs. Only trust @EzyRegisterBot and t.me/ezymap."', null, 'FYP §07', 56),
  -- glossary stub EN ↔ BM (trading terms stay in English)
  ('glossary', 'you_plural', 'both', 'you (plural, casual)', '{"ms": "korang"}', 'Posting Kit §03', 60),
  ('glossary', 'i', 'both', 'I', '{"ms": "aku (casual) / saya (neutral)"}', 'Posting Kit §03', 61),
  ('glossary', 'lets', 'both', 'let''s', '{"ms": "jom"}', 'Posting Kit §03', 62),
  ('glossary', 'today', 'both', 'today', '{"ms": "hari ni"}', 'Posting Kit POST 1 BM example', 63),
  ('glossary', 'sideways', 'both', 'sideways / range', '{"ms": "sideways (kept) / tengah sideways"}', 'Posting Kit POST 1 BM example', 64),
  ('glossary', 'reduce_lot', 'both', 'reduce lot size', '{"ms": "kurangkan lot"}', 'Posting Kit POST 1 BM example', 65),
  ('glossary', 'not_financial_advice', 'both', 'not financial advice', '{"ms": "bukan nasihat kewangan"}', 'Posting Kit POST 1 BM example', 66),
  ('glossary', 'red_flag', 'both', 'red flag', '{"ms": "red flag (kept)"}', 'Posting Kit POST 5 BM example', 67),
  ('glossary', 'win_rate', 'both', 'win rate', '{"ms": "win rate (kept)"}', 'FYP §03', 68),
  ('glossary', 'stop_loss', 'both', 'stop loss', '{"ms": "SL / stop loss (kept)"}', 'FYP §03', 69),
  ('glossary', 'account', 'both', 'account', '{"ms": "akaun"}', 'FYP §03', 70),
  ('glossary', 'loss_trade', 'both', 'losing trade', '{"ms": "trade loss"}', 'FYP §03', 71),
  ('glossary', 'setup', 'both', 'setup', '{"ms": "setup (kept)"}', 'FYP §03', 72),
  ('glossary', 'trading_terms', 'both', 'Trading terms stay in English in BM copy: entry, SL, TP, zone, lot, pips, R, bias, breakout, signal, map, scorecard.', null, 'Posting Kit §03 / UPGRADE-PLAN §9.J.82', 73),
  -- disclaimers (verbatim)
  ('disclaimer', 'footer_risk', 'en', 'Trading involves risk. Signals are educational, not financial advice.', null, 'printezy translations.ts footer_risk_disclaimer', 80),
  ('disclaimer', 'footer_risk_ms', 'ms', 'Dagangan melibatkan risiko. signals adalah untuk pendidikan, bukan nasihat kewangan.', null, 'printezy translations.ts footer_risk_disclaimer (ms)', 81),
  ('disclaimer', 'hero', 'en', 'Illustrative example of signal format. Trading carries risk of loss. Signals are for education only and are not personalized financial advice.', null, 'printezy translations.ts hero_disclaimer', 82),
  ('disclaimer', 'hero_ms', 'ms', 'Contoh ilustrasi format signal. Dagangan membawa risiko kerugian. signal adalah untuk tujuan pendidikan sahaja dan bukan nasihat kewangan peribadi.', null, 'printezy translations.ts hero_disclaimer (ms)', 83),
  ('disclaimer', 'track_record', 'en', 'Past performance is not indicative of future results. We do not publish win-rate or pip totals that cannot be independently verified.', null, 'printezy translations.ts track_record_disclaimer', 84),
  ('disclaimer', 'track_record_ms', 'ms', 'Prestasi lepas tidak menunjukkan hasil masa depan. Kami tidak menerbitkan kadar kemenangan atau jumlah pip yang tidak dapat disahkan secara bebas.', null, 'printezy translations.ts track_record_disclaimer (ms)', 85),
  ('disclaimer', 'ezyai', 'en', 'Signals are rule-based confluence — deterministic and explainable. Educational only, not personalized financial advice. Verify prices with your broker before acting.', null, 'printezy translations.ts ezyai_disclaimer', 86),
  ('disclaimer', 'ezyai_ms', 'ms', 'Signals adalah gabungan berasaskan peraturan — deterministik dan boleh dijelaskan. Untuk pendidikan sahaja, bukan nasihat kewangan peribadi. Sahkan harga dengan broker anda sebelum bertindak.', null, 'printezy translations.ts ezyai_disclaimer (ms)', 87),
  ('disclaimer', 'macro', 'en', 'Macro data is provided for education and research only and is not personalized investment advice. Figures come from third-party sources and may be delayed or revised — cross-check against [the calendar] before acting. Trading carries a risk of loss.', '{"before": "Macro data is provided for education and research only and is not personalized investment advice. Figures come from third-party sources and may be delayed or revised — cross-check against", "after": "before acting. Trading carries a risk of loss."}', 'printezy translations.ts macro_disclaimer_before/after', 88),
  ('disclaimer', 'macro_ms', 'ms', 'Data macro disediakan untuk pendidikan dan penyelidikan sahaja dan bukan nasihat pelaburan peribadi. Angka datang daripada sumber pihak ketiga dan mungkin lewat atau disemak semula — semak silang dengan [kalendar] sebelum bertindak. Dagangan membawa risiko kerugian.', '{"before": "Data macro disediakan untuk pendidikan dan penyelidikan sahaja dan bukan nasihat pelaburan peribadi. Angka datang daripada sumber pihak ketiga dan mungkin lewat atau disemak semula — semak silang dengan", "after": "sebelum bertindak. Dagangan membawa risiko kerugian."}', 'printezy translations.ts macro_disclaimer_before/after (ms)', 89),
  ('disclaimer', 'ezyai_signal_line', 'en', 'Not financial advice. Verify prices with your broker.', null, 'EzyAi app/formatting/message.py signal_message', 90),
  ('disclaimer', 'ezyai_analysis_line', 'en', 'Educational confluence only, not financial advice. Demo data can stand in when live feeds fail. Verify prices with your broker before acting.', null, 'EzyAi app/formatting/message.py analysis_report', 91),
  ('disclaimer', 'ezyai_demo_banner', 'en', 'DEMO DATA — prices may be simulated. Verify before acting.', '{"rule": "demo/shadow/synthetic rows never reach a public post (quality.may_emit)"}', 'EzyAi app/formatting/message.py _feed_lines', 92),
  ('disclaimer', 'ezyai_quote_line', 'en', 'Indicative price, not financial advice.', null, 'EzyAi app/formatting/message.py quote_report', 93),
  ('disclaimer', 'map_risk', 'en', 'Map only, not advice. Manage your own risk.', null, 'Posting Kit POST 1', 94),
  ('disclaimer', 'map_risk_ms', 'ms', 'Ini mapping, bukan nasihat kewangan.', null, 'Posting Kit POST 1 (BM)', 95),
  ('disclaimer', 'education_only', 'en', 'Education only, not financial advice.', null, 'Posting Kit POST 15', 96),
  ('disclaimer', 'ib_disclosure', 'en', 'Honest note: we earn a commission when you trade through the link. You can keep getting the free map and signals without it.', null, 'Posting Kit POST 9 A', 97),
  -- pre-post checklist (Posting Kit §05 + SC points, UPGRADE-PLAN §12)
  ('checklist', 'numbers', 'en', 'Numbers', '{"pass_if": "Every price, level and result matches Jack''s input or the board; no [NEEDED] left"}', 'Posting Kit §05 / UPGRADE-PLAN §12', 100),
  ('checklist', 'words', 'en', 'Words', '{"pass_if": "Nothing from the banned list (kit list + best, risk-free, tanpa risiko). No promise of profit."}', 'Posting Kit §05 / UPGRADE-PLAN §12', 101),
  ('checklist', 'risk_line', 'en', 'Risk line', '{"pass_if": "Present on every map, signal, outlook and scorecard"}', 'Posting Kit §05 / UPGRADE-PLAN §12', 102),
  ('checklist', 'video_warning', 'en', 'Video warning', '{"pass_if": "Spoken or on-screen risk line inside every video, not caption only"}', 'UPGRADE-PLAN §12', 103),
  ('checklist', 'ig_fb_cut', 'en', 'Instagram/Facebook', '{"pass_if": "Warning placed before the …more cut"}', 'UPGRADE-PLAN §12', 104),
  ('checklist', 'one_cta', 'en', 'One CTA', '{"pass_if": "At most one call to action; only one offer post per week"}', 'Posting Kit §05 / UPGRADE-PLAN §12', 105),
  ('checklist', 'disclosure', 'en', 'Disclosure', '{"pass_if": "Any broker-link mention carries the commission line"}', 'Posting Kit §05 / UPGRADE-PLAN §12', 106),
  ('checklist', 'losses', 'en', 'Losses', '{"pass_if": "Every signal has its result reply, including SL"}', 'Posting Kit §05 / UPGRADE-PLAN §12', 107),
  ('checklist', 'results', 'en', 'Results', '{"pass_if": "Result and scorecard posts reference board rows; past-performance line present"}', 'UPGRADE-PLAN §12', 108),
  ('checklist', 'member_results', 'en', 'Member results', '{"pass_if": "Written permission recorded; names and account numbers removed; numbers untouched"}', 'UPGRADE-PLAN §12', 109),
  ('checklist', 'format', 'en', 'Format', '{"pass_if": "Under 900 characters unless long form; short lines; Telegram bold only on key numbers"}', 'Posting Kit §05 / UPGRADE-PLAN §12', 110),
  ('checklist', 'language', 'en', 'Language', '{"pass_if": "Matches the planned slot"}', 'Posting Kit §05 / UPGRADE-PLAN §12', 111),
  ('checklist', 'tiktok_kit', 'en', 'TikTok kit', '{"pass_if": "Disclosure-toggle reminder on product posts; education only in bio and lives"}', 'UPGRADE-PLAN §12', 112),
  ('rule', 'content_log_columns', 'en', 'Content log columns: Date · Time · Post type · Language · Link · Views after 24h · Reactions · Bot /starts from its tag · Notes. Review every Friday: keep the top 3 post types, fix or drop the bottom one.', null, 'Posting Kit §05', 120),
  ('rule', 'claim_detector', 'en', 'Claims that force approval: prices, levels, results, percentages, offers, broker names, testimonials.', '{"claim_flags": ["price", "level", "result", "percentage", "offer", "broker", "testimonial", "member_count"]}', 'UPGRADE-PLAN §9.O.111', 121),
  ('jack_note', 'reference_channels', 'en', 'Jack''s style notes on the reference channels go here as rules he writes himself (e.g. "short map format", "clean result replies"). Their wording is never copied.', null, 'UPGRADE-PLAN §4.10', 130)
on conflict (kind, key) where key is not null do update set lang = excluded.lang, body = excluded.body, extra = excluded.extra, source = excluded.source, sort_order = excluded.sort_order;


-- banned words: kit list + best, risk-free, tanpa risiko (UPGRADE-PLAN §12)
insert into public.style_guide (kind, key, lang, body, source, sort_order)
select 'banned_word', 'bw_' || regexp_replace(lower(w), '[^a-z0-9]+', '_', 'g'), 'both', w, src, 200 + ord
from (values
  ('guaranteed', 'Posting Kit §03', 1), ('sure profit', 'Posting Kit §03', 2), ('sure win', 'Posting Kit §03', 3),
  ('confirm untung', 'Posting Kit §03', 4), ('pasti untung', 'Posting Kit §03', 5), ('passive income', 'Posting Kit §03', 6),
  ('double your money', 'Posting Kit §03', 7), ('100% accurate', 'Posting Kit §03', 8), ('100%', 'Posting Kit master prompt', 9),
  ('no loss', 'Posting Kit §03', 10), ('can''t lose', 'Posting Kit §03', 11), ('risk-free', 'Posting Kit §03', 12),
  ('get rich', 'Posting Kit §03', 13), ('financial freedom in 30 days', 'Posting Kit §03', 14), ('last chance', 'Posting Kit §03', 15),
  ('only 3 slots left (unless true)', 'Posting Kit §03', 16), ('DM me for signals', 'Posting Kit §03', 17),
  ('best', 'UPGRADE-PLAN §12', 18), ('tanpa risiko', 'UPGRADE-PLAN §12', 19)
) as v(w, src, ord)
on conflict (kind, key) where key is not null do update set body = excluded.body, source = excluded.source, sort_order = excluded.sort_order;

-- ===========================================================================
-- hooks — the forty opening lines, EN and BM (FYP §03)
-- ===========================================================================
insert into public.hooks (pair_no, lang, text, pillar)
select pair_no, lang, text, pillar from (values
  (1, 'en', 'Gold hit my zone to the pip this morning.', 'map_recap'),
  (1, 'ms', 'Gold kena zone aku tepat-tepat pagi tadi.', 'map_recap'),
  (2, 'en', 'I was wrong about gold today. Here''s why.', 'map_recap'),
  (2, 'ms', 'Hari ni aku salah baca gold. Ni sebabnya.', 'map_recap'),
  (3, 'en', 'Stop copying signals until you know this.', 'lesson'),
  (3, 'ms', 'Jangan copy signal lagi selagi tak faham benda ni.', 'lesson'),
  (4, 'en', 'This is why your stop loss keeps getting hit.', 'lesson'),
  (4, 'ms', 'Ni sebab SL korang asyik kena.', 'lesson'),
  (5, 'en', 'A 95% win rate is usually a lie. Let me show you.', 'channel_audit'),
  (5, 'ms', 'Win rate 95%? Jom kira betul-betul.', 'channel_audit'),
  (6, 'en', 'What a VIP group won''t tell you about their results.', 'channel_audit'),
  (6, 'ms', 'Group VIP takkan bagitau benda ni.', 'channel_audit'),
  (7, 'en', 'The one rule that saved my account.', 'jacks_desk'),
  (7, 'ms', 'Satu rule yang selamatkan akaun aku.', 'jacks_desk'),
  (8, 'en', 'If you trade gold on news, watch this first.', 'lesson'),
  (8, 'ms', 'Nak trade gold masa news? Tengok ni dulu.', 'lesson'),
  (9, 'en', 'Your lot size is the problem, not your entry.', 'lesson'),
  (9, 'ms', 'Masalah korang lot size, bukan entry.', 'lesson'),
  (10, 'en', 'I post every losing trade. Here''s this week''s.', 'jacks_desk'),
  (10, 'ms', 'Aku post semua trade loss. Ni minggu ni punya.', 'jacks_desk'),
  (11, 'en', 'Three red flags in any signal channel.', 'start_safe'),
  (11, 'ms', 'Tiga red flag channel signal.', 'start_safe'),
  (12, 'en', 'How I map gold in 10 minutes every morning.', 'jacks_desk'),
  (12, 'ms', 'Macam mana aku mapping gold 10 minit setiap pagi.', 'jacks_desk'),
  (13, 'en', 'Why I skip 80% of setups.', 'lesson'),
  (13, 'ms', 'Kenapa aku skip banyak setup.', 'lesson'),
  (14, 'en', '$500 account? Do this before anything else.', 'start_safe'),
  (14, 'ms', 'Akaun RM2,000? Buat ni dulu.', 'start_safe'),
  (15, 'en', 'This is what a real trade card looks like.', 'channel_audit'),
  (15, 'ms', 'Ni rupa trade card yang betul.', 'channel_audit'),
  (16, 'en', 'Martingale looks great until this happens.', 'channel_audit'),
  (16, 'ms', 'Martingale nampak cantik sampai jadi macam ni.', 'channel_audit'),
  (17, 'en', 'The setup I wait for every NY session.', 'map_recap'),
  (17, 'ms', 'Setup yang aku tunggu setiap sesi NY.', 'map_recap'),
  (18, 'en', 'You don''t need 30 signals a day. You need one plan.', 'channel_audit'),
  (18, 'ms', 'Tak perlu 30 signal sehari. Perlu satu plan.', 'channel_audit'),
  (19, 'en', 'What ''deposit to unlock VIP'' really means.', 'channel_audit'),
  (19, 'ms', '''Deposit untuk unlock VIP'' sebenarnya maksud dia apa.', 'channel_audit'),
  (20, 'en', 'I stopped closing trades by hand. Here''s what I use.', 'tool_demo'),
  (20, 'ms', 'Aku dah tak close trade satu-satu. Ni yang aku guna.', 'tool_demo')
) as v(pair_no, lang, text, pillar)
on conflict (pair_no, lang) do update set text = excluded.text, pillar = excluded.pillar;

-- ===========================================================================
-- calendar_slots — 28-day TikTok calendar (FYP §04), channel daily rhythm
-- (Growth Plan §07 / Posting Kit §01), weekly extras, lives. Re-seeded by source.
-- ===========================================================================
delete from public.calendar_slots where source in ('FYP §04', 'Posting Kit §01 / Growth Plan §07', 'Growth Plan §07 weekly', 'FYP §06');

-- 28-day TikTok calendar. MR = Map Recap, CA = Channel Audit, L = Lesson, TD = Tool Demo, JD = Jack's Desk.
insert into public.calendar_slots (kind, week_no, dow, platform, pillar, topic, who, source)
select 'tiktok_28day', week_no, dow, 'tiktok', pillar, topic, 'jack', 'FYP §04' from (values
  (1, 1, 'map_recap', 'MR: this morning''s zone touch'),
  (1, 2, 'lesson', 'L: where your stop goes on gold'),
  (1, 3, 'channel_audit', 'CA: the 95% win rate'),
  (1, 4, 'map_recap', 'MR: NY session recap'),
  (1, 5, 'tool_demo', 'TD: Bulk Close in 20 seconds'),
  (1, 6, 'jacks_desk', 'JD: my 10-minute morning routine'),
  (1, 7, 'start_safe', 'L (Start Safe): 3 scam red flags'),
  (2, 1, 'map_recap', 'MR: the zone that failed and why'),
  (2, 2, 'lesson', 'L: pips, lots and position size'),
  (2, 3, 'channel_audit', 'CA: ''deposit $500 for VIP'''),
  (2, 4, 'map_recap', 'MR: news-day recap (CPI/NFP week)'),
  (2, 5, 'tool_demo', 'TD: Drawdown Guardian for prop firms'),
  (2, 6, 'jacks_desk', 'JD: my worst trade this month'),
  (2, 7, 'start_safe', 'L (Start Safe): demo first, why'),
  (3, 1, 'map_recap', 'MR: London vs NY reaction'),
  (3, 2, 'lesson', 'L: what moves gold (USD, yields, news)'),
  (3, 3, 'channel_audit', 'CA: screenshot-only results'),
  (3, 4, 'map_recap', 'MR: a no-trade day and why'),
  (3, 5, 'tool_demo', 'TD: EzyMap Pro zones on the chart'),
  (3, 6, 'jacks_desk', 'JD: how I journal a trade'),
  (3, 7, 'start_safe', 'L (Start Safe): broker checklist'),
  (4, 1, 'map_recap', 'MR: the cleanest setup this month'),
  (4, 2, 'lesson', 'L: reading R, not just pips'),
  (4, 3, 'channel_audit', 'CA: martingale recovery'),
  (4, 4, 'map_recap', 'MR: weekly high/low map'),
  (4, 5, 'tool_demo', 'TD: Auto TPSL'),
  (4, 6, 'jacks_desk', 'JD: this month''s honest scorecard'),
  (4, 7, 'start_safe', 'L (Start Safe): how much to start with')
) as v(week_no, dow, pillar, topic);

-- Channel daily rhythm (every day; dow NULL)
insert into public.calendar_slots (kind, dow, time_local, time_label, platform, post_type, who, notes, source) values
  ('channel_daily', null, '07:45', null, 'telegram', null, 'jack', 'Map screenshot + raw notes into the private EzyMap Desk group', 'Posting Kit §01 / Growth Plan §07'),
  ('channel_daily', null, '07:50', null, 'telegram', 'gold_map', 'abdul', 'Draft back in the Desk group (Prompt 1)', 'Posting Kit §01 / Growth Plan §07'),
  ('channel_daily', null, '07:58', null, 'telegram', 'gold_map', 'jack', 'OK or one-line edit', 'Posting Kit §01 / Growth Plan §07'),
  ('channel_daily', null, '08:00', null, 'telegram', 'gold_map', 'auto', 'Gold map, published after OK', 'Posting Kit §01 / Growth Plan §07'),
  ('channel_daily', null, '08:15', null, 'telegram', 'macro_card', 'auto', 'Macro card from the macro bot digest (template 2)', 'Posting Kit §01 / Growth Plan §07'),
  ('channel_daily', null, '13:00', null, 'telegram', 'lesson', 'auto', 'Lesson from the weekly batch', 'Posting Kit §01 / Growth Plan §07'),
  ('channel_daily', null, null, 'London/NY', 'telegram', 'signal_card', 'jack+auto', 'Free signal card 1-2 from the EzyMap alert; Jack taps approve', 'Posting Kit §01 / Growth Plan §07'),
  ('channel_daily', null, null, 'On hit', 'telegram', 'result_reply', 'auto', 'Result reply under the original signal (template 4)', 'Posting Kit §01 / Growth Plan §07'),
  ('channel_daily', null, null, '15-30 min before CPI/NFP/FOMC', 'telegram', 'news_alert', 'auto', 'News alert; approve if it names levels', 'Posting Kit §01 / Growth Plan §07'),
  ('channel_daily', null, '20:00', null, 'telegram', 'evening_wrap', 'jack+auto', 'Evening wrap from one line (template 11)', 'Posting Kit §01 / Growth Plan §07');

-- Channel weekly extras
insert into public.calendar_slots (kind, dow, time_local, platform, post_type, who, notes, source) values
  ('channel_weekly', 1, '09:00', 'telegram', 'poll', 'auto', 'Poll: what are you trading this week? (feeds TikTok topics)', 'Growth Plan §07 weekly'),
  ('channel_weekly', 3, '13:00', 'telegram', 'channel_audit', 'abdul', 'Channel Audit post, with a short TikTok version', 'Growth Plan §07 weekly'),
  ('channel_weekly', 5, '18:00', 'telegram', 'scorecard', 'auto', 'Weekly scorecard image generated from the board: trades, strict win rate, total R', 'Growth Plan §07 weekly'),
  ('channel_weekly', 6, '12:00', 'telegram', 'offer', 'jack', 'Offer post (one per week): the ladder, a trial, or a member result with permission', 'Growth Plan §07 weekly'),
  ('channel_weekly', 7, '20:00', 'telegram', 'outlook', 'jack', 'Weekly outlook: gold levels and the big events ahead (about 45 min)', 'Growth Plan §07 weekly');

-- Lives (Telegram video chat until ~1,000 TikTok followers)
insert into public.calendar_slots (kind, dow, time_local, platform, pillar, topic, who, notes, source) values
  ('live', 1, '20:30', 'tiktok', 'map_recap', 'NY Session Live', 'jack', '20:30-21:30; see live_runsheets.ny_session', 'FYP §06'),
  ('live', 3, '20:30', 'tiktok', 'map_recap', 'NY Session Live', 'jack', '20:30-21:30; once a month replaced by the Channel Audit Live', 'FYP §06'),
  ('live', 4, '20:30', 'tiktok', 'map_recap', 'NY Session Live', 'jack', '20:30-21:30', 'FYP §06'),
  ('live', 7, '21:00', 'tiktok', 'map_recap', 'Sunday Weekly Outlook Live', 'jack', '21:00-21:45; recording saved for YouTube from Q2 2027', 'FYP §06');

-- ===========================================================================
-- live_runsheets — the three live formats (FYP §06)
-- ===========================================================================
insert into public.live_runsheets (key, name, cadence, start_time, end_time, segments, rules, notes) values
  ('ny_session', 'NY Session Live', 'Mon, Wed, Thu', '20:30', '21:30',
   '[{"from_min": 0, "to_min": 3, "what": "Warm-up. Chart on screen, map levels drawn. Pin the comment with the channel link.", "say": "We''re live for the NY open. Type where you think gold goes: UP or DOWN."},
     {"from_min": 3, "to_min": 10, "what": "Today''s plan: zones, bias, what would change your mind. News in the next hour.", "say": "If price holds above this zone, I look for buys. If it breaks, I stand aside."},
     {"from_min": 10, "to_min": 35, "what": "Wait and watch. Explain what you see candle by candle. Take a trade or skip it out loud.", "say": "No setup yet. Waiting is part of the job."},
     {"from_min": 35, "to_min": 45, "what": "Viewer Q&A from comments. Answer beginner questions properly.", "say": "Good question. Stop loss goes here, and here''s why."},
     {"from_min": 45, "to_min": 55, "what": "Recap the session. If a signal fired in the channel, show the card and its status.", "say": "This is the exact card channel members got 20 minutes ago."},
     {"from_min": 55, "to_min": 60, "what": "Close: tomorrow''s map time, one soft mention of the bot or a tool trial.", "say": "Map drops at 8am tomorrow. Link''s pinned. Trade safe."}]',
   '["Say education only, not financial advice at the start and once in the middle.", "No account balances, no join now or miss out, no promises about results.", "Never take trade instructions or payments in live comments. Point people to the bot.", "Pin one comment: channel link and type MAP to get tomorrow''s map.", "One trusted member moderates.", "Jack never DMs you first and never asks for money in DMs."]',
   'Best 60 seconds goes to TikTok as a short.'),
  ('sunday_outlook', 'Sunday Weekly Outlook', 'Sunday', '21:00', '21:45',
   '[{"from_min": 0, "to_min": 5, "what": "Welcome, last week''s scorecard on screen: trades, strict win rate, total R. Wins and losses."},
     {"from_min": 5, "to_min": 20, "what": "Gold weekly levels from high timeframe down. Where you''d buy, sell or wait."},
     {"from_min": 20, "to_min": 30, "what": "The week''s calendar: CPI, NFP, FOMC, central bank speeches. What each could do to gold."},
     {"from_min": 30, "to_min": 40, "what": "Q&A."},
     {"from_min": 40, "to_min": 45, "what": "Close with one lesson for the week and the channel link. Save the recording for YouTube."}]',
   '["Same live rules as the NY session.", "Save the recording: YouTube long-form weekly outlook from Q2 2027."]',
   'Pairs with the Sunday outlook post (template 8).'),
  ('channel_audit_live', 'Channel Audit Live', 'once a month, replaces one NY live', '20:30', '21:15',
   '[{"from_min": 0, "to_min": 5, "what": "Topic of the night, for example Is a 90% win rate possible?"},
     {"from_min": 5, "to_min": 25, "what": "Build a simple spreadsheet live: how hiding losses or moving stops changes the number."},
     {"from_min": 25, "to_min": 40, "what": "Viewers drop screenshots of offers they''ve seen (names hidden). You score them against the red-flag list."},
     {"from_min": 40, "to_min": 45, "what": "Show EzyMap''s pledge and scorecard. Invite people to watch the channel for a month before deciding anything."}]',
   '["Never name a channel; names hidden on every screenshot.", "Same live rules as the NY session."]',
   null)
on conflict (key) do update set name = excluded.name, cadence = excluded.cadence, start_time = excluded.start_time, end_time = excluded.end_time, segments = excluded.segments, rules = excluded.rules, notes = excluded.notes;

-- ===========================================================================
-- mod_rules — starter moderation (UPGRADE-PLAN §5, §9.I.72–75)
-- ===========================================================================
insert into public.mod_rules (key, kind, lang, patterns, params, action, applies_to, notes) values
  ('scam_keywords_en', 'keyword', 'en',
   array['account manager', 'dm me for signals', 'guaranteed profit', 'sure profit', 'sure win', 'deposit to unlock', 'vip signals', 'double your money', 'recovery expert', 'investment manager', 'send me your login', 'passive income', 'risk-free', 'binary options', 'forex mentor dm'],
   '{"match": "substring", "case_insensitive": true}', 'warn_mute_ban', 'both', 'Warn → mute → ban on repeat. Patterns from the Posting Kit banned list and the FYP scam notes.'),
  ('scam_keywords_ms', 'keyword', 'ms',
   array['pasti untung', 'confirm untung', 'jamin untung', 'modal balik', 'deposit dulu', 'pm saya untuk signal', 'untung berganda', 'tanpa risiko', 'pengurus akaun', 'duit cepat'],
   '{"match": "substring", "case_insensitive": true}', 'warn_mute_ban', 'both', 'BM scam phrases.'),
  ('link_block_new_members', 'link_block', 'both',
   array['https?://', 't\.me/', 'wa\.me/', '@[A-Za-z0-9_]{5,}'],
   '{"new_member_hours": 24, "allow_domains": ["t.me/ezymap", "t.me/EzyRegisterBot", "printezy.money"], "regex": true}', 'delete', 'both', 'Members younger than 24 h cannot post links or handles. Allowed domains pass.'),
  ('flood', 'flood', 'both', array[]::text[],
   '{"max_msgs": 5, "window_s": 10, "mute_minutes": 10}', 'mute', 'both', 'Flood control: more than 5 messages in 10 seconds → mute.'),
  ('impersonation', 'impersonation', 'both',
   array['jack', 'ezymap', 'ezyregister', 'sarah', 'ezy map', 'ezymap admin', 'ezymap support'],
   '{"match": "name_or_username", "min_account_age_days": 30}', 'flag', 'both', 'New accounts using Jack or EzyMap names get flagged for Jack (§9.I.74).'),
  ('cas_check', 'cas', 'both', array[]::text[],
   '{"source": "cas.chat", "on_join": true}', 'ban', 'both', 'CAS check on join (§5).'),
  ('join_captcha', 'captcha', 'both', array[]::text[],
   '{"flow": "join_request", "timeout_minutes": 10}', 'flag', 'both', 'Join captcha through Telegram''s join-request flow (§9.I.73).'),
  ('repeat_question', 'repeat_question', 'both', array[]::text[],
   '{"window_days": 14, "min_similarity": 0.8}', 'flag', 'both', 'A question asked twice gets proposed for Sarah''s reply sheet (§9.I.75).')
on conflict (key) do update set kind = excluded.kind, lang = excluded.lang, patterns = excluded.patterns, params = excluded.params, action = excluded.action, applies_to = excluded.applies_to, notes = excluded.notes;

-- The ops bot matches one `pattern` per rule with new RegExp(pattern, "i"), so a
-- keyword rule carries its phrases as an alternation. `patterns` keeps the
-- readable list for the dashboard. link_block is matched by the bot on the
-- message's entities, not by regex, so it has no pattern.
update public.mod_rules
   set pattern = case
     when kind = 'keyword' then array_to_string(patterns, '|')
     when kind = 'impersonation' then '\b(jack|ezymap|ezyregister|sarah|ezy map)\b'
     else null
   end
 where kind in ('keyword', 'impersonation');

-- ===========================================================================
-- benchmarks — the five reference channels (decisions 5 and 12, §4.10).
-- Handles are an open question (§16.1). Never named in posts, never fed to the AI.
-- ===========================================================================
insert into public.benchmarks (name, platform, handle, audience_tier, is_usual_ib, note, source) values
  ('44fx', 'telegram', null, 'high_capital', false, 'targets big-deposit audiences; not usual IB', 'manual'),
  ('Callisto Fx', 'telegram', null, 'high_capital', false, 'targets big-deposit audiences; not usual IB', 'manual'),
  ('Orient Fx', 'telegram', null, 'high_capital', false, 'targets big-deposit audiences; not usual IB', 'manual'),
  ('10X INTERNATIONAL', 'telegram', null, 'high_capital', false, 'targets big-deposit audiences; not usual IB', 'manual'),
  ('GARY GOLD TRADER', 'telegram', null, 'high_capital', false, 'targets big-deposit audiences; not usual IB', 'manual')
on conflict (name, platform) do update set audience_tier = excluded.audience_tier, is_usual_ib = excluded.is_usual_ib, note = excluded.note;

-- ===========================================================================
-- platform_accounts — names of Vault secrets only; no tokens (§9.A.6)
-- ===========================================================================
insert into public.platform_accounts (platform, handle, vault_secret_name, scopes, daily_limit, meta) values
  ('telegram', '@EzyOps_bot', 'tg_ops_bot_token', array['post', 'edit', 'delete'], null, '{"role": "channel admin: Post, Edit, Delete only; Desk group member", "status": "CONFIRM bot name and create in @BotFather"}'),
  ('instagram', null, 'meta_ig_token', array['instagram_content_publish'], 100, '{"status": "Meta app Live with Standard Access (Phase 3)"}'),
  ('facebook', null, 'meta_page_token', array['pages_manage_posts'], 30, '{"status": "Phase 3"}'),
  ('threads', null, 'threads_token', array['threads_content_publish'], 250, '{"status": "Phase 3"}'),
  ('youtube', null, 'youtube_oauth', array['youtube.upload'], null, '{"status": "publish kit until Google audit passes (Phase 3)"}'),
  ('tiktok', null, null, array[]::text[], null, '{"status": "manual via publish kit (decision 8)"}'),
  ('x', null, null, array[]::text[], null, '{"status": "manual unless Jack accepts about $0.015 per post"}')
on conflict (platform, handle) do update set vault_secret_name = excluded.vault_secret_name, scopes = excluded.scopes, daily_limit = excluded.daily_limit, meta = excluded.meta;

commit;
