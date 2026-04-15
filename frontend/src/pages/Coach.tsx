import { useState, useRef, useEffect } from "react";
import api from "../api/client";
import { useAthleteContext } from "../main";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How was my training load this week?",
  "Why might I be feeling tired? What does my HRV say?",
  "Should I train hard tomorrow?",
  "What's my current fitness level and form?",
  "How is my sleep affecting my recovery?",
  "What's my best predicted race pace right now?",
];

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 12,
      }}
    >
      {!isUser && (
        <div
          style={{
            width: 28, height: 28, borderRadius: "50%",
            background: "#3b82f6", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700, marginRight: 8, flexShrink: 0,
          }}
        >
          Z
        </div>
      )}
      <div
        style={{
          maxWidth: "72%",
          padding: "10px 14px",
          borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          background: isUser ? "#3b82f6" : "#f3f4f6",
          color: isUser ? "#fff" : "#111",
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        {msg.content}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 8 }}>
      <div
        style={{
          width: 28, height: 28, borderRadius: "50%",
          background: "#3b82f6", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 700, flexShrink: 0,
        }}
      >
        Z
      </div>
      <div style={{ padding: "10px 14px", borderRadius: "16px 16px 16px 4px", background: "#f3f4f6" }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 6, height: 6, borderRadius: "50%", background: "#9ca3af",
                animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Coach() {
  const { athleteId } = useAthleteContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [messagesLeft, setMessagesLeft] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(text: string) {
    if (!text.trim() || !athleteId || loading) return;
    setError("");

    const userMsg: Message = { role: "user", content: text.trim() };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setLoading(true);

    try {
      const { data } = await api.post("/coach/chat", {
        athlete_id: athleteId,
        message: text.trim(),
        history: messages, // send all prior turns as context
      });
      setMessages([...nextHistory, { role: "assistant", content: data.reply }]);
      setMessagesLeft(20 - data.messages_today);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (detail?.includes("limit")) {
        setError(detail);
      } else {
        setError("Failed to get a response. Please try again.");
      }
      // Remove the user message if the request failed
      setMessages(messages);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  if (!athleteId) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 16px", fontFamily: "sans-serif", textAlign: "center" }}>
        <p style={{ color: "#6b7280" }}>Connect your account in <a href="/settings">Settings</a> to chat with your coach.</p>
      </div>
    );
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* Bounce animation keyframes */}
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
      `}</style>

      <div style={{
        maxWidth: 720, margin: "0 auto", padding: "24px 16px",
        fontFamily: "sans-serif", display: "flex", flexDirection: "column",
        height: "calc(100vh - 60px)",
      }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>AI Coach</h1>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
            Ask anything about your training, recovery, or upcoming races.
            {messagesLeft !== null && ` · ${messagesLeft} message${messagesLeft === 1 ? "" : "s"} left today`}
          </p>
        </div>

        {/* Chat area */}
        <div style={{
          flex: 1, overflowY: "auto", paddingRight: 4,
          display: "flex", flexDirection: "column",
        }}>
          {isEmpty && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingBottom: 40 }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "#3b82f6", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 700, marginBottom: 16,
              }}>
                Z
              </div>
              <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 20, textAlign: "center" }}>
                I have access to your last 14 days of recovery data and 30 days of activities.<br />
                Ask me anything.
              </p>
              {/* Quick-start suggestions */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 520 }}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    style={{
                      padding: "6px 12px", borderRadius: 999, fontSize: 12,
                      border: "1px solid #e5e7eb", background: "#fff",
                      color: "#374151", cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isEmpty && (
            <div style={{ paddingTop: 8 }}>
              {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
              {loading && <TypingIndicator />}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p style={{ margin: "8px 0 4px", fontSize: 13, color: "#dc2626", textAlign: "center" }}>{error}</p>
        )}

        {/* Input area */}
        <div style={{
          display: "flex", gap: 8, paddingTop: 12,
          borderTop: "1px solid #e5e7eb", marginTop: 4,
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your coach… (Enter to send, Shift+Enter for newline)"
            rows={2}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10,
              border: "1px solid #e5e7eb", fontSize: 14, resize: "none",
              outline: "none", fontFamily: "sans-serif", lineHeight: 1.5,
            }}
            disabled={loading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            style={{
              padding: "0 18px", borderRadius: 10, border: "none",
              background: !input.trim() || loading ? "#e5e7eb" : "#3b82f6",
              color: !input.trim() || loading ? "#9ca3af" : "#fff",
              fontSize: 14, fontWeight: 600, cursor: !input.trim() || loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
}
