// Every call to the AI service (Anthropic's Claude) lives in this file,
// the same way github.js holds every call to GitHub.
// It uses plain fetch, so there is no extra library to install or update.
//
// API reference: https://platform.claude.com/docs/en/api/messages
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2026-10-21";
const TIMEOUT_MS = 60 * 1000;

export function aiEnabled() {
  return Boolean(config.anthropicApiKey);
}

// Turns a failed AI response into a clear error for the member.
function throwForStatus(response) {
  // 429: our account's rate limit. 500 and 529: a problem on their side.
  if (response.status === 429 || response.status >= 500) {
    throw new HttpError(503, "The AI service is busy. Try again in a few minutes.");
  }
  // Anything else (a wrong key, a wrong model name) is a setup problem,
  // so it is logged for the admins but not explained to the member.
  console.error(`AI request failed with status ${response.status}`);
  throw new HttpError(502, "The AI service could not be reached. Try again later.");
}

// Sends one request and returns the reply as a parsed object,
// or null if the reply is not usable JSON.
//   system  instructions for the model
//   prompt  the material to work on
//   schema  the JSON shape the reply must follow
export async function askForJson({ system, prompt, schema }) {
  let response;
  try {
    response = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: config.summaryModel,
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: {
          // A summary is a simple job, so the model can think less and answer faster.
          effort: "low",
          // Asks the API to make the reply follow our JSON shape.
          // We still check every field ourselves before saving.
          format: { type: "json_schema", schema },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(503, "The AI service did not answer. Try again in a few minutes.");
  }

  if (!response.ok) throwForStatus(response);
  const data = await response.json();

  // "end_turn" means the model finished. Anything else (it ran out of room,
  // or declined) means the reply may be cut off or not follow the shape.
  if (data.stop_reason !== "end_turn") return null;

  // The reply is a list of blocks. The answer is in the text block(s);
  // other blocks, such as the model's thinking, are skipped.
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
