import { STYLES, type Style, styleKey } from "../utils/lifts";

type Props = {
  readonly value: Style;
  readonly onChange: (style: Style) => void;
  /** Once an exercise is logged its sets are counted one way, so only whether bodyweight is in its load can change. */
  readonly measureFixed?: boolean;
};

/** How an exercise is loaded and counted: weight or bodyweight plus weight, for reps or for time. */
export const StyleSelect = ({ value, onChange, measureFixed = false }: Props) => (
  <select
    value={styleKey(value)}
    aria-label="How it is loaded and counted"
    onChange={(event) => {
      const style = STYLES.find((each) => styleKey(each) === event.target.value);
      if (style !== undefined) {
        onChange({ measure: style.measure, bodyweight: style.bodyweight });
      }
    }}
  >
    {STYLES.map((style) => (
      <option key={styleKey(style)} value={styleKey(style)} disabled={measureFixed && style.measure !== value.measure}>
        {style.label}
      </option>
    ))}
  </select>
);
