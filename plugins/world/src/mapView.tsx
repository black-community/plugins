import type { NodeInfo } from "@black/plugin";
import { useEffect, useState } from "react";
import { MapBoard } from "./mapBoard";
import type { TabContext } from "./tab";

/**
 * The Map view: one of the world's maps, as large as the view, with its pins. With several maps, the writer picks one.
 * Opening a map from an item's World tab shows it here.
 */
export function MapView({ context }: { context: TabContext }) {
  const { app, t } = context;
  const [maps, setMaps] = useState<NodeInfo[] | null>(null);
  const [chosen, setChosen] = useState(context.currentMap());

  useEffect(() => {
    let live = true;
    const load = async () => {
      const nodes = await app.project.nodes();
      if (!live) return;
      setMaps(nodes.filter((n) => n.kind === "world:map" && !n.inTrash).sort((a, b) => a.title.localeCompare(b.title)));
      setChosen(context.currentMap());
    };
    void load();
    const stop = context.watch(() => void load());
    return () => {
      live = false;
      stop();
    };
  }, []);

  if (maps === null) return null;
  if (!maps.length) return <p className="insp-hint world-view-empty world-map-view">{t("mapView.none")}</p>;
  const map = maps.find((m) => m.id === chosen) ?? maps[0];
  return (
    <div className="world-map-view">
      <div className="world-view-bar">
        <h2>{map.title}</h2>
        {maps.length > 1 && (
          <select
            className="select"
            aria-label={t("mapView.choose")}
            value={map.id}
            onChange={(e) => {
              context.showMap(e.target.value);
              setChosen(e.target.value);
            }}
          >
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        )}
        <button className="btn sm" onClick={() => void app.project.select(map.id)}>
          {t("mapView.sheet")}
        </button>
      </div>
      <MapBoard key={map.id} mapId={map.id} context={context} large />
    </div>
  );
}
