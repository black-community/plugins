import { readItem } from "./links";

/*
 * World's continuity checks, for the Continuity tab (addContinuityCheck): a character in a scene set somewhere their
 * faction is banned from, and places that are located inside each other in a loop. Being banned from a place counts
 * for every place inside it, through "located in".
 */

export interface Scene {
  id: string;
  title: string;
  povId: string;
  castIds: string[];
  placeId: string;
}

export interface Finding {
  key: string;
  itemId: string;
  /** What it found, with the names to put in its message. */
  kind: "banned" | "loop";
  values: Record<string, string>;
}

/** Every link of a type, as [from, to] pairs, from every item's World data. */
function pairs(all: Record<string, unknown>, type: string): [string, string][] {
  return Object.entries(all).flatMap(([from, value]) =>
    Object.values(readItem(value).links ?? {})
      .filter((l) => l.type === type)
      .map((l): [string, string] => [from, l.to]),
  );
}

/** The places a place is inside, directly or through others, and the place itself. */
function within(place: string, located: [string, string][]): Set<string> {
  const out = new Set([place]);
  for (let added = true; added; ) {
    added = false;
    for (const [from, to] of located) if (out.has(from) && !out.has(to)) (out.add(to), (added = true));
  }
  return out;
}

export function worldChecks(scenes: Scene[], all: Record<string, unknown>, title: (id: string) => string): Finding[] {
  const out: Finding[] = [];
  const located = pairs(all, "locatedIn");
  const members = pairs(all, "memberOf");
  const banned = pairs(all, "bannedFrom");

  for (const scene of scenes) {
    if (!scene.placeId) continue;
    const places = within(scene.placeId, located);
    for (const person of new Set([scene.povId, ...scene.castIds].filter(Boolean))) {
      for (const [, group] of members.filter(([who]) => who === person)) {
        const place = banned.find(([who, where]) => who === group && places.has(where))?.[1];
        if (place)
          out.push({
            key: `banned:${scene.id}:${person}:${group}:${place}`,
            itemId: scene.id,
            kind: "banned",
            values: { name: title(person), group: title(group), place: title(place), scene: scene.title },
          });
      }
    }
  }

  // A place inside itself, through "located in": following its links outward leads back to it.
  const reported = new Set<string>();
  for (const place of new Set(located.map(([from]) => from))) {
    const outside = new Set<string>();
    const next = located.filter(([from]) => from === place).map(([, to]) => to);
    while (next.length) {
      const at = next.pop()!;
      if (outside.has(at)) continue;
      outside.add(at);
      for (const [from, to] of located) if (from === at) next.push(to);
    }
    if (outside.has(place) && !reported.has(place)) {
      reported.add(place);
      out.push({ key: `loop:${place}`, itemId: place, kind: "loop", values: { name: title(place) } });
    }
  }
  return out;
}
