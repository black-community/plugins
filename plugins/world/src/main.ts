import { createElement } from "react";
import { Plugin } from "@black/plugin";
import locales from "black:locales";
import { translator, type Translate } from "../../../shared/i18n";
import { KINDS, kindDefinitions, type Key } from "./kinds";
import { linksOf, namesOf } from "./links";
import { bibleHtml, bibleMarkdown, type BibleInput } from "./bible";
import { glossaryWords } from "./glossary";
import { readShared, withCopies, type SharedCopy } from "./sharing";
import { mentionFinder, otherNames, type Mention, type Name } from "./mentions";
import { linkable, WorldTab, type TabContext } from "./tab";
import { WorldView } from "./view";
import { KindsPicker } from "./kindsPicker";

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
  /** The glossary's words already given to the book's dictionary, so they're only given once. */
  private taught = new Set<string>();

  async onload() {
    this.t = translator<Key>(locales, this.app.language);
    const t = this.t;
    const changed = () => {
      this.watchers.forEach((w) => w());
      void this.index();
    };
    this.on("item-data-change", changed);
    this.on("nodes-change", changed);
    this.on("shared-data-change", () => {
      this.watchers.forEach((w) => w());
      // The kinds turned on or off may have changed on another device.
      void this.define();
      void this.index();
    });
    // A sheet's fields don't send an event as they're edited, so shared copies catch up when the writer moves on.
    this.on("selection-change", () => void this.syncShared());
    this.on("project-open", () => {
      this.taught.clear();
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
      chooseKinds: () => this.chooseKinds(),
      kindsOff: () => this.kindsOff(),
      sharing: {
        inSeries: async () => !!(await this.app.project.info())?.series,
        isShared: async (id) => readShared(await this.app.project.getSharedData?.()).entries.some((e) => e.id === id),
        set: (id, on) => this.share(id, on),
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

    this.addCommand({ id: "kinds", name: t("kinds.command"), run: () => this.chooseKinds() });

    // The world bible, as a format in Compile.
    for (const format of ["markdown", "html"] as const)
      this.addExporter({
        id: `bible-${format}`,
        name: t(format === "markdown" ? "export.markdown" : "export.html"),
        description: t("export.description"),
        extension: format === "markdown" ? "md" : "html",
        export: async (book) => {
          const input = await this.bible(book.title);
          return format === "markdown" ? bibleMarkdown(input) : bibleHtml(input, book.language);
        },
      });

    await this.define();
    await this.index();
  }

  /** Gathers the world for its bible: every entry, kind by kind, with its fields, links and text. */
  private async bible(title: string): Promise<BibleInput> {
    const t = this.t;
    const [nodes, data] = await Promise.all([this.app.project.nodes(), this.app.project.itemsWithData?.() ?? ({} as Record<string, unknown>)]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const exists = (id: string) => !!byId.get(id) && !byId.get(id)!.inTrash;
    const kinds = [];
    for (const kind of KINDS) {
      const entries = nodes.filter((n) => n.kind === `world:${kind.id}` && !n.inTrash).sort((a, b) => a.title.localeCompare(b.title));
      const out = [];
      for (const e of entries) {
        const meta = await this.app.project.meta(e.id);
        out.push({
          title: e.title,
          names: namesOf(data[e.id]),
          synopsis: meta?.synopsis ?? "",
          fields: Object.entries(meta?.fields ?? {}).filter(([, v]) => v.trim()),
          links: linksOf(e.id, data, exists).map((l) => ({ label: t(l.label), other: byId.get(l.other)?.title ?? "" })),
          text: await this.app.project.readText(e.id),
        });
      }
      kinds.push({ plural: t(kind.plural), entries: out });
    }
    return { title, kinds, words: { otherNames: t("export.otherNames"), links: t("export.links"), empty: t("export.empty") } };
  }

  /** The copy of an entry that the series bible shows. */
  private async copyOf(id: string): Promise<SharedCopy | null> {
    const node = await this.app.project.node(id);
    const kind = node?.kind?.startsWith("world:") ? node.kind.slice("world:".length) : null;
    if (!node || !kind || node.inTrash) return null;
    const meta = await this.app.project.meta(id);
    const fields = Object.fromEntries(Object.entries(meta?.fields ?? {}).filter(([, v]) => v.trim()));
    return { id, kind, title: node.title, synopsis: meta?.synopsis ?? "", fields };
  }

  /** Changes World's shared data: reads it, applies the changes, and writes it back, once more if it changed meanwhile. */
  private async writeShared(changes: () => Promise<Map<string, SharedCopy | null>>) {
    const project = this.app.project;
    if (!project.getSharedData || !project.setSharedData) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const next = withCopies(await project.getSharedData(), await changes());
        if (next) await project.setSharedData(next);
        return;
      } catch (err) {
        const name = (err as Error).name;
        if (name === "Stale" && attempt === 0) continue;
        if (name === "ReadOnly") return;
        throw err;
      }
    }
  }

  /** Shares an entry with the series, or stops sharing it. */
  private async share(id: string, on: boolean) {
    try {
      await this.writeShared(async () => new Map([[id, on ? await this.copyOf(id) : null]]));
    } catch (err) {
      this.app.ui.notify((err as Error).message);
    }
  }

  /** Brings the shared copies of this book's entries up to date. Copies of other books' entries are left alone. */
  private async syncShared() {
    try {
      if (!(await this.app.project.info())?.series) return;
      const { entries } = readShared(await this.app.project.getSharedData?.());
      if (!entries.length) return;
      await this.writeShared(async () => {
        const changes = new Map<string, SharedCopy | null>();
        for (const e of entries) if (await this.app.project.node(e.id)) changes.set(e.id, await this.copyOf(e.id));
        return changes;
      });
    } catch {
      // Tried again at the next change.
    }
  }

  /**
   * Adds a "Region" field to each place's sheet, for places within places, once: a place that has had it is marked in
   * its item data, so a writer who removes the field doesn't get it back.
   */
  private async addRegions(nodes: { id: string; type: string; inTrash: boolean }[], data: Record<string, unknown>) {
    const project = this.app.project;
    if (!project.setItemData) return;
    const info = await project.info();
    const region = translator<Key>(locales, info?.language || this.app.language)("field.place.region");
    try {
      for (const place of nodes.filter((n) => n.type === "place" && !n.inTrash)) {
        const mine = data[place.id];
        if (mine && typeof mine === "object" && (mine as { region?: boolean }).region) continue;
        const meta = await project.meta(place.id);
        if (meta && !(region in meta.fields)) await project.setMeta(place.id, { fields: { ...meta.fields, [region]: "" } });
        const current = await project.getItemData!(place.id);
        await project.setItemData(place.id, { ...(current && typeof current === "object" ? current : {}), region: true });
      }
    } catch {
      // A book that can't be changed here, or a change meanwhile: tried again at the next change.
    }
  }

  /** Gives the glossary's words to the book's spelling dictionary, once each. */
  private async teach(names: string[]) {
    const words = glossaryWords(names).filter((w) => !this.taught.has(w));
    if (!words.length || !this.app.project.addToDictionary) return;
    try {
      await this.app.project.addToDictionary(words);
    } catch (err) {
      // A book that can't be changed here keeps its dictionary.
      if ((err as Error).name !== "ReadOnly") return;
    }
    words.forEach((w) => this.taught.add(w));
  }

  /** The kinds the writer turned off, from World's shared data. */
  private async kindsOff(): Promise<string[]> {
    const { rest } = readShared(await this.app.project.getSharedData?.().catch(() => undefined));
    return Array.isArray(rest.kindsOff) ? rest.kindsOff.filter((k): k is string => typeof k === "string") : [];
  }

  /** Opens the dialog where the writer turns kinds on and off. */
  private async chooseKinds() {
    const off = await this.kindsOff();
    this.app.ui.openModal({
      title: this.t("kinds.title"),
      render: (closeIt) =>
        createElement(KindsPicker, {
          t: this.t,
          off,
          close: closeIt,
          onChange: async (id, on) => {
            try {
              await this.writeKindsOff(id, on);
              await this.define();
            } catch (err) {
              this.app.ui.notify((err as Error).name === "ReadOnly" ? this.t("tab.readOnly") : (err as Error).message);
              throw err;
            }
          },
        }),
    });
  }

  /** Turns a kind on or off in World's shared data: reads it, changes it, and writes it, once more if it changed meanwhile. */
  private async writeKindsOff(id: string, on: boolean) {
    const project = this.app.project;
    if (!project.getSharedData || !project.setSharedData) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const current = await project.getSharedData();
        const data = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
        const was = Array.isArray(data.kindsOff) ? (data.kindsOff as string[]) : [];
        const kindsOff = on ? was.filter((k) => k !== id) : [...new Set([...was, id])];
        await project.setSharedData({ ...data, kindsOff });
        return;
      } catch (err) {
        if ((err as Error).name === "Stale" && attempt === 0) continue;
        throw err;
      }
    }
  }

  /** Defines World's kinds in the open book, in the book's language, with those the writer turned off hidden. */
  private async define() {
    const info = await this.app.project.info();
    if (!info || !this.app.project.defineKind) return;
    const t = translator<Key>(locales, info.language || this.app.language);
    const off = await this.kindsOff();
    try {
      for (const kind of kindDefinitions(t)) await this.app.project.defineKind(off.includes(kind.id) ? { ...kind, hidden: true } : kind);
    } catch (err) {
      // A book that can't be changed here (a reader's, or after the trial) keeps the kinds it has.
      if ((err as Error).name !== "ReadOnly") throw err;
    }
  }

  /** Reads the entries' names and other names again, and marks the text with them. */
  private index() {
    this.indexing ??= (async () => {
      try {
        const [nodes, data, off] = await Promise.all([
          this.app.project.nodes(),
          this.app.project.itemsWithData?.() ?? ({} as Record<string, unknown>),
          this.kindsOff(),
        ]);
        const names: Name[] = [];
        const known = new Map<string, Known>();
        const terms: string[] = [];
        for (const node of nodes) {
          const kind = KINDS.find((k) => node.kind === `world:${k.id}`);
          // A kind the writer turned off isn't marked or suggested, as its entries aren't shown.
          if (node.type !== "entry" || !kind || off.includes(kind.id) || node.inTrash || !node.title.trim()) continue;
          known.set(node.id, { title: node.title.trim(), kind: this.t(kind.name) });
          for (const name of [node.title, ...otherNames(namesOf(data[node.id]))]) {
            names.push({ name: name.trim(), entry: node.id });
            if (kind.id === "term") terms.push(name);
          }
        }
        this.names = names;
        this.known = known;
        this.find = mentionFinder(names);
        this.refreshHighlights();
        await this.teach(terms);
        await this.addRegions(nodes, data);
        await this.syncShared();
      } catch {
        // No book open: there's nothing to mark.
      } finally {
        this.indexing = null;
      }
    })();
    return this.indexing;
  }
}
