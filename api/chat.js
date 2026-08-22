// api/chat.js
// This is "the kitchen" — the only file where your API key lives.
// It runs on Vercel's servers, never in the visitor's browser.

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ---- your briefing document goes here (placeholder for now) ----
// This is the note you hand the chef before every dish. Replace this
// whole string later with the real, detailed version of your story.
const BRIEFING = `
You are answering, in first person as "I", on behalf of Nihal, a UI/UX
designer, to visitors on his portfolio site. Stay warm, concise, and
specific — 2-4 sentences per answer unless asked for more detail. Never
invent projects, employers, or skills not listed below. If you don't know
something, say so plainly and suggest emailing Nihal directly.

WORK:
- Sibyl (for Huda Beauty): an AI-powered social media analytics platform.
  I redesigned the Content Calendar — a previous vendor's version had been
  rejected by the client. I completed the missing scheduling flow end to
  end, solved a density problem (multiple posts scheduled close together)
  with a three-tier pattern — cluster, expand, side drawer — and connected
  the calendar to the product's existing analytics (notes, content
  comparison, editing published posts). It was approved with no major
  feedback, where the earlier design had been rejected outright.
- I also worked on Sibyl's Post Insights, Sentiment Analysis, and Social
  Overview modules.

PROCESS:
- I start by auditing what exists against real requirements before
  drawing anything new.
- I design on top of existing screens when a system already exists, so
  new work reuses components instead of inventing a new visual language.
- Tools: Figma for design, ChatGPT for early research.

IF ASKED WHO TO CONTACT DIRECTLY: hello@nihal.studio (placeholder — update
this to the real email in the briefing and in chat.html's footer link).
`.trim();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { messages, name, intent, sessionId } = req.body || {};

  // ---- basic guards: keep these even in v1, they're free insurance ----
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "no_messages" });
    return;
  }
  if (messages.length > 20) {
    res.status(400).json({ error: "conversation_too_long" });
    return;
  }
  const lastText = messages[messages.length - 1]?.text || "";
  if (typeof lastText !== "string" || lastText.length > 1000) {
    res.status(400).json({ error: "message_too_long" });
    return;
  }

  try {
    // chat.html stores messages as {role: 'user'|'assistant'|'error', text}
    // Gemini wants {role: 'user'|'model', parts: [{text}]}
    const contents = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.text || "") }],
      }));

    const visitorContext = `\n\nVisitor context: name = ${name || "unknown"}, stated intent = ${intent || "unknown"}.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents,
      config: {
        systemInstruction: BRIEFING + visitorContext,
      },
    });

    const reply = response.text || "Sorry, I couldn't put together an answer just then.";

    // ---- write to the Google Sheet (the notebook) ----
    // Awaited so the write finishes before this function can be shut down —
    // but wrapped so a Sheet failure never breaks the reply to the visitor.
    try {
      await saveToSheet({ sessionId, name, intent, userText: lastText, replyText: reply });
    } catch (err) {
      console.error("sheet write failed:", err);
    }

    res.status(200).json({ reply });
  } catch (err) {
    console.error("chat handler error:", err);
    res.status(500).json({ error: "upstream_failed" });
  }
}

async function saveToSheet({ sessionId, name, intent, userText, replyText }) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  if (!url) {
    console.error("sheet write skipped: SHEETS_WEBHOOK_URL is not set");
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, name, intent, userText, replyText }),
    redirect: "follow",
  });
  // fetch() does NOT throw on a non-2xx response — only on total network
  // failure — so a rejected write would otherwise vanish silently.
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`sheet webhook returned ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  console.log("sheet write ok:", bodyText.slice(0, 200));
}
