/*
 * Maps: a map is an entry of World's Map kind, its picture the map. Pins on it are kept in its item data, by id, so two
 * people pinning at once both keep theirs. A pin's place on the picture is a fraction of its width and height, so it
 * stays put whatever size the map is shown at.
 */

export interface Pin {
  x: number;
  y: number;
  /** What it marks: an entry, a character or a place. */
  to: string;
}

const isPin = (v: unknown): v is Pin => {
  const p = v as Partial<Pin> | null;
  return !!p && typeof p.to === "string" && !!p.to && [p.x, p.y].every((n) => typeof n === "number" && n >= 0 && n <= 1);
};

/** A map's pins, by id, skipping any not in this form. */
export function readPins(value: unknown): Record<string, Pin> {
  const pins = value && typeof value === "object" ? (value as { pins?: unknown }).pins : undefined;
  return Object.fromEntries(Object.entries(pins && typeof pins === "object" ? pins : {}).filter(([, p]) => isPin(p))) as Record<string, Pin>;
}

const asObject = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Returns the map's data with a pin added. Everything else in it is kept. */
export function addPin(current: unknown, pin: Pin, id: string) {
  const item = asObject(current);
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return { ...item, pins: { ...asObject(item.pins), [id]: { x: clamp(pin.x), y: clamp(pin.y), to: pin.to } } };
}

/** Returns the map's data without one pin. */
export function removePin(current: unknown, id: string) {
  const item = asObject(current);
  const pins = { ...asObject(item.pins) };
  delete pins[id];
  return { ...item, pins };
}

/** The maps an item is pinned on, by map id. */
export function mapsWith(id: string, all: Record<string, unknown>): string[] {
  return Object.entries(all)
    .filter(([, value]) => Object.values(readPins(value)).some((p) => p.to === id))
    .map(([map]) => map);
}
