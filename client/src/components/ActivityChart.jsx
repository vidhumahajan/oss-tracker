import { monthName, plural } from "../format.js";

// Twelve bars, one per month, showing merged pull requests.
export default function ActivityChart({ activity }) {
  const max = Math.max(1, ...activity.map((month) => month.merged));
  const total = activity.reduce((sum, month) => sum + month.merged, 0);

  return (
    <figure className="chart">
      <figcaption>{plural(total, "pull request")} merged in the last 12 months</figcaption>
      <ol className="chart-bars">
        {activity.map((month) => (
          <li key={month.month} title={`${monthName(month.month)}: ${month.merged} merged`}>
            <span className="chart-value">{month.merged > 0 ? month.merged : ""}</span>
            <span
              className={`chart-bar ${month.merged === 0 ? "chart-bar-empty" : ""}`}
              style={{ height: `${Math.max(2, (month.merged / max) * 100)}%` }}
            />
            <span className="chart-label">{monthName(month.month)}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
