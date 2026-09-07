import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

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

export async function understandUser(
  text: string
) {
  const prompt = `
You are the AI brain of FlowVoice, a voice-first AI agent.

Understand the user's COMPLETE spoken request.

The user may:
- correct themselves
- change the destination
- ask follow-up questions
- speak naturally
- mention multiple cities
- change their mind in the same sentence

Supported cities:
Hyderabad, Bangalore, Bengaluru, Chennai, Mumbai, Delhi, Pune.

Return ONLY valid JSON:

{
  "intent": "hotel_search",
  "city": "CITY",
  "reply": "SHORT_NATURAL_RESPONSE"
}

Rules:
- Understand the entire sentence.
- If the user changes their mind, use the LATEST intended city.
- "actually", "instead", "no", "wait", "sorry", "rather",
  and similar phrases may indicate a correction.
- Never explain your reasoning.
- Keep the reply short and natural.

User said:
"${text}"
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  const raw = response.text?.trim() ?? "";

  console.log("🤖 Gemini raw response:", raw);

  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error(
      "❌ Gemini returned invalid JSON:",
      raw
    );

    return {
      intent: "hotel_search",
      city: "Hyderabad",
      reply:
        "I'll search for hotels in Hyderabad.",
    };
  }
}