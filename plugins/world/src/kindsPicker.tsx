import { useState } from "react";
import type { Translate } from "../../../shared/i18n";
import { KINDS, type Key } from "./kinds";

/**
 * The dialog where the writer turns World's kinds of entry on and off. A kind that's off keeps its entries: they're
 * only not shown, and come back when it's turned on again. The choice is World's shared data, so it holds for every
 * book of the series and every co-author.
 */
export function KindsPicker({ t, off, onChange, close }: { t: Translate<Key>; off: string[]; onChange: (id: string, on: boolean) => Promise<void>; close: () => void }) {
  const [now, setNow] = useState(off);
  const [busy, setBusy] = useState(false);
  return (
    <div className="world-kinds">
      <p className="insp-hint">{t("kinds.about")}</p>
      {KINDS.map((k) => (
        <label key={k.id} className="checkbox" data-kind={k.id}>
          <input
            type="checkbox"
            checked={!now.includes(k.id)}
            disabled={busy}
            onChange={async (e) => {
              const on = e.target.checked;
              const before = now;
              // Shown at once, and put back if it couldn't be saved.
              setNow(on ? now.filter((x) => x !== k.id) : [...now, k.id]);
              setBusy(true);
              try {
                await onChange(k.id, on);
              } catch {
                setNow(before);
              } finally {
                setBusy(false);
              }
            }}
          />
          {t(k.plural)}
        </label>
      ))}
      <div className="world-kinds-foot">
        <button className="btn primary" onClick={close}>
          {t("kinds.done")}
        </button>
      </div>
    </div>
  );
}
