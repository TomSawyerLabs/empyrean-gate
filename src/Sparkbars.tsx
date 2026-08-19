// Tiny live meter: last ~30 one-second buckets as a bar sparkline, with the
// current value directly labeled beside it (text ink, not series color).

export default function Sparkbars({
  data,
  color,
  label,
  value,
  warn,
}: {
  /** Oldest-first per-second buckets. */
  data: number[];
  /** Series hue for the bars (identity is carried by the adjacent label). */
  color: string;
  label: string;
  /** Current value, shown as text. */
  value: string;
  /** Highlight the value (e.g. 0 pkt/s while output is enabled). */
  warn?: boolean;
}) {
  const W = 90;
  const H = 22;
  const n = 30;
  const slots = data.slice(-n);
  const max = Math.max(1, ...slots);
  const bw = W / n;
  return (
    <span className="sparkbars">
      <svg width={W} height={H} shapeRendering="crispEdges" aria-hidden="true">
        {slots.map((v, i) => {
          const h = Math.max(v > 0 ? 1 : 0, (v / max) * H);
          return (
            <rect
              key={i}
              x={(n - slots.length + i) * bw}
              y={H - h}
              width={Math.max(1, bw - 1)}
              height={h}
              fill={color}
              opacity={0.9}
            />
          );
        })}
      </svg>
      <span className={`spark-value ${warn ? "warn" : ""}`}>
        {value} <span className="spark-label">{label}</span>
      </span>
    </span>
  );
}
