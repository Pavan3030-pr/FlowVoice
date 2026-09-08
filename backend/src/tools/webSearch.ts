import { GoogleGenAI } from "@google/genai";

import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    "GEMINI_API_KEY is missing from backend/.env"
  );
}

const ai = new GoogleGenAI({
  apiKey,
});

export type WebSearchResult = {
  answer: string;
  sources: {
    title: string;
    url: string;
  }[];
};

export async function searchWeb(
  query: string
): Promise<WebSearchResult> {
  console.log(`🌐 WEB SEARCH: "${query}"`);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `
You are the web research engine for FlowVoice.

Search the internet and answer the user's request using
current, reliable information.

User request:
${query}

Rules:
- Use Google Search grounding.
- Prefer recent and trustworthy information.
- Keep the answer concise because it will be spoken aloud.
- Do not invent facts.
- If the information is uncertain, say so.
`,
    config: {
      tools: [
        {
          googleSearch: {},
        },
      ],
    },
  });

  const answer =
    response.text?.trim() ||
    "I couldn't find a useful answer.";

  const sources: {
    title: string;
    url: string;
  }[] = [];

  const groundingMetadata =
    response.candidates?.[0]?.groundingMetadata;

  const chunks =
    groundingMetadata?.groundingChunks ?? [];

  for (const chunk of chunks) {
    const web = chunk.web;

    if (!web?.uri) {
      continue;
    }

    sources.push({
      title: web.title || web.uri,
      url: web.uri,
    });
  }

  console.log("🌐 WEB ANSWER:", answer);

  console.log(
    `🔗 SOURCES FOUND: ${sources.length}`
  );

  return {
    answer,
    sources,
  };
}