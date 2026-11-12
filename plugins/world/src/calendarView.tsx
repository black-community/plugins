import { useEffect, useState } from "react";
import type { Translate } from "../../../shared/i18n";
import { monthsText, parseMonths, worldDate, yearLabel, type WorldCalendar } from "./calendar";
import type { Key } from "./kinds";
import type { TabContext } from "./tab";

/** The dialog where the writer sets up the world's calendar: its months and days, the start year, and the era. */
export function CalendarDialog({ t, calendar, save, close }: { t: Translate<Key>; calendar: WorldCalendar | null; save: (c: WorldCalendar) => Promise<void>; close: () => void }) {
  const [months, setMonths] = useState(calendar ? monthsText(calendar.months) : "");
  const [startYear, setStartYear] = useState(String(calendar?.startYear ?? 1));
  const [era, setEra] = useState(calendar?.era ?? "");
  const [problem, setProblem] = useState("");
  return (
    <form
      className="world-calendar-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseMonths(months);
        if (!parsed.length) return setProblem(t("calendar.badMonths"));
        await save({ months: parsed, startYear: Number.parseInt(startYear, 10) || 1, era: era.trim() });
        close();
      }}
    >
      <label className="field">
        <span>{t("calendar.months")}</span>
        <textarea className="textarea selectable" rows={8} value={months} onChange={(e) => setMonths(e.target.value)} />
      </label>
      <label className="field">
        <span>{t("calendar.startYear")}</span>
        <input className="input selectable" inputMode="numeric" value={startYear} onChange={(e) => setStartYear(e.target.value)} />
      </label>
      <label className="field">
        <span>{t("calendar.era")}</span>
        <input className="input selectable" value={era} onChange={(e) => setEra(e.target.value)} />
      </label>
      {problem && <p className="insp-hint">{problem}</p>}
      <div className="world-kinds-foot">
        <button className="btn primary" type="submit">
          {t("calendar.save")}
        </button>
      </div>
    </form>
  );
}

interface Dated {
  id: string;
  title: string;
  day: number;
}

/**
 * The scenes in the world's own calendar, year by year and month by month, from their story time. A book that gives
 * dates rather than day numbers, with no day 1 set for the series, counts from its earliest date.
 */
export function CalendarView({ context }: { context: TabContext }) {
  const { app, t } = context;
  const [calendar, setCalendar] = useState<WorldCalendar | null | undefined>(undefined);
  const [scenes, setScenes] = useState<Dated[]>([]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [cal, ids, nodes] = await Promise.all([context.calendar(), app.project.manuscript(), app.project.nodes()]);
      const titles = new Map(nodes.map((n) => [n.id, n.title]));
      const times = await Promise.all(ids.map(async (id) => ({ id, time: (await app.project.storyTime?.(id)) ?? null })));
      // Dates without a day 1: the earliest is day 1.
      const first = times
        .filter((x) => x.time && x.time.day === null && x.time.date)
        .map((x) => x.time!.date!)
        .sort()[0];
      const dayOf = (time: { day: number | null; date: string | null } | null) =>
        time?.day ?? (time?.date && first ? Math.round((Date.parse(time.date) - Date.parse(first)) / 86_400_000) + 1 : null);
      const dated = times.flatMap(({ id, time }) => {
        const day = dayOf(time);
        return day === null ? [] : [{ id, title: titles.get(id) ?? "", day }];
      });
      if (!live) return;
      setCalendar(cal);
      setScenes(dated.sort((a, b) => a.day - b.day));
    };
    void load();
    const stop = context.watch(() => void load());
    return () => {
      live = false;
      stop();
    };
  }, []);

  if (calendar === undefined) return null;
  if (!calendar)
    return (
      <div className="world-calendar">
        <p className="insp-hint">{t("calendar.none")}</p>
        <button className="btn sm" onClick={() => context.editCalendar()}>
          {t("calendar.setUp")}
        </button>
      </div>
    );
  if (!scenes.length) return <p className="insp-hint world-view-empty">{t("calendar.noScenes")}</p>;

  /** The scenes, grouped by year and month in order. */
  const groups: { label: string; items: (Dated & { label: string })[] }[] = [];
  for (const s of scenes) {
    const d = worldDate(s.day, calendar);
    const label = `${calendar.months[d.month].name} · ${yearLabel(d.year, calendar)}`;
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1)!.items.push({ ...s, label: t("calendar.day", { day: String(d.day), month: calendar.months[d.month].name }) });
  }
  return (
    <div className="world-calendar">
      {groups.map((g) => (
        <section key={g.label} className="world-view-group">
          <h3 className="field-label">{g.label}</h3>
          {g.items.map((s) => (
            <button key={s.id} className="insp-link-row world-calendar-scene" onClick={() => void app.project.select(s.id)}>
              <span className="chip">{s.label}</span>
              <span className="ilr-title">{s.title}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
