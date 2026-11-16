import { useEffect, useRef, useState } from "react";
import type { Exercise } from "../../../../contract";
import type { LoggedSet } from "../../../../log";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import {
  DECIMAL,
  type Draft,
  draftOf,
  FIELDS,
  type Field,
  type Key,
  type Parsed,
  parseDraft,
  press,
} from "../utils/keypad";
import type { SetValues } from "../utils/plan";
import { RPES } from "../utils/session";
import { RestBar } from "./RestTimer";

/** The figures typed in, checked. */
export type Figures = Extract<Parsed, { ok: true }>["values"];

/**
 * What the dock is for. `ready` takes the next set's figures and logs it; `rate` asks how hard the set just logged was
 * while the rest runs, and still logs the next one; `edit` corrects a set already logged; `idle` has nothing to log.
 */
export type DockMode =
  | {
      readonly kind: "ready";
      readonly label: string;
      readonly values: SetValues;
      readonly onKind: (kind: SetValues["kind"]) => void;
      readonly onLog: (figures: Figures) => void;
    }
  | {
      readonly kind: "rate";
      readonly label: string;
      readonly set: LoggedSet;
      readonly since: string | null;
      /** The set the big button logs next, if there is one. */
      readonly next: SetValues | null;
      readonly onRate: (rpe: number) => void;
      /** Stops asking, leaving the set as it is. */
      readonly onSkip: () => void;
      readonly onLog: (figures: Figures) => void;
      readonly onAddSet: () => void;
    }
  | {
      readonly kind: "edit";
      readonly label: string;
      readonly set: LoggedSet;
      readonly onKind: (kind: SetValues["kind"]) => void;
      readonly onSave: (figures: Figures) => void;
      readonly onRemove: () => void;
    }
  | { readonly kind: "idle"; readonly label: string; readonly onAddSet: () => void };

/** How the exercise being logged is loaded and counted, which names the fields. */
type Counting = Pick<Exercise, "measure" | "bodyweight">;

const unitsOf = ({ measure, bodyweight }: Counting): Record<Field, string> => ({
  weightKg: bodyweight ? "+kg" : "kg",
  count: measure === "reps" ? "reps" : "s",
  rpe: "RPE",
});
const namesOf = ({ measure, bodyweight }: Counting): Record<Field, string> => ({
  weightKg: bodyweight ? "Weight added" : "Weight",
  count: measure === "reps" ? "Reps" : "Seconds",
  rpe: "RPE",
});

/** The pad, laid out as a calculator's: three rows of digits, with delete, the point and zero down the right. */
const PAD: readonly Key[] = ["7", "8", "9", "back", "4", "5", "6", ".", "1", "2", "3", "0"];
const KEY_NAMES: Partial<Record<Key, string>> = { ".": "Decimal point", back: "Delete" };

const isKey = (key: string): key is Key => (PAD as readonly string[]).includes(key);

/** The figures the dock opens with: the set being corrected, else the one about to be lifted. */
const startingDraft = (mode: DockMode): Draft | null => {
  switch (mode.kind) {
    case "ready":
      return draftOf(mode.values);
    case "edit":
      return draftOf(mode.set);
    case "rate":
      return mode.next === null ? null : draftOf(mode.next);
    case "idle":
      return null;
  }
};

const KindToggle = ({
  kind,
  onKind,
}: {
  readonly kind: SetValues["kind"];
  readonly onKind: (kind: SetValues["kind"]) => void;
}) => (
  <button
    type="button"
    className="dock-chip"
    aria-pressed={kind === "warmup"}
    onClick={() => onKind(kind === "warmup" ? "work" : "warmup")}
  >
    Warm-up
  </button>
);

/**
 * The controls, docked above the tab bar where the thumb rests. Figures go in on the dock's own number pad, so the
 * system keyboard never covers the page: tap a field, type, done. Its height never changes and its big button never
 * moves, so a set can be logged by feel. It takes its mode afresh when given a new `key`.
 */
