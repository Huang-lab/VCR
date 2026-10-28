import { formatPct } from "@/lib/penetrance/stats";
import { chartWidth, niceMax, type ChartThreshold } from "./AgeChart";
import { useElementWidth } from "./useElementWidth";

interface Row {
  key: "carrier" | "baseline";
  label: string;
  pct: number;
  /** 95% confidence range, drawn as a whisker. */
  low?: number;
  high?: number;
}

const M = { right: 20, top: 8, axis: 28 };
/** Headroom above the bars for a threshold label. */
const LABEL_ROOM = 18;
/** Below this width the row labels sit above their bars instead of to the left of them. */
const STACK_BELOW = 480;
/** Rough width of one character of the bold 11px threshold label. */
const LABEL_CHAR_PX = 6.6;

/** Horizontal bars (with 95% CI whiskers where known); used when a dataset has no age dimension. */
export function LifetimeChart({ rows, thresholds = [] }: { rows: Row[]; thresholds?: ChartThreshold[] }) {
  const [ref, width] = useElementWidth<HTMLElement>(640);
  const W = chartWidth(width);
  const stacked = W < STACK_BELOW;
  const left = stacked ? 14 : 168;
  const rowH = stacked ? 64 : 52;
  const top = M.top + (thresholds.length > 0 ? LABEL_ROOM : 0);

  const max = niceMax(Math.max(...rows.map((r) => r.high ?? r.pct), ...thresholds.map((t) => t.pct)));
  const x = (v: number) => left + (v / max) * (W - left - M.right);
  const H = top + rows.length * rowH + M.axis;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  // Bar centre in each row; stacked rows leave room above the bar for the label.
  const centre = (i: number) => top + i * rowH + rowH / 2 + (stacked ? 8 : 0);

  return (
    <figure ref={ref} className="age-chart lifetime-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={[
          ...rows.map(
            (r) =>
              `${r.label} ${formatPct(r.pct)}${r.low !== undefined && r.high !== undefined ? `, 95% CI ${formatPct(r.low)} to ${formatPct(r.high)}` : ""}`,
          ),
          ...thresholds.map((t) => `${t.label} threshold ${formatPct(t.pct)}`),
        ].join("; ")}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={x(t)} x2={x(t)} y1={top} y2={H - M.axis} />
            <text className="tick" x={x(t)} y={H - 8} textAnchor="middle">
              {Number(t.toFixed(2))}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cy = centre(i);
          return (
            <g key={r.key}>
              <rect className={`bar bar-${r.key}`} x={left} y={cy - 10} width={Math.max(2, x(r.pct) - left)} height={20} rx={3} />
              {r.low !== undefined && r.high !== undefined && (
                <>
                  <line className="whisker" x1={x(r.low)} x2={x(r.high)} y1={cy} y2={cy} />
                  <line className="whisker" x1={x(r.low)} x2={x(r.low)} y1={cy - 7} y2={cy + 7} />
                  <line className="whisker" x1={x(r.high)} x2={x(r.high)} y1={cy - 7} y2={cy + 7} />
                </>
              )}
            </g>
          );
        })}
        {thresholds.map((t) => {
          const text = `${t.label} (${formatPct(t.pct)})`;
          const half = (text.length * LABEL_CHAR_PX) / 2;
          // Centre the label on its line, unless that would run past an edge of the viewBox.
          const anchor = x(t.pct) - half < 2 ? "start" : x(t.pct) + half > W - 2 ? "end" : "middle";
          const labelX = anchor === "start" ? 2 : anchor === "end" ? W - 2 : x(t.pct);
          return (
            <g key={t.label}>
              <line className="series series-threshold" x1={x(t.pct)} x2={x(t.pct)} y1={top - 6} y2={H - M.axis} />
              <text className="threshold-label" x={labelX} y={top - 10} textAnchor={anchor}>
                {text}
              </text>
            </g>
          );
        })}
        {/* Labels come last so a threshold line passing behind a stacked label stays readable. */}
        {rows.map((r, i) => (
          <text
            key={r.key}
            className={stacked ? "row-label row-label-stacked" : "row-label"}
            x={stacked ? left : left - 10}
            y={centre(i) + (stacked ? -16 : 4)}
            textAnchor={stacked ? "start" : "end"}
          >
            {r.label}
          </text>
        ))}
      </svg>
    </figure>
  );
}
