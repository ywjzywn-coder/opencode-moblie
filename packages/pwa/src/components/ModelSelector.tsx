import { useEffect, useState } from "react";
import { useStore } from "../lib/store.js";

interface ModelInfo {
  id: string;
  providerID: string;
  name: string;
  reasoning: boolean;
  attachment: boolean;
}

interface Props {
  current: { providerID: string; modelID: string } | null;
  onSelect: (m: { providerID: string; modelID: string }) => void;
  onClose: () => void;
}

export function ModelSelector({ current, onSelect, onClose }: Props) {
  const getClient = useStore((s) => s.getClient);
  const [groups, setGroups] = useState<Array<{ providerName: string; models: ModelInfo[] }>>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getClient();
    if (!client) return;
    (async () => {
      try {
        const res = await (client as any).config.providers();
        const d = res.data;
        setDefaults(d?.default ?? {});
        const all: Array<{ providerName: string; models: ModelInfo[] }> = [];
        for (const p of d?.providers ?? []) {
          const models: ModelInfo[] = [];
          const modelsMap = p.models ?? {};
          for (const [mid, m] of Object.entries(modelsMap)) {
            const mm = m as any;
            models.push({
              id: mid,
              providerID: p.id,
              name: mm.name ?? mid,
              reasoning: mm.capabilities?.reasoning ?? false,
              attachment: mm.capabilities?.attachment ?? false,
            });
          }
          if (models.length > 0) {
            all.push({ providerName: p.name ?? p.id, models });
          }
        }
        setGroups(all);
      } finally {
        setLoading(false);
      }
    })();
  }, [getClient]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ background: "var(--bg-elev)", width: "100%", maxHeight: "70vh", overflowY: "auto", borderRadius: "20px 20px 0 0", padding: 16, paddingBottom: "calc(16px + var(--safe-bottom))" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>选择模型</span>
          <button className="back-btn" onClick={onClose}>✕</button>
        </div>
        {loading && <div className="muted"><span className="spinner" /> 加载中...</div>}
        {groups.map((g, gi) => (
          <div key={gi} style={{ marginBottom: 16 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{g.providerName}</div>
            {g.models.map((m) => {
              const isCurrent = current?.providerID === m.providerID && current?.modelID === m.id;
              const isDefault = defaults[m.providerID] === m.id;
              return (
                <div
                  key={m.providerID + m.id}
                  className="list-item"
                  onClick={() => onSelect({ providerID: m.providerID, modelID: m.id })}
                  style={isCurrent ? { borderColor: "var(--accent)" } : undefined}
                >
                  <div className="meta">
                    <div className="name" style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      {m.name}
                      {isDefault && <span style={{ fontSize: 10, color: "var(--accent)", background: "var(--accent-dim)", padding: "1px 5px", borderRadius: 4 }}>默认</span>}
                    </div>
                    <div className="sub" style={{ display: "flex", gap: 8 }}>
                      <span>{m.id}</span>
                      {m.reasoning && <span title="支持思考">💭</span>}
                      {m.attachment && <span title="支持附件">📎</span>}
                    </div>
                  </div>
                  {isCurrent && <span style={{ color: "var(--accent)", flexShrink: 0 }}>✓</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
