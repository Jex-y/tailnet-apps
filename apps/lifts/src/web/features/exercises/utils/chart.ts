/**
 * Round values spanning `min` to `max` in about `count` steps of 1, 2 or 5 times a power of ten, the first at or
 * below `min` and the last at or above `max`.
 */
export const niceTicks = (min: number, max: number, count: number): readonly number[] => {
  const span = max - min || Math.abs(max) || 1;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const ratio = rough / magnitude;
  const step = (ratio < 1.5 ? 1 : ratio < 3 ? 2 : ratio < 7 ? 5 : 10) * magnitude;
  const first = Math.floor(min / step) * step;
  const steps = Math.max(1, Math.ceil((max - first) / step - 1e-9));
  return Array.from({ length: steps + 1 }, (_, index) => first + index * step);
};
