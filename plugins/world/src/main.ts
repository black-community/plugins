import { Plugin } from "@black/plugin";
import locales from "black:locales";
import { translator } from "../../../shared/i18n";
import { kindDefinitions, type Key } from "./kinds";

/**
 * World: kinds of entry for the world a story is set in, such as factions and cultures, each with a sheet in a World
 * section of the navigator. Everything is kept in the book, so it syncs and co-authors see it
 * (black/docs/plugin-world-building-plan.md, "A world-building plugin").
 */
export default class World extends Plugin {
  async onload() {
    this.on("project-open", () => void this.define());
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
