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

// Yes/no checks for data we did not get from the browser, such as an AI
// reply. The caller decides which error to throw when one fails.
export function isText(value, { max }) {
  return typeof value === "string" && value.trim() !== "" && value.trim().length <= max;
}

export function isList(value, { min = 0, max }) {
  return Array.isArray(value) && value.length >= min && value.length <= max;
}

// A search box value: a short plain string, or "" if missing.
export function parseSearch(value) {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}
