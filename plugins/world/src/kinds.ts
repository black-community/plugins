import type { KindDefinition, KindIcon } from "@black/plugin";
import type { Translate } from "../../../shared/i18n";
import type en from "../locales/en.json";

export type Key = keyof typeof en.messages;

/** A kind of entry World offers, with the keys of its words: they're written into the book in the book's language. */
export interface WorldKind {
  id: string;
  icon: KindIcon;
  name: Key;
  plural: Key;
  fields: Key[];
}

/** The kinds of entry, in the order they're listed. Places stay the app's own, so scenes and the timeline keep using them. */
export const KINDS: WorldKind[] = [
  { id: "faction", icon: "banner", name: "kind.faction.name", plural: "kind.faction.plural", fields: ["field.faction.leader", "field.faction.seat", "field.faction.goals", "field.faction.allies", "field.faction.enemies", "field.faction.symbol", "field.faction.founded"] },
  { id: "culture", icon: "users", name: "kind.culture.name", plural: "kind.culture.plural", fields: ["field.culture.region", "field.culture.language", "field.culture.customs", "field.culture.beliefs", "field.culture.food", "field.culture.dress"] },
  { id: "religion", icon: "church", name: "kind.religion.name", plural: "kind.religion.plural", fields: ["field.religion.gods", "field.religion.clergy", "field.religion.holyPlaces", "field.religion.teachings", "field.religion.rites"] },
  { id: "creature", icon: "paw", name: "kind.creature.name", plural: "kind.creature.plural", fields: ["field.creature.habitat", "field.creature.size", "field.creature.diet", "field.creature.danger", "field.creature.lore"] },
  { id: "artifact", icon: "gem", name: "kind.artifact.name", plural: "kind.artifact.plural", fields: ["field.artifact.madeBy", "field.artifact.owner", "field.artifact.powers", "field.artifact.whereabouts"] },
  { id: "magic", icon: "wand", name: "kind.magic.name", plural: "kind.magic.plural", fields: ["field.magic.source", "field.magic.cost", "field.magic.limits", "field.magic.whoCanUseIt"] },
  { id: "language", icon: "languages", name: "kind.language.name", plural: "kind.language.plural", fields: ["field.language.spokenIn", "field.language.sounds", "field.language.sampleWords"] },
];

/** The section all of World's kinds share, at the top of the navigator. */
export const SECTION = "world";

/**
 * Returns the kinds as the book keeps them, in one language. It's the book's language and not the writer's, so
 * co-authors who use the app in different languages define the same kinds and don't keep changing them back and forth.
 */
export function kindDefinitions(t: Translate<Key>): KindDefinition[] {
  return KINDS.map((k) => ({
    id: k.id,
    name: t(k.name),
    plural: t(k.plural),
    icon: k.icon,
    fields: k.fields.map((f) => t(f)),
    section: { id: SECTION, name: t("section") },
  }));
}
