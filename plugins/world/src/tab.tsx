import type { App, NodeInfo } from "@black/plugin";
import { useEffect, useState } from "react";
import type { Translate } from "../../../shared/i18n";
import { KINDS, type Key } from "./kinds";
import { addLink, LINK_TYPES, linksOf, namesOf, removeLink, setNames, type LinkType, type SeenLink } from "./links";
import { mentionFinder, otherNames } from "./mentions";
import type { WorldCalendar } from "./calendar";
import { mapsWith } from "./maps";
import { MapBoard } from "./mapBoard";

/** What the tab needs from the plugin: the app, its words in the writer's language, and word of changes. */
export interface TabContext {
  app: App;
  t: Translate<Key>;
  /** Calls back when items or their World data change, here or elsewhere. Returns how to stop. */
  watch(callback: () => void): () => void;
  /** Opens the dialog where the writer turns kinds on and off. */
  chooseKinds(): void;
  /** The kinds the writer turned off, whose entries aren't shown. */
  kindsOff(): Promise<string[]>;
  /** The world's calendar, and the dialog to set it up. */
  calendar(): Promise<WorldCalendar | null>;
  editCalendar(): void;
  /** Shows a map in the Map view. */
  openMap(mapId: string): void;
  /** The map the Map view shows, and choosing another there. */
  currentMap(): string;
  showMap(mapId: string): void;
  /** Sharing entries with the series, whose bible shows them. */
  sharing: {
    inSeries(): Promise<boolean>;
    isShared(id: string): Promise<boolean>;
    set(id: string, on: boolean): Promise<void>;
  };
}

/** What can be linked or pinned, grouped: each of World's kinds, then characters and places. */
export function targetGroups(nodes: NodeInfo[], t: Translate<Key>, except: string) {
  return [
    ...KINDS.map((k) => ({ label: t(k.plural), items: nodes.filter((n) => n.kind === `world:${k.id}`) })),
    { label: t("tab.characters"), items: nodes.filter((n) => n.type === "character") },
    { label: t("tab.places"), items: nodes.filter((n) => n.type === "place") },
  ]
    .map((g) => ({ ...g, items: g.items.filter((n) => n.id !== except && !n.inTrash).sort((a, b) => a.title.localeCompare(b.title)) }))
    .filter((g) => g.items.length);
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
  /** The other names as the writer is typing them, saved when they leave the field. */
  const [names, setNamesText] = useState<string | null>(null);
  /** Whether the book is in a series, and whether this entry is shared with it. */
  const [shared, setShared] = useState<{ inSeries: boolean; on: boolean } | null>(null);
  /** The scenes that mention this entry, once they've been read. */
  const [mentioned, setMentioned] = useState<{ id: string; title: string }[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [n, data] = await Promise.all([app.project.nodes(), app.project.itemsWithData?.() ?? {}]);
      if (live) {
        setNodes(n);
        setAll(data);
      }
    };
    const loadSharing = async () => {
      const inSeries = await context.sharing.inSeries();
      const on = inSeries && (await context.sharing.isShared(nodeId));
      if (live) setShared({ inSeries, on });
    };
    void load();
    void loadSharing();
    const stop = context.watch(() => {
      void load();
      void loadSharing();
    });
    return () => {
      live = false;
      stop();
    };
  }, [nodeId]);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  const isEntry = node?.type === "entry";
  const savedNames = namesOf(all[nodeId]);
  const lookFor = isEntry ? [node!.title, ...otherNames(savedNames)].join("\n") : "";

  // The scenes that mention it: read again when its names change.
  useEffect(() => {
    if (!lookFor) return setMentioned(null);
    let live = true;
    void (async () => {
      const find = mentionFinder(lookFor.split("\n").map((name) => ({ name, entry: nodeId })));
      const found: { id: string; title: string }[] = [];
      for (const id of await app.project.manuscript()) {
        if (find(await app.project.readText(id)).length) found.push({ id, title: byId.get(id)?.title ?? "" });
        if (!live) return;
      }
      setMentioned(found);
    })();
    return () => {
      live = false;
    };
  }, [nodeId, lookFor]);
  const shown = (id: string) => !!byId.get(id) && !byId.get(id)!.inTrash;
  const links = linksOf(nodeId, all, shown).sort((a, b) => t(a.label).localeCompare(t(b.label)) || title(a).localeCompare(title(b)));
  function title(l: SeenLink) {
    return byId.get(l.other)?.title ?? "";
  }

  const groups = targetGroups(nodes, t, nodeId);

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
      {isEntry && (
        <div className="field">
          <label htmlFor="world-names">{t("tab.otherNames")}</label>
          <input
            id="world-names"
            className="input selectable"
            placeholder={t("tab.otherNamesHint")}
            value={names ?? savedNames}
            onChange={(e) => setNamesText(e.target.value)}
            onBlur={() => {
              if (names !== null && names !== savedNames) void change(nodeId, (cur) => setNames(cur, names)).then(() => setNamesText(null));
            }}
          />
        </div>
      )}
      {isEntry && shared?.inSeries && (
        <label className="checkbox world-share" title={t("tab.shareHint")}>
          <input type="checkbox" checked={shared.on} onChange={(e) => void context.sharing.set(nodeId, e.target.checked)} />
          {t("tab.share")}
        </label>
      )}
      {node?.kind === "world:map" && (
        <>
          <MapBoard mapId={nodeId} context={context} />
          <button className="link-btn" onClick={() => context.openMap(nodeId)}>
            {t("map.open")}
          </button>
        </>
      )}
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
      {mapsWith(nodeId, all).filter(shown).length > 0 && (
        <>
          <span className="field-label">{t("map.onMaps")}</span>
          {mapsWith(nodeId, all)
            .filter(shown)
            .map((map) => (
              <button key={map} className="insp-link-row world-mention" onClick={() => context.openMap(map)}>
                <span className="ilr-title">{byId.get(map)?.title}</span>
              </button>
            ))}
        </>
      )}
      {isEntry && (
        <>
          <span className="field-label">{t("tab.mentioned")}</span>
          {mentioned === null ? (
            <p className="insp-hint">{t("tab.reading")}</p>
          ) : mentioned.length === 0 ? (
            <p className="insp-hint">{t("tab.notMentioned")}</p>
          ) : (
            mentioned.map((s) => (
              <button key={s.id} className="insp-link-row world-mention" onClick={() => void app.project.select(s.id)}>
                <span className="ilr-title">{s.title}</span>
              </button>
            ))
          )}
        </>
      )}
    </div>
  );
}