export const Dock = ({ mode, exercise }: { readonly mode: DockMode; readonly exercise: Counting }) => {
  const [draft, setDraft] = useState(() => startingDraft(mode));
  const [active, setActive] = useState<Field>("weightKg");
  const [fresh, setFresh] = useState(true);
  const [invalid, setInvalid] = useState<readonly Field[]>([]);
  const typing = mode.kind === "ready" || mode.kind === "edit";

  const choose = (field: Field) => {
    setActive(field);
    setFresh(true);
    if (mode.kind === "rate") {
      mode.onSkip();
    }
  };
  const type = (key: Key) => {
    if (draft === null) {
      return;
    }
    setDraft({ ...draft, [active]: press(draft[active], key, { fresh, decimal: DECIMAL[active] }) });
    setFresh(false);
    setInvalid(invalid.filter((field) => field !== active));
  };
  const commit = (use: (figures: Figures) => void) => {
    if (draft === null) {
      return;
    }
    const parsed = parseDraft(draft, exercise.measure);
    if (parsed.ok) {
      use(parsed.values);
      return;
    }
    setInvalid(parsed.invalid);
    setActive(parsed.invalid[0] ?? active);
    setFresh(true);
  };
  const done = () => {
    switch (mode.kind) {
      case "ready":
        return commit(mode.onLog);
      case "edit":
        return commit(mode.onSave);
      case "rate":
        return mode.next === null ? mode.onAddSet() : commit(mode.onLog);
      case "idle":
        return mode.onAddSet();
    }
  };

  // A keyboard, where there is one, types into the pad too: Enter is the big button and Tab the next field.
  const latest = useRef({ type, done, choose, typing, active });
  latest.current = { type, done, choose, typing, active };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, dialog, a") || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const now = latest.current;
      const key = event.key === "Backspace" ? "back" : event.key;
      if (now.typing && isKey(key)) {
        now.type(key);
      } else if (event.key === "Enter" && target?.tagName !== "BUTTON") {
        now.done();
      } else if (event.key === "Tab" && now.typing && !event.shiftKey) {
        now.choose(FIELDS[(FIELDS.indexOf(now.active) + 1) % FIELDS.length] ?? "weightKg");
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const shown = (field: Field) => draft?.[field] ?? "";
  const [units, names] = [unitsOf(exercise), namesOf(exercise)];
  const weight = shown("weightKg") || "–";
  const count = shown("count") || "–";
  const logLabel =
    mode.kind === "edit"
      ? "Save"
      : mode.kind === "idle" || (mode.kind === "rate" && mode.next === null)
        ? "Add a set"
        : `Done · ${exercise.bodyweight ? (weight === "0" ? "BW" : `BW+${weight}`) : weight} × ${count}${
            exercise.measure === "seconds" && count !== "–" ? "s" : ""
          }`;

  return (
    <section className={`dock ${mode.kind}`} aria-label="Set controls">
      <div className="dock-head">
        <p className="dock-label numeric">{mode.label}</p>
        {mode.kind === "ready" && <KindToggle kind={mode.values.kind} onKind={mode.onKind} />}
        {mode.kind === "edit" && (
          <>
            <KindToggle kind={mode.set.kind} onKind={mode.onKind} />
            <ConfirmButton className="dock-chip" confirm="Delete it?" onConfirm={mode.onRemove}>
              Delete
            </ConfirmButton>
          </>
        )}
        {mode.kind === "rate" && (
          <button type="button" className="dock-chip" onClick={mode.onSkip}>
            Skip
          </button>
        )}
      </div>

      {draft !== null && (
        <div className="dock-fields">
          {FIELDS.map((field) => (
            <button
              key={field}
              type="button"
              className="dock-field numeric"
              aria-pressed={typing && field === active}
              aria-invalid={invalid.includes(field)}
              aria-label={`${names[field]}${mode.kind === "rate" ? " of the next set" : ""}: ${shown(field) || "none"}`}
              onClick={() => choose(field)}
            >
              <span className={typing && field === active && fresh ? "dock-value fresh" : "dock-value"}>
                {shown(field) || "–"}
              </span>
              <span className="dock-unit">{units[field]}</span>
            </button>
          ))}
        </div>
      )}

      {typing && (
        <div className="dock-pad">
          {PAD.map((key) => (
            <button
              key={key}
              type="button"
              className="numeric"
              aria-label={KEY_NAMES[key]}
              disabled={key === "." && !DECIMAL[active]}
              onClick={() => type(key)}
            >
              {key === "back" ? <Icon name="delete" /> : key}
            </button>
          ))}
        </div>
      )}

      {mode.kind === "rate" && (
        <div className="dock-rate">
          <RestBar since={mode.since} />
          <fieldset className="dock-rpe">
            <legend className="visually-hidden">{mode.label}</legend>
            {RPES.map((rpe) => (
              <button
                key={rpe}
                type="button"
                className="numeric"
                aria-pressed={mode.set.rpe === rpe}
                aria-label={`RPE ${rpe}`}
                onClick={() => mode.onRate(rpe)}
              >
                {rpe}
              </button>
            ))}
          </fieldset>
        </div>
      )}

      <button type="button" className="dock-log" onClick={done}>
        <Icon name="check" />
        {logLabel}
      </button>
    </section>
  );
};
