import { useNow } from "../../../hooks/useNow";
import { formatElapsed } from "../../../utils/format";
import { REST_TARGET_MS } from "../utils/session";

/** Past this a rest is over in all but name, and the clock would only distract. */
const STALE_MS = 15 * 60_000;

/** Time since the last set was logged, or `null` once the rest is long over or before the first set. */
export const useRest = (since: string | null): number | null => {
  const now = useNow();
  const elapsed = since === null ? null : now - Date.parse(since);
  return elapsed !== null && elapsed <= STALE_MS ? elapsed : null;
};

/** The rest counting up, and a bar filling towards the target that turns to the accent once it is reached. */
export const RestBar = ({ since }: { readonly since: string | null }) => {
  const elapsed = useRest(since);
  const share = elapsed === null ? 0 : Math.min(1, elapsed / REST_TARGET_MS);

  return (
    <div className={share === 1 ? "rest-bar rested" : "rest-bar"}>
      <span className="rest-clock numeric" role="timer" aria-label="Rest">
        {elapsed === null ? "–:––" : formatElapsed(elapsed)}
      </span>
      <span className="rest-track" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} />
      </span>
      <span className="muted numeric">{formatElapsed(REST_TARGET_MS)}</span>
    </div>
  );
};
