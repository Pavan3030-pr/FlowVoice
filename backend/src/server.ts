import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { RequestManager } from "./state/RequestManager";
import { searchHotels } from "./tools/hotel";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    message: "FlowVoice backend is running!",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "flowvoice-backend",
  });
});

const PORT = 3000;

const server = app.listen(PORT, () => {
  console.log(
    `🚀 FlowVoice backend running on http://localhost:${PORT}`
  );
});

const wss = new WebSocketServer({ server });

const requestManager = new RequestManager();

function sendEvent(
  socket: WebSocket,
  type: string,
  data: Record<string, unknown> = {}
) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      type,
      ...data,
    })
  );
}

/**
 * Extract the user's intended city.
 *
 * Examples:
 *
 * "find hotels in Hyderabad"
 * → Hyderabad
 *
 * "find hotels in Hyderabad actually Bangalore"
 * → Bangalore
 *
 * "Hyderabad no actually in Bangalore"
 * → Bangalore
 *
 * "search Delhi instead of Mumbai"
 * → Mumbai
 *
 * "find hotels in Chennai"
 * → Chennai
 */
function extractCity(text: string): string {
  const cities = [
    "Hyderabad",
    "Bangalore",
    "Bengaluru",
    "Chennai",
    "Mumbai",
    "Delhi",
    "Pune",
  ];

  const lowerText = text.toLowerCase();

  /*
   * STEP 1
   *
   * Look for correction language.
   *
   * If the user says:
   *
   * "actually Bangalore"
   * "no actually Bangalore"
   * "Bangalore instead"
   *
   * we want the city AFTER the correction.
   */
  const correctionPatterns = [
    "no actually",
    "actually",
    "instead",
    "rather",
    "make that",
    "change that to",
    "wait",
    "sorry",
    "no",
  ];

  let correctionPosition = -1;
  let correctionLength = 0;

  for (const phrase of correctionPatterns) {
    const position = lowerText.lastIndexOf(phrase);

    if (position > correctionPosition) {
      correctionPosition = position;
      correctionLength = phrase.length;
    }
  }

  /*
   * If a correction phrase exists,
   * search for a city AFTER it.
   */
  if (correctionPosition !== -1) {
    const afterCorrection = lowerText.slice(
      correctionPosition + correctionLength
    );

    let correctedCity = "";

    let correctedCityPosition = -1;

    for (const city of cities) {
      const position = afterCorrection.lastIndexOf(
        city.toLowerCase()
      );

      if (position > correctedCityPosition) {
        correctedCityPosition = position;
        correctedCity = city;
      }
    }

    if (correctedCity) {
      return correctedCity;
    }
  }

  /*
   * STEP 2
   *
   * No correction detected.
   *
   * If multiple cities exist in the sentence,
   * use the LAST city mentioned.
   *
   * Example:
   *
   * "Hyderabad then Bangalore"
   *
   * → Bangalore
   */
  let lastCity = "Hyderabad";
  let lastCityPosition = -1;

  for (const city of cities) {
    const position = lowerText.lastIndexOf(
      city.toLowerCase()
    );

    if (position > lastCityPosition) {
      lastCityPosition = position;
      lastCity = city;
    }
  }

  return lastCity;
}

/**
 * Handle a complete voice request.
 */
async function handleUserRequest(
  socket: WebSocket,
  text: string
) {
  console.log(
    `🗣️ USER REQUEST: "${text}"`
  );

  const city = extractCity(text);

  console.log(
    `🧠 UNDERSTOOD CITY: ${city}`
  );

  /*
   * Every new request receives a new generation.
   *
   * This is what allows FlowVoice to discard
   * old/stale tool results.
   */
  const generation =
    requestManager.startRequest();

  sendEvent(
    socket,
    "REQUEST_STARTED",
    {
      generation,
      text,
      city,
    }
  );

  sendEvent(
    socket,
    "TOOL_STARTED",
    {
      generation,
      tool: "hotel_search",
      city,
    }
  );

  console.log(
    `🔎 Searching hotels in ${city}...`
  );

  try {
    const hotels =
      await searchHotels(city);

    /*
     * IMPORTANT:
     *
     * The user may have spoken again
     * while the hotel search was running.
     *
     * If that happened, this generation
     * is no longer current.
     *
     * Therefore DO NOT show this result.
     */
    if (
      !requestManager.isCurrent(
        generation
      )
    ) {
      console.log(
        `❌ STALE RESULT: ${city} | Generation ${generation}`
      );

      sendEvent(
        socket,
        "STALE_RESULT",
        {
          generation,
          city,
        }
      );

      return;
    }

    /*
     * Current result is valid.
     */
    console.log(
      `✅ CURRENT RESULT: ${city} | Generation ${generation}`
    );

    sendEvent(
      socket,
      "TOOL_RESULT",
      {
        generation,
        tool: "hotel_search",
        city,
        hotels,
      }
    );
  } catch (error) {
    console.error(
      "❌ Hotel search failed:",
      error
    );

    sendEvent(
      socket,
      "TOOL_ERROR",
      {
        generation,
        tool: "hotel_search",
        city,
        message:
          "Hotel search failed",
      }
    );
  }
}

/**
 * WebSocket connection.
 */
wss.on(
  "connection",
  (socket) => {
    console.log(
      "🔌 WebSocket client connected"
    );

    sendEvent(
      socket,
      "CONNECTED",
      {
        message:
          "FlowVoice realtime connection established",
      }
    );

    socket.on(
      "message",
      (message) => {
        try {
          const data =
            JSON.parse(
              message.toString()
            );

          console.log(
            "📩 Event received:",
            data
          );

          /*
           * USER SPOKE
           *
           * This is the main voice-agent path.
           */
          if (
            data.type ===
            "USER_SPOKE"
          ) {
            if (
              typeof data.text !==
              "string"
            ) {
              console.log(
                "❌ Invalid USER_SPOKE event"
              );

              return;
            }

            handleUserRequest(
              socket,
              data.text
            );

            return;
          }

          /*
           * USER INTERRUPTED
           *
           * Make the previous generation
           * obsolete immediately.
           */
          if (
            data.type ===
            "USER_INTERRUPTED"
          ) {
            const generation =
              requestManager.interrupt();

            console.log(
              `🛑 Request interrupted → Generation ${generation}`
            );

            sendEvent(
              socket,
              "USER_INTERRUPTED",
              {
                generation,
                message:
                  "Previous request is now obsolete",
              }
            );

            return;
          }

          /*
           * We don't need the frontend
           * to manually start requests.
           *
           * Voice → USER_SPOKE →
           * backend starts the request.
           */

          console.log(
            `ℹ️ Ignored event type: ${data.type}`
          );
        } catch (error) {
          console.error(
            "❌ Invalid WebSocket message:",
            error
          );
        }
      }
    );

    socket.on(
      "close",
      () => {
        console.log(
          "🔌 WebSocket client disconnected"
        );
      }
    );

    socket.on(
      "error",
      (error) => {
        console.error(
          "❌ WebSocket error:",
          error
        );
      }
    );
  }
);