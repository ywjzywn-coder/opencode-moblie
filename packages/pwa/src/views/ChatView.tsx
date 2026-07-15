import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../lib/store.js";
import { PermissionCard } from "../components/PermissionCard.js";
import { ModelSelector } from "../components/ModelSelector.js";
import { AgentSelector } from "../components/AgentSelector.js";
import { FilePicker } from "../components/FilePicker.js";

interface Props {
  sessionId: string;
  directory?: string;
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

export function ChatView({ sessionId, directory, onBack, onOpenDiff }: Props) {
  const getClient = useStore((s) => s.getClient);
  const getTransport = useStore((s) => s.getTransport);
  const dirQuery = directory ? { directory } : undefined;
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
  const [connected, setConnected] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const loadMessages = useCallback(async () => {
    const client = getClient();
    if (!client) return;
    try {
      const res = await (client as any).session.messages({ path: { id: sessionId }, query: dirQuery });
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
  }, [getClient, sessionId, directory]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    const transport = getTransport();
    if (!transport) return;
    return transport.onEvent((event) => {
      if (event.type === "message.part.updated") {
        // opencode 事件结构：properties.sessionID + properties.part，
        // 其中 messageID / sessionID 在 part 内部（不是 properties.input.part）
        const props = event.properties as { sessionID?: string; part?: Part & { messageID?: string; sessionID?: string } };
        const part = props.part;
        const messageID = part?.messageID;
        const sessionID = props.sessionID ?? part?.sessionID;
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
      } else if (event.type === "permission.asked" || event.type === "permission.updated") {
        // 兼容两种结构：properties 直接带字段，或包在 properties.input 里
        const raw = event.properties as {
          sessionID?: string; permissionID?: string; id?: string; title?: string; description?: string;
          input?: { sessionID?: string; permissionID?: string; description?: string };
        };
        const p = raw.input ?? raw;
        const sid = p.sessionID ?? (p as any).sessionId;
        if (sid !== sessionId) return;
        setPermission({
          id: Math.random().toString(36).slice(2),
          description: (p as any).description ?? (p as any).title ?? "权限请求",
          sessionId,
          permissionId: (p as any).permissionID ?? (p as any).id,
        });
      } else if (event.type === "permission.replied") {
        setPermission(null);
      } else if (event.type === "session.idle") {
        const props = event.properties as { sessionID?: string };
        if (props.sessionID && props.sessionID !== sessionId) return;
        setSending(false);
      } else if (event.type === "session.error") {
        setSending(false);
      }
    });
  }, [getTransport, sessionId]);

  useEffect(() => {
    const transport = getTransport();
    if (!transport) return;
    setConnected(transport.connected);
    const offStatus = transport.onStatusChange((c) => setConnected(c));
    const offReconnect = transport.onReconnect(() => {
      // 断线重连后：重新拉取消息补齐错过的内容，并根据最后一条消息判断是否仍在处理中
      const client = getClient();
      if (!client) return;
      (client as any).session.messages({ path: { id: sessionId }, query: dirQuery })
        .then((res: any) => {
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
          const last = msgs[msgs.length - 1];
          const stillRunning = last?.role === "assistant" && last.parts.some(
            (p) => p.type === "tool" && (p.state === "running" || p.state === "pending"),
          );
          setSending(!!stillRunning);
        })
        .catch((e: Error) => setError(e.message));
    });
    return () => { offStatus(); offReconnect(); };
  }, [getTransport, getClient, sessionId, directory]);

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
      const res = await (client as any).session.promptAsync({ path: { id: sessionId }, query: dirQuery, body });
      // serve 对无法归属的会话会返回 {error:{name, data:{message}}}，此前被静默吞掉导致“发出去没反应”
      if (res?.error) {
        throw new Error(res.error.data?.message ?? res.error.message ?? res.error.name ?? "发送失败");
      }
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
      await (client as any).session.abort({ path: { id: sessionId }, query: dirQuery });
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
        query: dirQuery,
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
        query: dirQuery,
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
      {!connected && (
        <div style={{
          background: "var(--warning)", color: "var(--bg)", fontSize: 12, fontWeight: 600,
          padding: "6px 14px", textAlign: "center",
        }}>
          连接已断开，正在重连...
        </div>
      )}
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
            color: showThinking ? "var(--warning)" : "var(--text-muted)",
            border: showThinking ? "1px solid var(--warning)" : "1px solid var(--border-subtle)",
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
  if (msg.role === "user") {
    return (
      <div className="msg user">
        {msg.parts.length === 0 ? msg.text : <PartsRenderer parts={msg.parts} fallback={msg.text} showThinking={showThinking} />}
      </div>
    );
  }
  return <PartsRenderer parts={msg.parts} fallback={msg.text} showThinking={showThinking} />;
}

const TOOL_GLYPHS: Record<string, string> = {
  bash: "$",
  read: "→",
  glob: "✱",
  grep: "✱",
  edit: "←",
  write: "←",
  webfetch: "%",
  websearch: "◈",
  patch: "%",
  apply_patch: "%",
  todowrite: "⚙",
  task: "◇",
};

function toolLabel(p: Part): { glyph: string; label: string; path?: string } {
  const name = (p.tool ?? "").toLowerCase();
  const glyph = TOOL_GLYPHS[name] ?? "⚙";
  const capitalized = name ? name.charAt(0).toUpperCase() + name.slice(1) : "Tool";
  return { glyph, label: capitalized, path: p.path };
}

function PartsRenderer({ parts, fallback, showThinking }: { parts: Part[]; fallback: string; showThinking: boolean }) {
  if (parts.length === 0) {
    return <div className="msg assistant">{fallback}</div>;
  }
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") {
          if (!p.text) return null;
          return <div key={i} className="msg assistant">{p.text}</div>;
        }
        if (p.type === "file") {
          return (
            <div key={i} className="file-ref">
              <span>📎</span>
              <span>{(p.path ?? p.text ?? "").split("/").pop()}</span>
            </div>
          );
        }
        if (p.type === "tool") {
          const { glyph, label, path } = toolLabel(p);
          const done = p.state === "completed" || p.state === "complete";
          const errored = p.state === "error" || p.state === "failed";
          return (
            <div key={i} className={`tool-row ${errored ? "error" : done ? "done" : ""}`}>
              <span className="glyph">{glyph}</span>
              <span className="tool-label">
                {label}
                {path && <span className="tool-path"> {path.split("/").slice(-2).join("/")}</span>}
                {p.state && !done && !errored ? ` · ${p.state}` : ""}
              </span>
            </div>
          );
        }
        if (p.type === "reasoning" && showThinking) {
          if (!p.text) return null;
          return (
            <div key={i} className="reasoning-row">
              {p.text}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
