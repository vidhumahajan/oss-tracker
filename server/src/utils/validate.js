// Small helpers for checking what the browser sends us.
// Never trust input: check the type and the size before using it.
import mongoose from "mongoose";
import { HttpError } from "./httpError.js";

// ?page=3 -> 3. Anything odd becomes page 1.
export function parsePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1;
}

// Returns a trimmed string, or throws a 400 with a clear message.
export function requireString(value, name, { max = 200 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${name} is required`);
  }
  if (value.trim().length > max) {
    throw new HttpError(400, `${name} must be at most ${max} characters`);
  }
  return value.trim();
}

export function requireBoolean(value, name) {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${name} must be true or false`);
  }
  return value;
}

export function requireObjectId(value) {
  if (typeof value !== "string" || !mongoose.isValidObjectId(value)) {
    throw new HttpError(404, "Not found");
  }
  return value;
}

// Makes user text safe to put inside a regular expression,
// so a search for "a.b" matches a literal dot and nothing else.
export function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Like requireString, but "" when the value is missing or empty.
export function optionalString(value, name, { max = 200 } = {}) {
  if (value === undefined || value === null || value === "") return "";
  return requireString(value, name, { max });
}

// A Google Meet link, and nothing else. The address must start with
// https://meet.google.com/ so a link can never send members to another site.
export function requireMeetLink(value) {
  const link = requireString(value, "meetLink", { max: 200 });
  if (!/^https:\/\/meet\.google\.com\/[A-Za-z0-9-]+$/.test(link)) {
    throw new HttpError(400, "meetLink must be a Google Meet link, like https://meet.google.com/abc-defg-hij");
  }
  return link;
}

// Something that looks like an email address: text, an @, and a domain
// with a dot. Whether it really exists only shows when an email bounces.
export function requireEmail(value, name = "email") {
  const email = requireString(value, name, { max: 200 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, `${name} must be an email address, like name@example.com`);
  }
  return email;
}

// Like requireEmail, but "" when the value is missing or empty.
export function optionalEmail(value, name = "email") {
  if (value === undefined || value === null || value === "") return "";
  return requireEmail(value, name);
}

// A date and time sent as text, for example "2026-12-05T12:30:00.000Z".
export function requireDate(value, name) {
  const date = typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${name} must be a date and time`);
  }
  return date;
}

// Yes/no checks for data we did not get from the browser, such as an AI
// reply. The caller decides which error to throw when one fails.
export function isText(value, { max }) {
  return typeof value === "string" && value.trim() !== "" && value.trim().length <= max;
}

export function isList(value, { min = 0, max }) {
  return Array.isArray(value) && value.length >= min && value.length <= max;
}

// A GitHub username: letters, digits and single dashes, at most 39
// characters. Anything else cannot be a real account.
export function isGithubLogin(value) {
  return typeof value === "string" && /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/.test(value);
}

// A search box value: a short plain string, or "" if missing.
export function parseSearch(value) {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}
