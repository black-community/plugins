import type { App, NodeInfo } from "@black/plugin";
import { useEffect, useState } from "react";
import type { Translate } from "../../../shared/i18n";
import { KINDS, type Key } from "./kinds";
import { addLink, LINK_TYPES, linksOf, removeLink, type LinkType, type SeenLink } from "./links";

/** What the tab needs from the plugin: the app, its words in the writer's language, and word of changes. */
export interface TabContext {
  app: App;
  t: Translate<Key>;
  /** Calls back when items or their World data change, here or elsewhere. Returns how to stop. */
  watch(callback: () => void): () => void;
}

/** Whether an item can have links: World's own entries, characters and places. */
export const linkable = (node: { type: string; kind?: string }) =>
  node.type === "character" || node.type === "place" || (node.type === "entry" && !!node.kind?.startsWith("world:"));

/** The World tab in the inspector: an item's links, both ways, and adding one. */
export function WorldTab({ nodeId, context }: { nodeId: string; context: TabContext }) {
  const { app, t } = context;
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [all, setAll] = useState<Record<string, unknown>>({});
  const [type, setType] = useState<LinkType>("memberOf");
  const [to, setTo] = useState("");

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [n, data] = await Promise.all([app.project.nodes(), app.project.itemsWithData?.() ?? {}]);
      if (live) {
        setNodes(n);
        setAll(data);
      }
    };
    void load();
    const stop = context.watch(() => void load());
    return () => {
      live = false;
      stop();
    };
  }, [nodeId]);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const shown = (id: string) => !!byId.get(id) && !byId.get(id)!.inTrash;
  const links = linksOf(nodeId, all, shown).sort((a, b) => t(a.label).localeCompare(t(b.label)) || title(a).localeCompare(title(b)));
  function title(l: SeenLink) {
    return byId.get(l.other)?.title ?? "";
  }

  /** What can be linked to, grouped: each of World's kinds, then characters and places. */
  const groups = [
    ...KINDS.map((k) => ({ label: t(k.plural), items: nodes.filter((n) => n.kind === `world:${k.id}`) })),
    { label: t("tab.characters"), items: nodes.filter((n) => n.type === "character") },
    { label: t("tab.places"), items: nodes.filter((n) => n.type === "place") },
  ]
    .map((g) => ({ ...g, items: g.items.filter((n) => n.id !== nodeId && !n.inTrash).sort((a, b) => a.title.localeCompare(b.title)) }))
    .filter((g) => g.items.length);

  /** Changes one item's World data: reads it, changes what was read, and writes it back, once more if it changed meanwhile. */
  const change = async (holder: string, edit: (current: unknown) => unknown | null) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const next = edit(await app.project.getItemData!(holder));
        if (next !== null) await app.project.setItemData!(holder, next);
        return;
      } catch (err) {
        const name = (err as Error).name;
        if (name === "Stale" && attempt === 0) continue;
        app.ui.notify(name === "ReadOnly" ? t("tab.readOnly") : (err as Error).message);
        return;
      }
    }
  };

  return (
    <div className="insp-section world-tab">
      <span className="field-label">{t("tab.links")}</span>
      {links.length === 0 && <p className="insp-hint">{t("tab.none")}</p>}
      {links.map((l) => (
        <div key={`${l.holder}:${l.id}`} className="insp-link-row world-link" data-link={l.id}>
          <span className="chip">{t(l.label)}</span>
          <button className="link-btn ilr-title" onClick={() => void app.project.select(l.other)}>
            {title(l)}
          </button>
          <button className="icon-btn sm" title={t("tab.remove")} aria-label={t("tab.remove")} onClick={() => void change(l.holder, (cur) => removeLink(cur, l.id))}>
            ×
          </button>
        </div>
      ))}
      {groups.length > 0 && (
        <form
          className="world-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!to) return;
            void change(nodeId, (cur) => addLink(cur, nodeId, type, to)).then(() => setTo(""));
          }}
        >
          <select className="select" aria-label={t("tab.type")} value={type} onChange={(e) => setType(e.target.value as LinkType)}>
            {LINK_TYPES.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {t(lt.out)}
              </option>
            ))}
          </select>
          <select className="select" aria-label={t("tab.to")} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">{t("tab.choose")}</option>
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
            {t("tab.add")}
          </button>
        </form>
      )}
    </div>
  );
}
