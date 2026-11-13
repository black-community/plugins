import type { MetaInfo, NodeInfo } from "@black-studio/plugin";
import { useEffect, useState } from "react";
import { KINDS } from "./kinds";
import { linksOf, namesOf } from "./links";
import type { TabContext } from "./tab";
import { CalendarView } from "./calendarView";

/** An entry as a card shows it. */
interface Card {
  node: NodeInfo;
  names: string;
  meta: MetaInfo | null;
}

/** Whether a card matches what's typed in the search: its name, other names, synopsis or any field. */
const matches = (card: Card, query: string) => {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  const texts = [card.node.title, card.names, card.meta?.synopsis ?? "", ...Object.values(card.meta?.fields ?? {})];
  return texts.some((text) => text.toLocaleLowerCase().includes(q));
};

/** The first filled fields of a card, to show under its name. */
const glimpse = (meta: MetaInfo | null) =>
  Object.entries(meta?.fields ?? {})
    .filter(([, v]) => v.trim())
    .slice(0, 3);

/**
 * The World view, beside the corkboard and outliner: every entry as a card, grouped by kind, with a search and a filter
 * by what they're linked to. Clicking a card opens it, and the inspector shows its sheet and links beside the view.
 */
export function WorldView({ context }: { context: TabContext }) {
  const { app, t } = context;
  const [cards, setCards] = useState<Card[] | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [all, setAll] = useState<Record<string, unknown>>({});
  const [query, setQuery] = useState("");
  /** The entries as cards, or the scenes in the world's calendar. */
  const [mode, setMode] = useState<"entries" | "calendar">("entries");
  const [linkedTo, setLinkedTo] = useState("");

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [n, data, off] = await Promise.all([app.project.nodes(), app.project.itemsWithData?.() ?? ({} as Record<string, unknown>), context.kindsOff()]);
      // Entries of a kind the writer turned off aren't shown.
      const entries = n.filter((x) => x.type === "entry" && x.kind?.startsWith("world:") && !off.includes(x.kind.slice("world:".length)) && !x.inTrash);
      const metas = await Promise.all(entries.map((e) => app.project.meta(e.id)));
      if (!live) return;
      setNodes(n);
      setAll(data);
      setCards(entries.map((node, i) => ({ node, names: namesOf(data[node.id]), meta: metas[i] })));
    };
    void load();
    const stop = context.watch(() => void load());
    return () => {
      live = false;
      stop();
    };
  }, []);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const exists = (id: string) => !!byId.get(id) && !byId.get(id)!.inTrash;
  /** The items that have links, to filter by: anything linked to something. */
  const linkedItems = [...new Set(nodes.filter((n) => exists(n.id) && linksOf(n.id, all, exists).length).map((n) => n.id))]
    .map((id) => byId.get(id)!)
    .sort((a, b) => a.title.localeCompare(b.title));
  const linked = linkedTo ? new Set(linksOf(linkedTo, all, exists).map((l) => l.other)) : null;
  const shown = (cards ?? []).filter((c) => matches(c, query) && (!linked || linked.has(c.node.id)));

  return (
    <div className="world-view">
      <div className="world-view-bar">
        <div className="segmented world-view-modes">
          <button aria-pressed={mode === "entries"} onClick={() => setMode("entries")}>
            {t("calendar.entries")}
          </button>
          <button aria-pressed={mode === "calendar"} onClick={() => setMode("calendar")}>
            {t("calendar.tab")}
          </button>
        </div>
        {mode === "calendar" ? (
          <button className="btn sm" onClick={() => context.editCalendar()}>
            {t("calendar.edit")}
          </button>
        ) : (
          <>
        <input
          className="input selectable"
          type="search"
          aria-label={t("view.search")}
          placeholder={t("view.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn sm" onClick={() => context.chooseKinds()}>
          {t("kinds.button")}
        </button>
        {linkedItems.length > 0 && (
          <select className="select" aria-label={t("view.linkedTo")} value={linkedTo} onChange={(e) => setLinkedTo(e.target.value)}>
            <option value="">{t("view.anyLink")}</option>
            {linkedItems.map((n) => (
              <option key={n.id} value={n.id}>
                {t("view.linkedToItem", { name: n.title })}
              </option>
            ))}
          </select>
        )}
          </>
        )}
      </div>
      {mode === "calendar" ? (
        <CalendarView context={context} />
      ) : cards === null ? null : cards.length === 0 ? (
        <p className="insp-hint world-view-empty">{t("view.empty")}</p>
      ) : shown.length === 0 ? (
        <p className="insp-hint world-view-empty">{t("view.noMatch")}</p>
      ) : (
        KINDS.map((kind) => {
          const group = shown.filter((c) => c.node.kind === `world:${kind.id}`).sort((a, b) => a.node.title.localeCompare(b.node.title));
          if (!group.length) return null;
          return (
            <section key={kind.id} className="world-view-group" data-kind={kind.id}>
              <h3 className="field-label">{t(kind.plural)}</h3>
              <div className="world-cards">
                {group.map((c) => (
                  <button key={c.node.id} className="world-card" data-entry={c.node.id} onClick={() => void app.project.select(c.node.id)}>
                    <strong>{c.node.title}</strong>
                    {c.names && <span className="world-card-names">{c.names}</span>}
                    {c.meta?.synopsis && <span className="world-card-synopsis">{c.meta.synopsis}</span>}
                    {glimpse(c.meta).map(([field, value]) => (
                      <span key={field} className="world-card-field">
                        <em>{field}</em> {value}
                      </span>
                    ))}
                  </button>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
