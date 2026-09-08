import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";

import { RequestManager } from "./state/RequestManager";
import { searchHotels } from "./tools/hotel";
import { searchRestaurants } from "./tools/restaurant";
import { searchWeb } from "./tools/webSearch";
import { understandUser } from "./ai";

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
 * Send the final response from the AI agent.
 */
function sendAgentResponse(
  socket: WebSocket,
  generation: number,
  reply: string
) {
  sendEvent(socket, "AGENT_RESPONSE", {
    generation,
    reply,
  });

  console.log(`🤖 AGENT: "${reply}"`);
}

/**
 * Handle a complete voice request.
 *
 * Flow:
 *
 * USER_SPOKE
 *      ↓
 * Gemini understands request
 *      ↓
 * Select tool
 *      ↓
 * Tool executes
 *      ↓
 * Result returned
 *      ↓
 * AGENT_RESPONSE
 */
async function handleUserRequest(
  socket: WebSocket,
  text: string
) {
  console.log("");
  console.log("════════════════════════════════");
  console.log(`🗣️ USER: "${text}"`);
  console.log("════════════════════════════════");

  /*
   * Start a new generation immediately.
   *
   * This makes the previous request obsolete.
   */
  const generation =
    requestManager.startRequest();

  sendEvent(socket, "REQUEST_STARTED", {
    generation,
    text,
  });

  try {
    /*
     * STEP 1
     *
     * Ask Gemini what the user wants.
     */
    console.log("🧠 Asking Gemini...");

    const understanding =
      await understandUser(text);

    /*
     * Check whether the user interrupted
     * while Gemini was thinking.
     */
    if (
      !requestManager.isCurrent(
        generation
      )
    ) {
      console.log(
        `⚠️ Gemini result became stale | Generation ${generation}`
      );

      sendEvent(
        socket,
        "STALE_RESULT",
        {
          generation,
          message:
            "AI understanding became obsolete",
        }
      );

      return;
    }

    console.log(
      "🧠 Gemini understanding:",
      understanding
    );

    sendEvent(
      socket,
      "AI_UNDERSTOOD",
      {
        generation,
        intent: understanding.intent,
        query: understanding.query,
        city: understanding.city ?? null,
        reply: understanding.reply,
      }
    );

    /*
     * STEP 2
     *
     * Decide which tool should execute.
     */
    switch (understanding.intent) {
      /*
       * ═══════════════════════════════
       * HOTEL SEARCH
       * ═══════════════════════════════
       */
      case "hotel_search": {
        const city =
          understanding.city || "Hyderabad";

        console.log(
          `🏨 HOTEL REQUEST: ${understanding.query}`
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
          `🔎 TOOL: hotel_search(${city})`
        );

        const hotels =
          await searchHotels(city);

        /*
         * User may have spoken again
         * while hotel search was running.
         */
        if (
          !requestManager.isCurrent(
            generation
          )
        ) {
          console.log(
            `⚠️ HOTEL RESULT STALE | ${city}`
          );

          sendEvent(
            socket,
            "STALE_RESULT",
            {
              generation,
              city,
              tool: "hotel_search",
            }
          );

          return;
        }

        console.log(
          `✅ HOTEL RESULT | ${city} | Generation ${generation}`
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

        /*
         * Create a natural agent response.
         */
        const cheapest =
          hotels.length > 0
            ? hotels.reduce((lowest, hotel) =>
                hotel.price < lowest.price
                  ? hotel
                  : lowest
              )
            : null;

        let hotelReply =
          `I found ${hotels.length} hotels in ${city}.`;

        if (cheapest) {
          hotelReply +=
            ` The cheapest option is ${cheapest.name} at ₹${cheapest.price}.`;
        }

        sendAgentResponse(
          socket,
          generation,
          hotelReply
        );

        break;
      }

      /*
       * ═══════════════════════════════
       * RESTAURANT SEARCH
       * ═══════════════════════════════
       */
      case "restaurant_search": {
        const city =
          understanding.city || "Hyderabad";

        console.log(
          `🍽️ RESTAURANT REQUEST: ${understanding.query}`
        );

        sendEvent(
          socket,
          "TOOL_STARTED",
          {
            generation,
            tool: "restaurant_search",
            city,
          }
        );

        console.log(
          `🔎 TOOL: restaurant_search(${city})`
        );

        const restaurants =
          await searchRestaurants(
            city,
            understanding.query
          );

        /*
         * Check for interruption.
         */
        if (
          !requestManager.isCurrent(
            generation
          )
        ) {
          console.log(
            `⚠️ RESTAURANT RESULT STALE | ${city}`
          );

          sendEvent(
            socket,
            "STALE_RESULT",
            {
              generation,
              city,
              tool: "restaurant_search",
            }
          );

          return;
        }

        console.log(
          `✅ RESTAURANT RESULT | ${city} | Generation ${generation}`
        );

        sendEvent(
          socket,
          "TOOL_RESULT",
          {
            generation,
            tool: "restaurant_search",
            city,
            restaurants,
          }
        );

        /*
         * Natural response.
         */
        let restaurantReply =
          `I found ${restaurants.length} restaurants in ${city}.`;

        if (restaurants.length > 0) {
          restaurantReply +=
            ` One option is ${restaurants[0].name}, serving ${restaurants[0].cuisine}.`;
        }

        sendAgentResponse(
          socket,
          generation,
          restaurantReply
        );

        break;
      }

      /*
       * ═══════════════════════════════
       * WEB SEARCH
       * ═══════════════════════════════
       */
      case "web_search": {
        console.log(
          `🌐 WEB SEARCH REQUEST: ${understanding.query}`
        );

        sendEvent(
          socket,
          "TOOL_STARTED",
          {
            generation,
            tool: "web_search",
            query: understanding.query,
          }
        );

        console.log(
          `🌐 TOOL: web_search("${understanding.query}")`
        );

        const webResult =
          await searchWeb(
            understanding.query
          );

        /*
         * Check for interruption.
         */
        if (
          !requestManager.isCurrent(
            generation
          )
        ) {
          console.log(
            `⚠️ WEB RESULT STALE | Generation ${generation}`
          );

          sendEvent(
            socket,
            "STALE_RESULT",
            {
              generation,
              tool: "web_search",
            }
          );

          return;
        }

        console.log(
          `✅ WEB RESULT | Generation ${generation}`
        );

        sendEvent(
          socket,
          "TOOL_RESULT",
          {
            generation,
            tool: "web_search",
            answer: webResult.answer,
            sources:
              webResult.sources,
          }
        );

        /*
         * Send the actual web answer
         * back to the frontend.
         */
        sendAgentResponse(
          socket,
          generation,
          webResult.answer
        );

        break;
      }

      /*
       * ═══════════════════════════════
       * GENERAL QUESTION
       * ═══════════════════════════════
       */
      case "general_question": {
        console.log(
          `💬 GENERAL QUESTION: ${understanding.query}`
        );

        /*
         * For Phase 1, Gemini's understanding
         * gives us the response.
         *
         * Later we can add a dedicated
         * conversational response generation
         * layer.
         */
        sendEvent(
          socket,
          "GENERAL_RESPONSE",
          {
            generation,
            query: understanding.query,
          }
        );

        sendAgentResponse(
          socket,
          generation,
          understanding.reply
        );

        break;
      }

      default: {
        console.log(
          "⚠️ Unknown intent:",
          understanding.intent
        );

        sendAgentResponse(
          socket,
          generation,
          "I'm not sure how to help with that yet."
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ REQUEST FAILED:",
      error
    );

    /*
     * Don't crash the server.
     */
    sendEvent(
      socket,
      "AGENT_ERROR",
      {
        generation,
        message:
          "Sorry, something went wrong while processing your request.",
      }
    );

    sendAgentResponse(
      socket,
      generation,
      "Sorry, I couldn't complete that request."
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
           * Main voice-agent path.
           */
          if (
            data.type ===
            "USER_SPOKE"
          ) {
            if (
              typeof data.text !==
                "string" ||
              !data.text.trim()
            ) {
              console.log(
                "❌ Invalid USER_SPOKE event"
              );

              return;
            }

            handleUserRequest(
              socket,
              data.text.trim()
            );

            return;
          }

          /*
           * USER INTERRUPTED
           *
           * Immediately make the
           * current generation obsolete.
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
           * Unknown events.
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