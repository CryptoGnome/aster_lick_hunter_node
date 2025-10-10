const MIN_LEVERAGE = 1;
const MAX_LEVERAGE = 125;

export function normalizeLeverage(rawValue: number): number {
  if (!Number.isFinite(rawValue)) {
    return MIN_LEVERAGE;
  }

  const rounded = Math.round(rawValue);
  if (rounded < MIN_LEVERAGE) return MIN_LEVERAGE;
  if (rounded > MAX_LEVERAGE) return MAX_LEVERAGE;
  return rounded;
}
