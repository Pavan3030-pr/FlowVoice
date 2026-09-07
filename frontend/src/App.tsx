import { useEffect, useRef, useState } from "react";

type Hotel = {
  name: string;
  city: string;
  price: number;
};

type FlowEvent = {
  type: string;
  generation?: number;
  city?: string;
  text?: string;
  tool?: string;
  hotels?: Hotel[];
};

type SpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

interface SpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const activeRequestRef = useRef(false);
  const shouldListenRef = useRef(false);
  const listeningRef = useRef(false);
  const restartingRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [activated, setActivated] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const [generation, setGeneration] =
    useState<number | null>(null);

  const [transcript, setTranscript] =
    useState("");

  const [interim, setInterim] =
    useState("");

  const [toolStatus, setToolStatus] =
    useState("");

  const [hotels, setHotels] =
    useState<Hotel[]>([]);

  const [events, setEvents] =
    useState<string[]>([]);

  function addEvent(event: string) {
    setEvents((previous) =>
      [...previous, event].slice(-20)
    );
  }

  function createRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      addEvent("SPEECH_RECOGNITION_UNSUPPORTED");
      return null;
    }

    const recognition =
      new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onstart = () => {
      listeningRef.current = true;
      restartingRef.current = false;

      setIsListening(true);

      addEvent("MICROPHONE_STARTED");
    };

    recognition.onresult = (
      event: SpeechRecognitionEvent
    ) => {
      let finalText = "";
      let interimText = "";

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        const text =
          event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalText += text;
        } else {
          interimText += text;
        }
      }

      if (interimText.trim()) {
        setInterim(interimText.trim());
      }

      if (!finalText.trim()) {
        return;
      }

      const spokenText =
        finalText.trim();

      setTranscript(spokenText);
      setInterim("");

      addEvent(
        `USER_SPOKE → "${spokenText}"`
      );

      const socket =
        socketRef.current;

      if (
        !socket ||
        socket.readyState !==
          WebSocket.OPEN
      ) {
        addEvent(
          "REQUEST_FAILED → WebSocket disconnected"
        );
        return;
      }

      /*
       * VOICE INTERRUPTION
       *
       * If FlowVoice is already processing
       * something, the next thing the user says
       * automatically interrupts it.
       */
      if (activeRequestRef.current) {
        socket.send(
          JSON.stringify({
            type: "USER_INTERRUPTED",
          })
        );

        addEvent(
          "AUTO_INTERRUPT"
        );
      }

      /*
       * Send the new voice request.
       */
      socket.send(
        JSON.stringify({
          type: "USER_SPOKE",
          text: spokenText,
        })
      );

      activeRequestRef.current = true;
    };

    recognition.onerror = (
      error
    ) => {
      console.error(
        "Speech recognition error:",
        error
      );

      listeningRef.current = false;
      setIsListening(false);

      addEvent(
        `MICROPHONE_ERROR → ${
          error?.error ?? "unknown"
        }`
      );
    };

    recognition.onend = () => {
      listeningRef.current = false;
      setIsListening(false);

      addEvent(
        "MICROPHONE_STOPPED"
      );

      /*
       * Automatically start another
       * recognition session.
       */
      if (
        shouldListenRef.current &&
        !restartingRef.current
      ) {
        restartingRef.current = true;

        setTimeout(() => {
          if (
            shouldListenRef.current
          ) {
            try {
              recognition.start();
            } catch {
              restartingRef.current =
                false;
            }
          }
        }, 300);
      }
    };

    return recognition;
  }

  function activateVoice() {
    if (!connected) {
      return;
    }

    if (activated) {
      return;
    }

    shouldListenRef.current = true;

    const recognition =
      createRecognition();

    if (!recognition) {
      return;
    }

    recognitionRef.current =
      recognition;

    try {
      /*
       * IMPORTANT:
       * This happens directly because the user
       * clicked the activation control.
       */
      recognition.start();

      setActivated(true);

      addEvent(
        "VOICE_MODE_ACTIVATED"
      );
    } catch (error) {
      console.error(
        "Could not start recognition:",
        error
      );

      addEvent(
        "MICROPHONE_START_FAILED"
      );
    }
  }

  useEffect(() => {
    const socket =
      new WebSocket(
        "ws://localhost:3000"
      );

    socketRef.current = socket;

    socket.onopen = () => {
      console.log(
        "🔌 Frontend WebSocket connected"
      );

      setConnected(true);

      addEvent("CONNECTED");
    };

    socket.onmessage = (
      event
    ) => {
      const data: FlowEvent =
        JSON.parse(event.data);

      console.log(
        "📨 Backend event:",
        data
      );

      switch (data.type) {
        case "CONNECTED":
          addEvent("CONNECTED");
          break;

        case "REQUEST_STARTED":
          activeRequestRef.current =
            true;

          setGeneration(
            data.generation ?? null
          );

          setToolStatus(
            data.city
              ? `Searching ${data.city}...`
              : "Processing..."
          );

          addEvent(
            `REQUEST_STARTED → Generation ${data.generation}`
          );

          break;

        case "TOOL_STARTED":
          activeRequestRef.current =
            true;

          setToolStatus(
            `Searching hotels in ${data.city}...`
          );

          setHotels([]);

          addEvent(
            `TOOL_STARTED → ${data.city}`
          );

          break;

        case "TOOL_RESULT":
          activeRequestRef.current =
            false;

          setToolStatus(
            `Found hotels in ${data.city}`
          );

          setHotels(
            data.hotels ?? []
          );

          addEvent(
            `TOOL_RESULT → ${data.city}`
          );

          break;

        case "STALE_RESULT":
          addEvent(
            `STALE_RESULT → ${data.city} | Generation ${data.generation}`
          );
          break;

        case "USER_INTERRUPTED":
          activeRequestRef.current =
            false;

          setGeneration(
            data.generation ?? null
          );

          setToolStatus(
            "⚡ Request interrupted"
          );

          addEvent(
            `USER_INTERRUPTED → Generation ${data.generation}`
          );

          break;

        default:
          break;
      }
    };

    socket.onerror = () => {
      setConnected(false);
      addEvent("WEBSOCKET_ERROR");
    };

    socket.onclose = () => {
      setConnected(false);
      addEvent("DISCONNECTED");
    };

    return () => {
      shouldListenRef.current =
        false;

      if (
        recognitionRef.current
      ) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }

      socket.close();
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at 50% 20%, #172033 0%, #070b12 45%, #04060a 100%)",
        color: "#f8fafc",
        fontFamily:
          "Inter, system-ui, sans-serif",
        display: "flex",
        justifyContent: "center",
        padding: "60px 24px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "900px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "50px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "36px",
                fontWeight: 800,
                letterSpacing: "-1.5px",
              }}
            >
              FlowVoice
            </div>

            <div
              style={{
                color: "#94a3b8",
                marginTop: "6px",
              }}
            >
              Voice-first AI agent
            </div>
          </div>

          <div
            style={{
              padding:
                "8px 14px",
              borderRadius: "999px",
              background: connected
                ? "rgba(34,197,94,.12)"
                : "rgba(239,68,68,.12)",
              border:
                "1px solid " +
                (connected
                  ? "rgba(34,197,94,.3)"
                  : "rgba(239,68,68,.3)"),
              color: connected
                ? "#4ade80"
                : "#f87171",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            {connected
              ? "● Connected"
              : "● Disconnected"}
          </div>
        </div>

        {!activated ? (
          <div
            style={{
              minHeight: "420px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              textAlign: "center",
              border:
                "1px solid rgba(148,163,184,.15)",
              borderRadius: "28px",
              background:
                "rgba(15,23,42,.55)",
              backdropFilter:
                "blur(20px)",
              padding: "50px 30px",
            }}
          >
            <div
              style={{
                width: "100px",
                height: "100px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "42px",
                background:
                  "rgba(59,130,246,.12)",
                border:
                  "1px solid rgba(59,130,246,.3)",
                marginBottom: "28px",
              }}
            >
              🎙️
            </div>

            <h1
              style={{
                fontSize: "42px",
                margin: "0 0 12px",
                letterSpacing: "-1.5px",
              }}
            >
              Talk to FlowVoice
            </h1>

            <p
              style={{
                color: "#94a3b8",
                fontSize: "17px",
                maxWidth: "500px",
                lineHeight: 1.6,
                marginBottom: "30px",
              }}
            >
              Activate voice mode once.
              After that, just talk naturally.
              No buttons. No typing.
            </p>

            <button
              onClick={activateVoice}
              disabled={!connected}
              style={{
                border: "none",
                borderRadius: "14px",
                padding:
                  "16px 30px",
                fontSize: "17px",
                fontWeight: 700,
                cursor: connected
                  ? "pointer"
                  : "not-allowed",
                color: "#fff",
                background:
                  "linear-gradient(135deg,#2563eb,#7c3aed)",
                boxShadow:
                  "0 12px 35px rgba(37,99,235,.25)",
                opacity: connected
                  ? 1
                  : 0.5,
              }}
            >
              🎙️ Activate Voice
            </button>

            <p
              style={{
                marginTop: "18px",
                fontSize: "13px",
                color: "#64748b",
              }}
            >
              Your browser may ask for
              microphone permission.
            </p>
          </div>
        ) : (
          <>
            <div
              style={{
                textAlign: "center",
                marginBottom: "40px",
              }}
            >
              <div
                style={{
                  width: "130px",
                  height: "130px",
                  margin: "0 auto 24px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "48px",
                  background:
                    isListening
                      ? "rgba(34,197,94,.12)"
                      : "rgba(100,116,139,.12)",
                  border:
                    "1px solid " +
                    (isListening
                      ? "rgba(34,197,94,.4)"
                      : "rgba(100,116,139,.3)"),
                  boxShadow:
                    isListening
                      ? "0 0 60px rgba(34,197,94,.12)"
                      : "none",
                }}
              >
                🎙️
              </div>

              <h1
                style={{
                  margin: 0,
                  fontSize: "34px",
                }}
              >
                {isListening
                  ? "Listening..."
                  : "Getting ready..."}
              </h1>

              <p
                style={{
                  color: "#94a3b8",
                  marginTop: "10px",
                }}
              >
                Just speak naturally
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "1fr 1fr",
                gap: "20px",
              }}
            >
              <div
                style={{
                  padding: "24px",
                  borderRadius: "20px",
                  background:
                    "rgba(15,23,42,.7)",
                  border:
                    "1px solid rgba(148,163,184,.12)",
                }}
              >
                <div
                  style={{
                    color: "#64748b",
                    fontSize: "13px",
                    marginBottom: "10px",
                  }}
                >
                  YOU SAID
                </div>

                <div
                  style={{
                    fontSize: "19px",
                    fontWeight: 600,
                  }}
                >
                  {interim ||
                    transcript ||
                    "Listening for your command..."}
                </div>
              </div>

              <div
                style={{
                  padding: "24px",
                  borderRadius: "20px",
                  background:
                    "rgba(15,23,42,.7)",
                  border:
                    "1px solid rgba(148,163,184,.12)",
                }}
              >
                <div
                  style={{
                    color: "#64748b",
                    fontSize: "13px",
                    marginBottom: "10px",
                  }}
                >
                  AGENT STATUS
                </div>

                <div
                  style={{
                    fontSize: "19px",
                    fontWeight: 600,
                  }}
                >
                  {toolStatus ||
                    "Ready"}
                </div>
              </div>
            </div>

            {hotels.length > 0 && (
              <div
                style={{
                  marginTop: "24px",
                  padding: "24px",
                  borderRadius: "20px",
                  background:
                    "rgba(15,23,42,.7)",
                  border:
                    "1px solid rgba(148,163,184,.12)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    alignItems:
                      "center",
                    marginBottom: "18px",
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      fontSize: "21px",
                    }}
                  >
                    Hotel Results
                  </h2>

                  <span
                    style={{
                      color: "#64748b",
                      fontSize: "13px",
                    }}
                  >
                    Generation{" "}
                    {generation}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  {hotels.map(
                    (hotel) => (
                      <div
                        key={`${hotel.name}-${hotel.city}`}
                        style={{
                          display: "flex",
                          justifyContent:
                            "space-between",
                          alignItems:
                            "center",
                          padding:
                            "16px 18px",
                          borderRadius:
                            "14px",
                          background:
                            "rgba(255,255,255,.035)",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontWeight: 650,
                            }}
                          >
                            {hotel.name}
                          </div>

                          <div
                            style={{
                              color:
                                "#64748b",
                              fontSize:
                                "14px",
                              marginTop:
                                "4px",
                            }}
                          >
                            {hotel.city}
                          </div>
                        </div>

                        <div
                          style={{
                            fontWeight: 700,
                            fontSize:
                              "17px",
                          }}
                        >
                          ₹
                          {hotel.price}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            <div
              style={{
                marginTop: "24px",
                padding: "20px 24px",
                borderRadius: "20px",
                background:
                  "rgba(15,23,42,.5)",
                border:
                  "1px solid rgba(148,163,184,.1)",
              }}
            >
              <div
                style={{
                  color: "#64748b",
                  fontSize: "13px",
                  marginBottom: "12px",
                }}
              >
                LIVE EVENT STREAM
              </div>

              <div
                style={{
                  maxHeight: "180px",
                  overflowY: "auto",
                  fontSize: "13px",
                  color: "#94a3b8",
                }}
              >
                {events.map(
                  (event, index) => (
                    <div
                      key={index}
                      style={{
                        padding:
                          "5px 0",
                      }}
                    >
                      {event}
                    </div>
                  )
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;