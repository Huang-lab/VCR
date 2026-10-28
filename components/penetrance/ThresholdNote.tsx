import { compareToBaseline, formatPct } from "@/lib/penetrance/stats";
import { hasRiskLevel, type ActionThreshold } from "@/lib/penetrance/thresholds";

const VERDICT_TEXT = {
  higher: "Above the screening threshold",
  similar: "Not clearly above or below the screening threshold",
  lower: "Below the screening threshold",
} as const;

interface Props {
  threshold: ActionThreshold;
  /** Carrier penetrance (percent) and its 95% range. */
  pct: number;
  ci: { low: number; high: number };
  /** False when the card shows a part-way age: a risk level is a lifetime figure, so it is not compared. */
  comparable: boolean;
}

/** Where the carriers' risk sits against a guideline screening or action level. */
export function ThresholdNote({ threshold: t, pct, ci, comparable }: Props) {
  if (!hasRiskLevel(t)) {
    return (
      <p className="pen-threshold">
        <strong>No screening threshold by risk level.</strong> Screening advice for this cancer is tied to specific
        genes, family history and ancestry instead. For example, {t.source} {t.advice}.
      </p>
    );
  }

  if (!comparable) return null;

  const level = `${formatPct(t.pct)} lifetime risk at which ${t.source} ${t.advice}`;
  const { verdict } = compareToBaseline(pct, ci, t.pct);
  const range = `${formatPct(ci.low)} to ${formatPct(ci.high)}`;
  return (
    <p className="pen-threshold">
      <strong>{VERDICT_TEXT[verdict]}.</strong>{" "}
      {verdict === "similar"
        ? `The carriers' 95% range (${range}) includes the ${level}, so this data cannot show which side they fall on.`
        : `The carriers' 95% range (${range}) is ${verdict === "higher" ? "above" : "below"} the ${level}.`}{" "}
      <span className="muted-small">
        Meant for one person&apos;s estimated lifetime risk, often from family-history models, so treat this as a
        rough guide.
      </span>
    </p>
  );
}
