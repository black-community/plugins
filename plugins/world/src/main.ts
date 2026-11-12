import { createElement } from "react";
import { Plugin } from "@black/plugin";
import locales from "black:locales";
import { translator, type Translate } from "../../../shared/i18n";
import { kindDefinitions, type Key } from "./kinds";
import { linkable, WorldTab, type TabContext } from "./tab";

/**
 * World: kinds of entry for the world a story is set in, such as factions and cultures, each with a sheet in a World
 * section of the navigator, and links between them, characters and places, shown both ways in a World tab. Everything
 * is kept in the book, so it syncs and co-authors see it (black/docs/plugin-world-building-plan.md, "A world-building
 * plugin").
 */
export default class World extends Plugin {
  private t!: Translate<Key>;
  /** The open World tabs, told when items or their World data change, here or on another device. */
  private watchers = new Set<() => void>();

  async onload() {
    this.t = translator<Key>(locales, this.app.language);
    const tell = () => this.watchers.forEach((w) => w());
    this.on("item-data-change", tell);
    this.on("nodes-change", tell);
    this.on("project-open", () => void this.define());

    const context: TabContext = {
      app: this.app,
      t: this.t,
      watch: (callback) => {
        this.watchers.add(callback);
        return () => this.watchers.delete(callback);
      },
    };
    this.addInspectorTab({
      id: "world",
      name: this.t("tab.name"),
      when: (_id, node) => linkable(node),
      render: (nodeId) => createElement(WorldTab, { key: nodeId, nodeId, context }),
    });
    await this.define();
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
}
