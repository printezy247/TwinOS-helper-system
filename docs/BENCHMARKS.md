# Reference channels — what the benchmark pass found (2026-10-06)

The study PHASES line 28 asks for. Method first, because it decides how much
can be known: every number here comes from the same place the weekly
`twinos-benchmarks` cron has read since Phase 4 — a channel's **public preview
page** (`t.me/s/<handle>`), which publishes a subscriber count, recent posts and
their view counts. Nothing new is scraped and no account is used.

## What is measurable today

`metrics/benchmarks` run on 6 Oct 2026. Two of the seven channels publish a
subscriber counter, so only two can be measured:

| Channel | Members | Avg views | View rate | Posts/day |
|---|---|---|---|---|
| Callisto Fx | 133,000 | 2,368 | **1.80%** | 13.0 |
| 44fx | 21,900 | 952 | **4.30%** | 15.0 |

The other five — SandyFx, 10X INTERNATIONAL, bengoldtrader, vexaflowai, Orient Fx
— returned nothing. Their preview pages carry no subscriber counter, which
usually means the channel is invite-link-only or the handle resolves to a
private channel. A page that will not answer is not a channel that is small.

## What it says

**View rate is the whole story, and it is not tracking size.** Callisto Fx has
six times 44fx's members and less than half its view rate. A big channel is not
a tight one. 44fx's 4.30% is the number to beat on the same kind of content;
TwinOS measures Jack's equivalent in `v_post_engagement` (views-24h ÷ members),
so the comparison is already available per week on the Friday board.

**Both publish 13–15 times a day.** That is the volume a competitor is putting
out to hold attention, and it is the benchmark the posting cadence should be
judged against — not against a target that was invented.

**Nothing here measures what they actually sell.** Member counts and view rates
say how many people look; they say nothing about offer structure, how big
deposits are qualified, or what disclosures they run. Those are columns in
`benchmarks` (`offer_structure`, `qualification_notes`, `disclosures`,
`audience_tier`) and they are Jack's to fill — reading a competitor's offer
means reading their posts as a trader, which is a judgement, not a fetch.

## What is still open

1. **Five channels have no numbers.** Jack can paste them by hand on the
   `benchmarks` rows (`source = 'manual'`, which the schema already allows) and
   the table becomes complete without any fetching at all.
2. **The high-capital ICP note** needs the same manual pass: for each channel,
   which deposits they qualify and how. The columns exist; the judgement does
   not come from a page read.
3. **`is_usual_ib`** is false on Jack's five and unset on the rest — decision 12
   territory, and his call.
