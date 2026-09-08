import { useEffect, useRef, useState } from "react";

type Hotel = {
  name: string;
  city: string;
  price: number;
};

type Restaurant = {
  name: string;
  city: string;
  cuisine: string;
  price: number;
};

type WebSource = {
  title: string;
  url: string;
};

type FlowEvent = {
  type: string;
  generation?: number;
  message?: string;
  city?: string;
  text?: string;
  tool?: string;
  hotels?: Hotel[];
  restaurants?: Restaurant[];
  answer?: string;
  sources?: WebSource[];
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
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
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
  const speechVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  const [status, setStatus] = useState("Connecting...");
  const [generation, setGeneration] = useState<number | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const [resultType, setResultType] = useState<
    "hotel" | "restaurant" | "web" | "none"
  >("none");

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [webAnswer, setWebAnswer] = useState("");
  const [sources, setSources] = useState<WebSource[]>([]);

  const [toolStatus, setToolStatus] = useState("Ready");

  function addEvent(event: string) {
    setEvents((previous) => [...previous.slice(-30), event]);
  }

  /*
   * ----------------------------------------
   * VOICE SELECTION
   * ----------------------------------------
   */

  function loadBestVoice() {
    const voices = window.speechSynthesis.getVoices();

    if (!voices.length) {
      return;
    }

    const preferredNames = [
      "Samantha",
      "Karen",
      "Moira",
      "Ava",
      "Google UK English Female",
      "Google US English Female",
      "Microsoft Aria",
      "Microsoft Jenny",
    ];

    let selected =
      voices.find((voice) =>
        preferredNames.some((name) =>
          voice.name.toLowerCase().includes(name.toLowerCase())
        )
      ) ?? null;

    if (!selected) {
      selected =
        voices.find(
          (voice) =>
            voice.lang.toLowerCase().startsWith("en") &&
            voice.name.toLowerCase().includes("female")
        ) ?? null;
    }

    if (!selected) {
      selected =
        voices.find((voice) =>
          voice.lang.toLowerCase().startsWith("en")
        ) ?? null;
    }

    speechVoiceRef.current = selected;

    console.log("🎙️ Selected voice:", selected?.name);
  }

  /*
   * ----------------------------------------
   * TEXT → SPEECH
   * ----------------------------------------
   */

  function speak(text: string) {
    if (!("speechSynthesis" in window)) {
      console.error("Speech synthesis is not supported");
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.voice = speechVoiceRef.current;
    utterance.rate = 0.95;
    utterance.pitch = 1.02;
    utterance.volume = 1;

    utterance.onstart = () => {
      console.log("🔊 AGENT SPEAKING");
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      console.log("🔊 AGENT FINISHED SPEAKING");
      setIsSpeaking(false);

      setTimeout(() => {
        startListening();
      }, 300);
    };

    utterance.onerror = (event) => {
      console.error("🔊 Speech synthesis error:", event);
      setIsSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  }

  /*
   * ----------------------------------------
   * AUTOMATIC VOICE LISTENING
   * ----------------------------------------
   */

  function startListening() {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error("Speech recognition is not supported.");
      return;
    }

    if (isListening || isSpeaking) {
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-IN";

    recognition.onstart = () => {
      console.log("🎙️ MICROPHONE STARTED");
      setIsListening(true);
      addEvent("MICROPHONE_STARTED");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }

      finalTranscript = finalTranscript.trim();

      if (!finalTranscript) {
        return;
      }

      console.log("🗣️ USER:", finalTranscript);

      setTranscript(finalTranscript);

      addEvent(`USER_SPOKE → "${finalTranscript}"`);

      const socket = socketRef.current;

      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "USER_SPOKE",
            text: finalTranscript,
          })
        );
      } else {
        console.error("❌ WebSocket not connected");
      }
    };

    recognition.onerror = (event) => {
      console.error("❌ Speech recognition error:", event);

      setIsListening(false);

      addEvent("MICROPHONE_ERROR");
    };

    recognition.onend = () => {
      console.log("🎙️ MICROPHONE STOPPED");

      setIsListening(false);

      addEvent("MICROPHONE_STOPPED");
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (error) {
      console.error("❌ Could not start microphone:", error);
      setIsListening(false);
    }
  }

  /*
   * ----------------------------------------
   * WEBSOCKET
   * ----------------------------------------
   */

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:3000");

    socketRef.current = socket;

    socket.onopen = () => {
      console.log("🔌 Frontend WebSocket connected");

      setStatus("Connected");

      addEvent("CONNECTED");

      setTimeout(() => {
        startListening();
      }, 800);
    };

    socket.onmessage = (event) => {
      const data: FlowEvent = JSON.parse(event.data);

      console.log("📨 Backend event:", data);

      switch (data.type) {
        case "CONNECTED": {
          addEvent("VOICE_MODE_ACTIVATED");
          break;
        }

        case "REQUEST_STARTED": {
          setGeneration(data.generation ?? null);

          setResultType("none");

          setHotels([]);
          setRestaurants([]);
          setWebAnswer("");
          setSources([]);

          setToolStatus("Understanding your request...");

          addEvent(
            `REQUEST_STARTED → Generation ${data.generation}`
          );

          break;
        }

        case "TOOL_STARTED": {
          if (data.tool === "hotel_search") {
            setToolStatus(
              `Searching hotels in ${data.city}...`
            );
          } else if (data.tool === "restaurant_search") {
            setToolStatus(
              `Searching restaurants in ${data.city}...`
            );
          } else if (data.tool === "web_search") {
            setToolStatus("Searching the web...");
          } else {
            setToolStatus("Working on your request...");
          }

          addEvent(
            `TOOL_STARTED → ${data.tool ?? "unknown"}`
          );

          break;
        }

        /*
         * ----------------------------------------
         * HOTEL RESULT
         * ----------------------------------------
         */

        case "TOOL_RESULT": {
          if (data.tool === "hotel_search") {
            const results = data.hotels ?? [];

            setResultType("hotel");
            setHotels(results);

            setRestaurants([]);
            setWebAnswer("");
            setSources([]);

            setToolStatus(
              `Found ${results.length} hotels in ${data.city}`
            );

            addEvent(
              `HOTEL_RESULT → ${data.city} | ${results.length} results`
            );

            if (results.length > 0) {
              const cheapest = results.reduce(
                (previous, current) =>
                  current.price < previous.price
                    ? current
                    : previous
              );

              const response =
                `I found ${results.length} hotels in ${data.city}. ` +
                `The cheapest option is ${cheapest.name} ` +
                `at rupees ${cheapest.price}.`;

              speak(response);
            } else {
              speak(
                `I couldn't find any hotels in ${data.city}.`
              );
            }
          }

          /*
           * ----------------------------------------
           * RESTAURANT RESULT
           * ----------------------------------------
           */

          else if (data.tool === "restaurant_search") {
            const results = data.restaurants ?? [];

            setResultType("restaurant");
            setRestaurants(results);

            setHotels([]);
            setWebAnswer("");
            setSources([]);

            setToolStatus(
              `Found ${results.length} restaurants in ${data.city}`
            );

            addEvent(
              `RESTAURANT_RESULT → ${data.city} | ${results.length} results`
            );

            if (results.length > 0) {
              const first = results[0];

              const response =
                `I found ${results.length} restaurants in ${data.city}. ` +
                `One option is ${first.name}, serving ${first.cuisine}.`;

              speak(response);
            } else {
              speak(
                `I couldn't find any restaurants in ${data.city}.`
              );
            }
          }

          /*
           * ----------------------------------------
           * WEB RESULT
           * ----------------------------------------
           */

          else if (data.tool === "web_search") {
            setResultType("web");

            setHotels([]);
            setRestaurants([]);

            setWebAnswer(data.answer ?? "");
            setSources(data.sources ?? []);

            setToolStatus("Web search completed");

            addEvent(
              `WEB_RESULT → ${data.sources?.length ?? 0} sources`
            );

            if (data.answer) {
              speak(data.answer);
            }
          }

          break;
        }

        case "STALE_RESULT": {
          addEvent(
            `STALE_RESULT → ${data.city} | Generation ${data.generation}`
          );

          break;
        }

        case "USER_INTERRUPTED": {
          window.speechSynthesis.cancel();

          setIsSpeaking(false);

          setGeneration(data.generation ?? null);

          setToolStatus("Previous request interrupted");

          addEvent(
            `USER_INTERRUPTED → Generation ${data.generation}`
          );

          break;
        }

        case "TOOL_ERROR": {
          setToolStatus("Something went wrong");

          speak(
            "Sorry, I couldn't complete that request."
          );

          addEvent("TOOL_ERROR");

          break;
        }

        default:
          console.log(
            "Unknown backend event:",
            data
          );
      }
    };

    socket.onerror = (error) => {
      console.error("❌ WebSocket error:", error);

      setStatus("Connection error");

      addEvent("WEBSOCKET_ERROR");
    };

    socket.onclose = () => {
      console.log("🔌 WebSocket disconnected");

      setStatus("Disconnected");

      addEvent("DISCONNECTED");
    };

    return () => {
      socket.close();

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore.
        }
      }

      window.speechSynthesis.cancel();
    };
  }, []);

  /*
   * ----------------------------------------
   * LOAD SYSTEM VOICES
   * ----------------------------------------
   */

  useEffect(() => {
    loadBestVoice();

    window.speechSynthesis.onvoiceschanged =
      loadBestVoice;

    return () => {
      window.speechSynthesis.cancel();

      window.speechSynthesis.onvoiceschanged =
        null;
    };
  }, []);

  /*
   * ----------------------------------------
   * UI
   * ----------------------------------------
   */

  const resultTitle =
    resultType === "hotel"
      ? "Hotel Results"
      : resultType === "restaurant"
      ? "Restaurant Results"
      : resultType === "web"
      ? "Web Results"
      : "Results";

  return (
    <div className="app">

      <header className="topbar">

        <div>
          <div className="brand">
            FlowVoice
          </div>

          <div className="tagline">
            Voice-first AI agent
          </div>
        </div>

        <div
          className={`connection ${
            status === "Connected"
              ? "online"
              : ""
          }`}
        >
          <span className="dot" />
          {status}
        </div>

      </header>

      <main className="main">

        <section className="voice-hero">

          <div
            className={`mic-orb ${
              isListening
                ? "listening"
                : isSpeaking
                ? "speaking"
                : ""
            }`}
          >
            <div className="mic-icon">
              🎙️
            </div>
          </div>

          <h1>
            {isListening
              ? "Listening..."
              : isSpeaking
              ? "Speaking..."
              : "Ready"}
          </h1>

          <p>
            {isListening
              ? "Just speak naturally"
              : isSpeaking
              ? "FlowVoice is responding"
              : "Your voice assistant is ready"}
          </p>

        </section>

        <section className="conversation-grid">

          <div className="panel">

            <div className="panel-label">
              YOU SAID
            </div>

            <div className="transcript">
              {transcript ||
                "Start speaking..."}
            </div>

          </div>

          <div className="panel">

            <div className="panel-label">
              AGENT STATUS
            </div>

            <div className="agent-status">
              {toolStatus}
            </div>

          </div>

        </section>

        <section className="results-panel">

          <div className="results-header">

            <div className="results-title">
              {resultTitle}
            </div>

            <div className="generation">
              Generation{" "}
              {generation ?? "—"}
            </div>

          </div>

          {resultType === "hotel" &&
            hotels.length > 0 && (
              <div className="hotel-list">

                {hotels.map((hotel) => (
                  <div
                    className="hotel"
                    key={`${hotel.name}-${hotel.city}`}
                  >

                    <div>

                      <div className="hotel-name">
                        🏨 {hotel.name}
                      </div>

                      <div className="hotel-city">
                        {hotel.city}
                      </div>

                    </div>

                    <div className="hotel-price">
                      ₹{hotel.price}
                    </div>

                  </div>
                ))}

              </div>
            )}

          {resultType === "restaurant" &&
            restaurants.length > 0 && (
              <div className="hotel-list">

                {restaurants.map(
                  (restaurant) => (
                    <div
                      className="hotel"
                      key={`${restaurant.name}-${restaurant.city}`}
                    >

                      <div>

                        <div className="hotel-name">
                          🍽️ {restaurant.name}
                        </div>

                        <div className="hotel-city">
                          {restaurant.city} ·{" "}
                          {restaurant.cuisine}
                        </div>

                      </div>

                      <div className="hotel-price">
                        ₹{restaurant.price}
                      </div>

                    </div>
                  )
                )}

              </div>
            )}

          {resultType === "web" &&
            webAnswer && (
              <div className="web-results">

                <div className="web-answer">
                  {webAnswer}
                </div>

                {sources.length > 0 && (
                  <div className="web-sources">

                    <div className="panel-label">
                      SOURCES
                    </div>

                    {sources.map(
                      (source, index) => (
                        <a
                          key={index}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="web-source"
                        >
                          🌐 {source.title}
                        </a>
                      )
                    )}

                  </div>
                )}

              </div>
            )}

          {resultType === "none" && (
            <div className="empty-results">
              Results will appear here
              after your request.
            </div>
          )}

        </section>

        <section className="events-panel">

          <div className="events-title">
            LIVE EVENT STREAM
          </div>

          <div className="events">

            {events
              .slice()
              .reverse()
              .map(
                (event, index) => (
                  <div
                    className="event"
                    key={index}
                  >
                    {event}
                  </div>
                )
              )}

          </div>

        </section>

      </main>

    </div>
  );
}

export default App;