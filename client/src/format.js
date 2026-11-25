// Small helpers for showing dates and numbers.

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// "3 hours ago", "yesterday", "2 months ago"
export function timeAgo(value) {
  if (!value) return "never";
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const steps = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
}

// "12 Nov 2026"
export function shortDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// "Sat, 5 Dec 2026, 6:00 pm IST", in the viewer's own time zone.
export function dateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// "2026-11" -> "Nov"
export function monthName(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

// 1234 -> "1,234"
export function number(value) {
  return new Intl.NumberFormat("en-IN").format(value ?? 0);
}

// plural(1, "member") -> "1 member", plural(3, "member") -> "3 members"
export function plural(count, word, many = `${word}s`) {
  return `${number(count)} ${count === 1 ? word : many}`;
}
