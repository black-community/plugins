import type { Key } from "./kinds";

/*
 * Links between the things in a world: a character is a member of a faction, a faction rules a place, and so on. A
 * link is kept in the item data of the item it starts from, and shown on both items. Links are kept by id in an
 * object, not in a list: Bläck Sync merges plugin data key by key, so two people adding links to one item at the same
 * time both keep theirs (black/docs/plugin-world-building-plan.md, "A world-building plugin").
 */

/** The types of link, each with its words from both ends. A link that reads the same both ways is symmetric. */
export const LINK_TYPES = [
  { id: "memberOf", out: "link.memberOf.out", in: "link.memberOf.in" },
  { id: "rules", out: "link.rules.out", in: "link.rules.in" },
  { id: "enemyOf", out: "link.enemyOf.out", in: "link.enemyOf.out" },
  { id: "locatedIn", out: "link.locatedIn.out", in: "link.locatedIn.in" },
  { id: "madeBy", out: "link.madeBy.out", in: "link.madeBy.in" },
  { id: "worships", out: "link.worships.out", in: "link.worships.in" },
] as const satisfies readonly { id: string; out: Key; in: Key }[];

export type LinkType = (typeof LINK_TYPES)[number]["id"];

export interface Link {
  type: LinkType;
  /** The item the link points to. */
  to: string;
}

/** What World keeps with one item. Anything else in it, from a later version, is kept as it is. */
export interface ItemWorld {
  links?: Record<string, Link>;
  /** The entry's other names, as the writer typed them: separated by commas (mentions.ts, otherNames). */
  names?: string;
  [other: string]: unknown;
}

const isType = (v: unknown): v is LinkType => LINK_TYPES.some((t) => t.id === v);

/** Reads an item's World data, skipping links that aren't in the form this version knows. */
export function readItem(value: unknown): ItemWorld {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const item = value as ItemWorld;
  const links: Record<string, Link> = {};
  for (const [id, raw] of Object.entries(item.links && typeof item.links === "object" ? item.links : {})) {
    const link = raw as Partial<Link> | null;
    if (link && isType(link.type) && typeof link.to === "string" && link.to) links[id] = { type: link.type, to: link.to };
  }
  return { ...item, links };
}

/** A new link's id: unique enough that two devices adding links at once don't pick the same one. */
export const newLinkId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Returns the item's data with a link added, or null if there's nothing to add: a link to itself, or one that's
 * already there. Everything else in the data is kept, including links this version doesn't know.
 */
export function addLink(current: unknown, from: string, type: LinkType, to: string, id = newLinkId()): ItemWorld | null {
  if (from === to) return null;
  const item = current && typeof current === "object" && !Array.isArray(current) ? (current as ItemWorld) : {};
  const known = readItem(item).links ?? {};
  if (Object.values(known).some((l) => l.type === type && l.to === to)) return null;
  return { ...item, links: { ...(item.links ?? {}), [id]: { type, to } } };
}

/** Returns the item's data without one link. Everything else in it is kept. */
export function removeLink(current: unknown, id: string): ItemWorld {
  const item = current && typeof current === "object" && !Array.isArray(current) ? (current as ItemWorld) : {};
  const links = { ...(item.links ?? {}) };
  delete links[id];
  return { ...item, links };
}

/** A link as one item sees it: which item holds it, its id, the words for it from this end, and the other item. */
export interface SeenLink {
  /** The item whose data holds the link, to change it. */
  holder: string;
  id: string;
  type: LinkType;
  /** Whether it's this item's own link, or one pointing at it. */
  outgoing: boolean;
  label: Key;
  other: string;
}

/**
 * Returns every link of an item, both ways: its own, and those of other items that point at it. `all` is every item's
 * World data, by id (app.project.itemsWithData). A link to an item that's no longer there is left out, though kept.
 */
export function linksOf(id: string, all: Record<string, unknown>, exists: (id: string) => boolean): SeenLink[] {
  const out: SeenLink[] = [];
  for (const [holder, value] of Object.entries(all)) {
    for (const [linkId, link] of Object.entries(readItem(value).links ?? {})) {
      const type = LINK_TYPES.find((t) => t.id === link.type)!;
      if (holder === id && exists(link.to)) out.push({ holder, id: linkId, type: link.type, outgoing: true, label: type.out, other: link.to });
      else if (link.to === id && exists(holder)) out.push({ holder, id: linkId, type: link.type, outgoing: false, label: type.in, other: holder });
    }
  }
  return out;
}

/** Returns the item's data with its other names set, as the writer typed them. Everything else in it is kept. */
export function setNames(current: unknown, text: string): ItemWorld {
  const item = current && typeof current === "object" && !Array.isArray(current) ? (current as ItemWorld) : {};
  return { ...item, names: text };
}

/** Returns an item's other names text, or '' if it has none. */
export const namesOf = (value: unknown) => {
  const names = value && typeof value === "object" ? (value as ItemWorld).names : undefined;
  return typeof names === "string" ? names : "";
};
