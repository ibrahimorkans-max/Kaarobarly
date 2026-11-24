import { Chips } from './ui';

export type PeriodKey = 'month' | 'last' | 'quarter' | 'year';

const p2 = (n: number) => String(n).padStart(2, '0');

/** From/to dates for a quick period, in local time. */
export function periodRange(k: PeriodKey): { from: string; to: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const today = `${y}-${p2(m + 1)}-${p2(d.getDate())}`;
  if (k === 'month') return { from: `${y}-${p2(m + 1)}-01`, to: today };
  if (k === 'last') {
    const ly = m === 0 ? y - 1 : y;
    const lm = m === 0 ? 12 : m;
    const end = new Date(ly, lm, 0).getDate();
    return { from: `${ly}-${p2(lm)}-01`, to: `${ly}-${p2(lm)}-${p2(end)}` };
  }
  if (k === 'quarter') return { from: `${y}-${p2(Math.floor(m / 3) * 3 + 1)}-01`, to: today };
  return { from: `${y}-01-01`, to: today };
}

export function PeriodChips({ value, onChange }: { value: PeriodKey; onChange: (k: PeriodKey) => void }) {
  return (
    <Chips<PeriodKey>
      value={value}
      onChange={onChange}
      options={[
        { value: 'month', label: 'This month' },
        { value: 'last', label: 'Last month' },
        { value: 'quarter', label: 'This quarter' },
        { value: 'year', label: 'This year' },
      ]}
    />
  );
}
