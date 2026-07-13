import { useState, useCallback } from "react";
import { useStore } from "../lib/store.js";

interface Props {
  onSelect: (filePath: string) => void;
  onClose: () => void;
}

export function FilePicker({ onSelect, onClose }: Props) {
  const getClient = useStore((s) => s.getClient);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    const client = getClient();
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const res = await (client as any).find.files({ query: { query: query.trim() } });
      if (res.error) throw new Error(res.error.message);
      setResults(res.data ?? []);
      setSearched(true);
    } catch (e) {
      setError((e as Error).message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [getClient, query]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ background: "var(--bg-panel)", width: "100%", maxHeight: "70vh", borderRadius: "20px 20px 0 0", padding: 16, paddingBottom: "calc(16px + var(--safe-bottom))", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>附加文件</span>
          <button className="back-btn" onClick={onClose}>✕</button>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文件名..."
            autoCapitalize="none"
            autoCorrect="off"
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            style={{ flex: 1 }}
          />
          <button onClick={search} disabled={loading || !query.trim()} style={{ flexShrink: 0 }}>
            {loading ? <span className="spinner" /> : "搜索"}
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {error && <div className="error-text" style={{ padding: "0 0 8px" }}>{error}</div>}
          {results.length === 0 && searched && !loading && !error && (
            <div className="muted" style={{ textAlign: "center", padding: 20 }}>没有找到文件</div>
          )}
          {results.map((path) => (
            <div
              key={path}
              className="list-item"
              onClick={() => { onSelect(path); onClose(); }}
            >
              <div className="meta">
                <div className="name" style={{ fontSize: 13, fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
                  {path.split("/").pop()}
                </div>
                <div className="sub" style={{ wordBreak: "break-all" }}>{path}</div>
              </div>
              <span style={{ color: "var(--primary)", flexShrink: 0 }}>+</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
