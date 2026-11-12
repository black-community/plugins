import type { NodeInfo } from "@black/plugin";
import { useEffect, useRef, useState } from "react";
import { newLinkId } from "./links";
import { addPin, readPins, removePin } from "./maps";
import { targetGroups, type TabContext } from "./tab";

/**
 * A map with its pins: the map entry's picture, each pin a name that opens what it marks. Clicking the map puts a pin
 * there, once the writer says what it marks. In the map's World tab, and larger in a dialog.
 */
export function MapBoard({ mapId, context, large = false }: { mapId: string; context: TabContext; large?: boolean }) {
  const { app, t } = context;
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [all, setAll] = useState<Record<string, unknown>>({});
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [to, setTo] = useState("");
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [picture, n, data] = await Promise.all([
        app.project.picture?.(mapId) ?? null,
        app.project.nodes(),
        app.project.itemsWithData?.() ?? ({} as Record<string, unknown>),
      ]);
      if (!live) return;
      setUrl(picture);
      setNodes(n);
      setAll(data);
    };
    void load();
    const stop = context.watch(() => void load());
    return () => {
      live = false;
      stop();
    };
  }, [mapId]);

  /** Changes the map's data: reads it, changes it, and writes it, once more if it changed meanwhile. */
  const change = async (edit: (current: unknown) => unknown) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await app.project.setItemData!(mapId, edit(await app.project.getItemData!(mapId)));
        return;
      } catch (err) {
        const name = (err as Error).name;
        if (name === "Stale" && attempt === 0) continue;
        app.ui.notify(name === "ReadOnly" ? t("tab.readOnly") : (err as Error).message);
        return;
      }
    }
  };

  if (url === undefined) return null;
  if (!url) return <p className="insp-hint">{t("map.noPicture")}</p>;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pins = Object.entries(readPins(all[mapId])).filter(([, p]) => byId.get(p.to) && !byId.get(p.to)!.inTrash);
  const groups = targetGroups(nodes, t, mapId);

  return (
    <div className={`world-map${large ? " large" : ""}`}>
      <p className="insp-hint">{t("map.hint")}</p>
      <div
        ref={frame}
        className="world-map-frame"
        onClick={(e) => {
          const box = frame.current!.getBoundingClientRect();
          setPending({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height });
        }}
      >
        <img src={url} alt="" draggable={false} />
        {pins.map(([id, pin]) => (
          <div key={id} className="world-pin" data-pin={id} style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }} onClick={(e) => e.stopPropagation()}>
            <button className="world-pin-label" onClick={() => void app.project.select(pin.to)}>
              {byId.get(pin.to)!.title}
            </button>
            <button className="world-pin-remove" title={t("map.remove")} aria-label={t("map.remove")} onClick={() => void change((cur) => removePin(cur, id))}>
              ×
            </button>
          </div>
        ))}
        {pending && <div className="world-pin pending" style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }} />}
      </div>
      {pending && (
        <form
          className="world-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!to) return;
            void change((cur) => addPin(cur, { ...pending, to }, newLinkId())).then(() => {
              setPending(null);
              setTo("");
            });
          }}
        >
          <select className="select" aria-label={t("map.pinWhat")} value={to} onChange={(e) => setTo(e.target.value)} autoFocus>
            <option value="">{t("map.pinWhat")}</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="btn sm" type="submit" disabled={!to}>
            {t("map.pin")}
          </button>
          <button className="btn ghost sm" type="button" onClick={() => setPending(null)}>
            {t("map.cancel")}
          </button>
        </form>
      )}
    </div>
  );
}
