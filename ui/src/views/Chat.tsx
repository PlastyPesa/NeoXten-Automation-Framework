import { useState } from "react";
import { Panel } from "../components/glass/Panel";
import { Button } from "../components/glass/Button";
import { ConstraintBadge } from "../components/chat/ConstraintBadge";
import { useRunStore } from "../stores/run-store";

interface Message {
  id: number;
  role: "user" | "system";
  text: string;
  timestamp: string;
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const { status, runId } = useRunStore();

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      text: input.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const reply: Message = {
      id: Date.now() + 1,
      role: "system",
      text: `Command received. Status: ${status}. Run: ${runId ?? "none"}. Chat is read-only visibility — it cannot bypass gates or modify pipeline state.`,
      timestamp: new Date().toISOString(),
    };
    setTimeout(() => setMessages((prev) => [...prev, reply]), 300);
  };

  return (
    <div data-testid="chat-view" className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Chat</h1>
        <ConstraintBadge />
      </div>

      <Panel className="flex-1 flex flex-col" data-testid="chat-panel">
        <div className="flex-1 overflow-y-auto space-y-3 mb-4 max-h-[500px]">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`px-4 py-3 rounded-xl text-sm ${
                msg.role === "user"
                  ? "bg-white/5 border border-white/10 ml-12"
                  : "bg-white/[0.02] border border-white/5 mr-12"
              }`}
            >
              <span className="text-[10px] text-zinc-600 uppercase">{msg.role}</span>
              <p className="mt-1 text-zinc-300">{msg.text}</p>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="text-sm text-zinc-600 text-center py-8">
              Chat is a visibility layer. It can query status and start runs, but cannot bypass gates or modify code.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            data-testid="chat-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask about run status, gates, evidence..."
            className="flex-1 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-white/20 transition-colors"
          />
          <Button data-testid="chat-send-btn" onClick={handleSend}>
            Send
          </Button>
        </div>
      </Panel>
    </div>
  );
}
