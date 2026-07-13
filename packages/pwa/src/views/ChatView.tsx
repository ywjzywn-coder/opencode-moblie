import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../lib/store.js";
import { PermissionCard } from "../components/PermissionCard.js";
import { ModelSelector } from "../components/ModelSelector.js";
import { AgentSelector } from "../components/AgentSelector.js";
import { FilePicker } from "../components/FilePicker.js";

interface Props {
  sessionId: string;
  onBack: () => void;
  onOpenDiff?: () => void;
}

interface Part {
  type: string;
  text?: string;
  tool?: string;
  state?: string;
  id?: string;
  path?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  parts: Part[];
  infoId?: string;
}

interface PermissionRequest {
  id: string;
  description: string;
  sessionId: string;
  permissionId?: string;
}

interface AttachedFile {
  path: string;
  name: string;
}

export function ChatView({ sessionId, onBack, onOpenDiff }: Props) {
  const getClient = useStore((s) => s.getClient);
  const getTransport = useStore((s) => s.getTransport);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);

  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);

  const [model, setModel] = useState<{ providerID: string; modelID: string } | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [showThinking, setShowThinking] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const loadMessages = useCallback(async () => {
    const client = getClient();
    if (!client) return;
    try {
      const res = await (client as any).session.messages({ path: { id: sessionId } });
      const msgs: ChatMessage[] = [];
      for (const m of res.data ?? []) {
        const parts = (m.parts ?? []) as Part[];
        const text = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
        if (m.info.role === "user" || m.info.role === "assistant") {
          msgs.push({ role: m.info.role, text, parts, infoId: m.info.id });
        }
      }
      setMessages(msgs);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getClient, sessionId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    const transport = getTransport();
    if (!transport) return;
    return transport.onEvent((event) => {
      if (event.type === "message.part.updated") {
        const props = event.properties as { input?: { messageID?: string; part?: Part; sessionID?: string }; output?: unknown };
        const part = props.input?.part;
        const messageID = props.input?.messageID;
        const sessionID = props.input?.sessionID;
        if (!part || !messageID || sessionID !== sessionId) return;
        setMessages((prev) => {
          const existing = prev.find((m) => m.infoId === messageID);
          if (existing) {
            const partIdx = existing.parts.findIndex((p) => p.id === part.id);
            const newParts = partIdx >= 0
              ? [...existing.parts.slice(0, partIdx), part, ...existing.parts.slice(partIdx + 1)]
              : [...existing.parts, part];
            const newText = newParts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
            return prev.map((m) => m.infoId === messageID ? { ...m, parts: newParts, text: newText } : m);
          }
          if (part.type === "text" || part.type === "tool" || part.type === "reasoning") {
            return [...prev, { role: "assistant", text: part.text ?? "", parts: [part], infoId: messageID }];
          }
          return prev;
        });
      } else if (event.type === "permission.asked") {
        const props = event.properties as { input?: { sessionID?: string; permissionID?: string; description?: string } };
        if (props.input?.sessionID !== sessionId) return;
        setPermission({
          id: Math.random().toString(36).slice(2),
          description: props.input.description ?? "权限请求",
          sessionId,
          permissionId: props.input.permissionID,
        });
      } else if (event.type === "permission.replied") {
        setPermission(null);
      } else if (event.type === "session.idle") {
        setSending(false);
      }
    });
  }, [getTransport, sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const client = getClient();
    if (!client || (!input.trim() && attachedFiles.length === 0)) return;
    const text = input.trim();
    setInput("");
    if (textAreaRef.current) textAreaRef.current.style.height = "44px";
    setSending(true);

    const parts: any[] = [];
    if (text) parts.push({ type: "text", text });
    for (const f of attachedFiles) {
      parts.push({ type: "file", mime: "text/plain", filename: f.name, url: `file://${f.path}` });
    }

    const displayText = [text, ...attachedFiles.map((f) => `📎 ${f.name}`)].filter(Boolean).join("\n");
    setMessages((prev) => [...prev, { role: "user", text: displayText, parts: [] }]);
    setAttachedFiles([]);

    try {
      const body: any = { parts };
      if (model) body.model = model;
      if (agent) body.agent = agent;
      await (client as any).session.promptAsync({ path: { id: sessionId }, body });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  };

  const abort = async () => {
    const client = getClient();
    if (!client) return;
    try {
      await (client as any).session.abort({ path: { id: sessionId } });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleThinking = async () => {
    const client = getClient();
    if (!client) return;
    try {
      await (client as any).session.command({
        path: { id: sessionId },
        body: { command: "thinking", arguments: "" },
      });
      setShowThinking((prev) => !prev);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const respondPermission = async (allow: boolean) => {
    const client = getClient();
    if (!client || !permission?.permissionId) return;
    try {
      await (client as any).postSessionIdPermissionsPermissionId({
        path: { id: sessionId, permissionID: permission.permissionId },
        body: { response: allow ? "allow" : "deny" },
      });
    } catch (e) {
      setError((e as Error).message);
    }
    setPermission(null);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "44px";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const removeFile = (path: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.path !== path));
  };

  const agentLabel = !agent || agent === "" ? "默认" : (agent.toLowerCase().includes("plan") ? "规划" : agent.toLowerCase().includes("build") ? "构建" : agent);

  return (
    <div className="app">
      <div className="topbar">
        <button className="back-btn" onClick={onBack}>‹</button>
        <span className="title" style={{ fontSize: 12, flex: 1, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {model ? model.modelID : "对话"}
        </span>
        <button onClick={() => setShowAgentSelector(true)} style={{ fontSize: 11, padding: "6px 8px" }}>{agentLabel}</button>
        <button onClick={() => setShowModelSelector(true)} style={{ fontSize: 11, padding: "6px 8px" }}>模型</button>
        {onOpenDiff && <button onClick={onOpenDiff} style={{ fontSize: 11, padding: "6px 8px" }}>改动</button>}
        {sending && <button onClick={abort} className="danger" style={{ fontSize: 11, padding: "6px 8px" }}>停止</button>}
      </div>
      <div className="content">
        <div className="chat">
          <div className="messages">
            {loading && <div className="muted"><span className="spinner" /> 加载中...</div>}
            {messages.map((m, i) => (
              <MessageBubble key={i} msg={m} showThinking={showThinking} />
            ))}
            {permission && (
              <PermissionCard
                description={permission.description}
                onAllow={() => respondPermission(true)}
                onDeny={() => respondPermission(false)}
              />
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>
      {error && <div className="error-text" style={{ padding: "0 14px" }}>{error}</div>}
      {attachedFiles.length > 0 && (
        <div style={{ display: "flex", gap: 6, padding: "6px 12px", flexWrap: "wrap", borderTop: "1px solid var(--border)" }}>
          {attachedFiles.map((f) => (
            <span key={f.path} style={{ background: "var(--bg-element)", borderRadius: 6, padding: "4px 8px", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              📎 {f.name}
              <button onClick={() => removeFile(f.path)} style={{ background: "none", border: "none", padding: 0, fontSize: 14, color: "var(--text-muted)", lineHeight: 1 }}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        <button
          onClick={() => setShowFilePicker(true)}
          style={{ flexShrink: 0, width: 38, height: 44, padding: 0, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}
          disabled={sending}
          title="附加文件"
        ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
        <button
          onClick={toggleThinking}
          style={{
            flexShrink: 0, width: 38, height: 44, padding: 0, fontSize: 15,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: showThinking ? "var(--primary-dim)" : "var(--bg-element)",
            color: showThinking ? "var(--accent)" : "var(--text-muted)",
            border: showThinking ? "1px solid var(--accent)" : "1px solid var(--border)",
          }}
          disabled={sending}
          title={showThinking ? "思考已开启" : "思考已关闭"}
        ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg></button>
        <textarea
          ref={textAreaRef}
          value={input}
          onChange={onInputChange}
          placeholder="给 opencode 发消息..."
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          disabled={sending}
        />
        <button className="primary" onClick={send} disabled={sending || (!input.trim() && attachedFiles.length === 0)} style={{ flexShrink: 0, width: 44 }}>
          {sending ? <span className="spinner" /> : "↑"}
        </button>
      </div>
      {showModelSelector && (
        <ModelSelector
          current={model}
          onSelect={(m) => {
            setModel(m);
            setShowModelSelector(false);
          }}
          onClose={() => setShowModelSelector(false)}
        />
      )}
      {showAgentSelector && (
        <AgentSelector
          current={agent}
          onSelect={(a) => { setAgent(a); setShowAgentSelector(false); }}
          onClose={() => setShowAgentSelector(false)}
        />
      )}
      {showFilePicker && (
        <FilePicker
          onSelect={(path) => {
            const name = path.split("/").pop() ?? path;
            setAttachedFiles((prev) => prev.some((f) => f.path === path) ? prev : [...prev, { path, name }]);
          }}
          onClose={() => setShowFilePicker(false)}
        />
      )}
    </div>
  );
}

function MessageBubble({ msg, showThinking }: { msg: ChatMessage; showThinking: boolean }) {
  return (
    <div className={`msg ${msg.role}`}>
      <div className="role-tag">{msg.role === "user" ? "你" : "opencode"}</div>
      <PartsRenderer parts={msg.parts} fallback={msg.text} showThinking={showThinking} />
    </div>
  );
}

function PartsRenderer({ parts, fallback, showThinking }: { parts: Part[]; fallback: string; showThinking: boolean }) {
  if (parts.length === 0) {
    return <div>{fallback}</div>;
  }
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") {
          return <div key={i}>{p.text}</div>;
        }
        if (p.type === "file") {
          return (
            <div key={i} style={{ fontSize: 12, color: "var(--accent)", margin: "4px 0" }}>
              📎 {p.path ?? p.text}
            </div>
          );
        }
        if (p.type === "tool") {
          return (
            <div key={i} style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0" }}>
              🔧 {p.tool} {p.state ? `(${p.state})` : ""}
            </div>
          );
        }
        if (p.type === "reasoning" && showThinking) {
          return (
            <div key={i} style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", margin: "4px 0" }}>
              💭 {p.text}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
