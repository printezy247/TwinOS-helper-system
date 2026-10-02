/**
 * A search-article brief for one topic (Phase 7, plan §9.J.85): the title
 * options, the questions people ask as headings, the keywords, and the rules a
 * financial article must keep. Built from autocomplete suggestions already in
 * `queries`; nobody writes the article here, the brief is for a person (or
 * ABDUL) to write from, and Jack to review. Malay (BM) first.
 */
import { isQuestion } from "./moderation.ts";

export interface ArticleBrief {
  lang: "en" | "ms";
  titles: string[];
  questions: string[];
  keywords: string[];
  text: string;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function articleBrief(p: { topic: string; lang: "en" | "ms"; queries: string[] }): ArticleBrief {
  const queries: string[] = [];
  for (const q of p.queries) {
    const t = q.trim();
    if (t && !queries.includes(t)) queries.push(t);
  }
  const questions = queries.filter((q) => isQuestion(q)).slice(0, 8);
  const keywords = queries.slice(0, 8);
  const topic = cap(p.topic.trim());
  const ms = p.lang === "ms";
  const titles = ms
    ? [`${topic}: panduan untuk pemula`, `${topic} dengan selamat: apa yang perlu diketahui`, `${topic}: soalan lazim dijawab`]
    : [`${topic} for beginners: a plain guide`, `${topic}: what to know before you start`, `${topic}: your questions answered`];

  const rules = ms
    ? [
      "Letakkan risk line (risiko) dalam perenggan pertama: bukan nasihat kewangan, urus risiko sendiri.",
      "Tiada jaminan: never promise profit or results. No win rates, no prices or levels unless they come from the results board.",
      "One call to action, at the end. Disclose the IB link if the article links to a broker.",
      "Write in plain Bahasa Malaysia; keep English trading terms (stop loss, lot) as people search them.",
    ]
    : [
      "Put the risk line in the first paragraph: not financial advice, manage your own risk.",
      "No guaranteed claims: never promise profit or results. No win rates, prices or levels unless they come from the results board.",
      "One call to action, at the end. Disclose the IB link if the article links to a broker.",
    ];
  const outline = questions.length
    ? questions.map((q, i) => `${i + 1}. ${q}`)
    : ["(No autocomplete suggestions found for this topic: build the outline from the persona's own questions.)"];

  const text = [
    `Article brief (${ms ? "Bahasa Malaysia" : "English"}): ${topic}`,
    "",
    "Title options:",
    ...titles.map((t) => `- ${t}`),
    "",
    "Headings from what people ask:",
    ...outline,
    "",
    keywords.length ? `Keywords: ${keywords.join("; ")}` : "Keywords: none yet (no suggestions)",
    "",
    "Length: 1,200 to 1,500 words, answer the question in the first 100 words.",
    "",
    "Rules:",
    ...rules.map((r) => `- ${r}`),
    "",
    "Jack reviews before anything is published.",
  ].join("\n");
  return { lang: p.lang, titles, questions, keywords, text };
}
