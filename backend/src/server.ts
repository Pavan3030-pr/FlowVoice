import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { RequestManager } from "./state/RequestManager";
import { searchHotels } from "./tools/hotel";
import { understandUser } from "./ai";

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

async function handleUserRequest(
  socket: WebSocket,
  text: string
) {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`🗣️ USER SAID: "${text}"`);
  console.log("🧠 Sending request to Gemini...");

  /*
   * STEP 1
   * Ask Gemini to understand the COMPLETE sentence.
   */
  let understanding;

  try {
    understanding = await understandUser(text);

    console.log(
      "🤖 GEMINI UNDERSTANDING:",
      understanding
    );
  } catch (error) {
    console.error(
      "❌ Gemini understanding failed:",
      error
    );

    sendEvent(socket, "AI_ERROR", {
      message: "AI understanding failed",
    });

    return;
  }

  /*
   * STEP 2
   * Get the city understood by Gemini.
   */
  const city =
    typeof understanding.city === "string"
      ? understanding.city
      : "Hyderabad";

  const reply =
    typeof understanding.reply === "string"
      ? understanding.reply
      : `Searching for hotels in ${city}.`;

  /*
   * STEP 3
   * Start a NEW generation.
   */
  const generation =
    requestManager.startRequest();

  console.log(
    `🟢 NEW REQUEST: Generation ${generation}`
  );

  /*
   * Tell frontend what AI understood.
   */
  sendEvent(socket, "REQUEST_STARTED", {
    generation,
    text,
    city,
    reply,
  });

  /*
   * STEP 4
   * Start hotel search.
   */
  sendEvent(socket, "TOOL_STARTED", {
    generation,
    tool: "hotel_search",
    city,
  });

  console.log(
    `🔎 Searching hotels in ${city}...`
  );

  try {
    const hotels = await searchHotels(city);

    /*
     * STEP 5
     * Check whether the user interrupted
     * this request while the tool was running.
     */
    if (
      !requestManager.isCurrent(
        generation
      )
    ) {
      console.log(
        `❌ STALE RESULT: ${city} | Generation ${generation}`
      );

      sendEvent(socket, "STALE_RESULT", {
        generation,
        city,
      });

      return;
    }

    /*
     * STEP 6
     * Current result is valid.
     */
    console.log(
      `✅ CURRENT RESULT: ${city} | Generation ${generation}`
    );

    sendEvent(socket, "TOOL_RESULT", {
      generation,
      tool: "hotel_search",
      city,
      hotels,
    });

    /*
     * Send AI's natural response.
     */
    sendEvent(socket, "AI_RESPONSE", {
      generation,
      text: reply,
      city,
    });

    console.log(
      `🗣️ AI: "${reply}"`
    );

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } catch (error) {
    console.error(
      "❌ Hotel search failed:",
      error
    );

    sendEvent(socket, "TOOL_ERROR", {
      generation,
      tool: "hotel_search",
      city,
      message: "Hotel search failed",
    });
  }
}

wss.on("connection", (socket) => {
  console.log(
    "🔌 WebSocket client connected"
  );

  sendEvent(socket, "CONNECTED", {
    message:
      "FlowVoice realtime connection established",
  });

  socket.on("message", (message) => {
    try {
      const data = JSON.parse(
        message.toString()
      );

      console.log(
        "📩 Event received:",
        data
      );

      /*
       * MAIN VOICE FLOW
       *
       * Frontend sends:
       *
       * USER_SPOKE
       *
       * Backend → Gemini
       * Gemini → intent/city/reply
       * Backend → hotel tool
       */
      if (
        data.type === "USER_SPOKE"
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
       * INTERRUPTION
       *
       * Immediately invalidate
       * the current generation.
       */
      if (
        data.type ===
        "USER_INTERRUPTED"
      ) {
        const generation =
          requestManager.interrupt();

        console.log(
          `🛑 REQUEST INTERRUPTED → Generation ${generation}`
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

      console.log(
        `ℹ️ Ignored event type: ${data.type}`
      );
    } catch (error) {
      console.error(
        "❌ Invalid WebSocket message:",
        error
      );
    }
  });

  socket.on("close", () => {
    console.log(
      "🔌 WebSocket client disconnected"
    );
  });

  socket.on("error", (error) => {
    console.error(
      "❌ WebSocket error:",
      error
    );
  });
});