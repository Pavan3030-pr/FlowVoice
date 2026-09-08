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

export type AgentIntent =
  | "hotel_search"
  | "restaurant_search"
  | "web_search"
  | "general_question";

export type AgentUnderstanding = {
  intent: AgentIntent;
  query: string;
  city?: string;
  reply: string;
};

export async function understandUser(
  userText: string
): Promise<AgentUnderstanding> {
  const prompt = `
You are the intelligence layer of FlowVoice,
a voice-first AI assistant.

Understand the user's request and decide which
capability FlowVoice should use.

Available intents:

1. hotel_search
   Use when the user wants hotels or accommodation.

2. restaurant_search
   Use when the user wants restaurants, food places,
   cafes, dining, or places to eat.

3. web_search
   Use when the user needs current information,
   news, technology news, recent events, prices,
   facts that may have changed, or information
   that should be searched on the internet.

4. general_question
   Use for general conversational or educational
   questions that do not require live web information.

IMPORTANT:

- Understand corrections naturally.
- If the user says:
  "Find hotels in Bangalore, no actually Hyderabad"
  the city must be Hyderabad.
- If multiple cities are mentioned and the user
  clearly corrects the first one, use the corrected city.
- Keep the reply short and natural because it will
  eventually be spoken aloud.
- Do not answer the user's question yourself.
- Return ONLY valid JSON.
- Do not use markdown.
- Do not wrap the JSON in code fences.

Return exactly this structure:

{
  "intent": "hotel_search | restaurant_search | web_search | general_question",
  "query": "the useful search/request query",
  "city": "city if relevant",
  "reply": "short natural response"
}

User request:

"${userText}"
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  const rawText =
    response.text?.trim() ?? "";

  console.log(
    "🤖 Gemini raw response:",
    rawText
  );

  let cleaned = rawText;

  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  try {
    const parsed =
      JSON.parse(cleaned) as AgentUnderstanding;

    if (!parsed.intent) {
      throw new Error(
        "Gemini response is missing intent"
      );
    }

    if (!parsed.query) {
      parsed.query = userText;
    }

    if (!parsed.reply) {
      parsed.reply =
        "I'll take care of that.";
    }

    console.log(
      "🧠 Gemini understanding:",
      parsed
    );

    return parsed;
  } catch (error) {
    console.error(
      "❌ Failed to parse Gemini response:",
      error
    );

    /*
     * Safe fallback.
     *
     * If Gemini returns something unexpected,
     * FlowVoice can still continue instead of
     * crashing the backend.
     */
    return {
      intent: "general_question",
      query: userText,
      reply:
        "I'll look into that for you.",
    };
  }
}