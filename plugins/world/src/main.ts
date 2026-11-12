import { createElement } from "react";
import { Plugin } from "@black/plugin";
import locales from "black:locales";
import { translator, type Translate } from "../../../shared/i18n";
import { KINDS, kindDefinitions, type Key } from "./kinds";
import { namesOf } from "./links";
import { mentionFinder, otherNames, type Mention, type Name } from "./mentions";
import { linkable, WorldTab, type TabContext } from "./tab";
import { WorldView } from "./view";

/** The World view's icon: a globe, drawn like the app's own icons. */
const GlobeIcon = ({ size = 16 }: { size?: number }) =>
  createElement(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
    createElement("circle", { cx: 12, cy: 12, r: 10 }),
    createElement("path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }),
    createElement("path", { d: "M2 12h20" }),
  );

/** An entry, as the marks in the text and the suggestions need it. */
interface Known {
  title: string;
  /** Its kind's name, in the writer's language. */
  kind: string;
}

/**
 * World: kinds of entry for the world a story is set in, such as factions and cultures, each with a sheet in a World
 * section of the navigator. Links between them, characters and places are shown both ways in a World tab, every entry
 * is a card in the World view, and their names are marked in the text and suggested after #. Everything is kept in the
 * book, so it syncs and co-authors see it (black/docs/plugin-world-building-plan.md, "A world-building plugin").
 */
export default class World extends Plugin {
  private t!: Translate<Key>;
  /** The open World tabs and view, told when items or their World data change, here or on another device. */
  private watchers = new Set<() => void>();
  /** The entries' names, kept in memory, so marking a paragraph or answering a keystroke doesn't wait. */
  private names: Name[] = [];
  private known = new Map<string, Known>();
  private find: (text: string) => Mention[] = () => [];
  private indexing: Promise<void> | null = null;

  async onload() {
    this.t = translator<Key>(locales, this.app.language);
    const t = this.t;
    const changed = () => {
      this.watchers.forEach((w) => w());
      void this.index();
    };
    this.on("item-data-change", changed);
    this.on("nodes-change", changed);
    this.on("project-open", () => {
      void this.define();
      void this.index();
    });

    const context: TabContext = {
      app: this.app,
      t,
      watch: (callback) => {
        this.watchers.add(callback);
        return () => this.watchers.delete(callback);
      },
    };
    this.addInspectorTab({
      id: "world",
      name: t("tab.name"),
      when: (_id, node) => linkable(node),
      render: (nodeId) => createElement(WorldTab, { key: nodeId, nodeId, context }),
    });
    this.addView({ id: "world", name: t("view.name"), icon: GlobeIcon, render: () => createElement(WorldView, { context }) });

    // The entries' names in the text, with what each is. Its menu opens the entry.
    this.addHighlighter({
      id: "mentions",
      // The app's slate, for information, so a mention doesn't look like a mistake.
      color: "var(--info)",
      find: (text) =>
        this.find(text).map((m) => {
          const known = this.known.get(m.entry);
          return {
            from: m.from,
            to: m.to,
            message: known ? t("mention.message", { name: known.title, kind: known.kind }) : undefined,
            actions: known ? [{ id: `open:${m.entry}`, label: t("mention.open", { name: known.title }) }] : [],
          };
        }),
      onAction: (action) => {
        if (action.startsWith("open:")) void this.app.project.select(action.slice("open:".length));
      },
    });
    // Typing # suggests them, by any word of a name or other name.
    this.addSuggester({
      id: "entries",
      trigger: "#",
      find: (typed) => {
        const q = typed.trim().toLocaleLowerCase();
        return this.names
          .filter((n) => !q || n.name.toLocaleLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || n.name.toLocaleLowerCase().startsWith(q))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 12)
          .map((n) => {
            const known = this.known.get(n.entry);
            const other = known && known.title !== n.name;
            return { label: n.name, insert: n.name, detail: other ? known.title : known?.kind };
          });
      },
    });

    await this.define();
    await this.index();
  }

  /** Defines World's kinds in the open book, in the book's language. Already there as they are, nothing changes. */
  private async define() {
    const info = await this.app.project.info();
    if (!info || !this.app.project.defineKind) return;
    const t = translator<Key>(locales, info.language || this.app.language);
    try {
      for (const kind of kindDefinitions(t)) await this.app.project.defineKind(kind);
    } catch (err) {
      // A book that can't be changed here (a reader's, or after the trial) keeps the kinds it has.
      if ((err as Error).name !== "ReadOnly") throw err;
    }
  }

  /** Reads the entries' names and other names again, and marks the text with them. */
  private index() {
    this.indexing ??= (async () => {
      try {
        const [nodes, data] = await Promise.all([this.app.project.nodes(), this.app.project.itemsWithData?.() ?? ({} as Record<string, unknown>)]);
        const names: Name[] = [];
        const known = new Map<string, Known>();
        for (const node of nodes) {
          const kind = KINDS.find((k) => node.kind === `world:${k.id}`);
          if (node.type !== "entry" || !kind || node.inTrash || !node.title.trim()) continue;
          known.set(node.id, { title: node.title.trim(), kind: this.t(kind.name) });
          for (const name of [node.title, ...otherNames(namesOf(data[node.id]))]) names.push({ name: name.trim(), entry: node.id });
        }
        this.names = names;
        this.known = known;
        this.find = mentionFinder(names);
        this.refreshHighlights();
      } catch {
        // No book open: there's nothing to mark.
      } finally {
        this.indexing = null;
      }
    })();
    return this.indexing;
  }
}
