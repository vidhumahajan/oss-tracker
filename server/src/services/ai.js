// Every call to the AI service lives in this file, the same way github.js
// holds every call to GitHub. It uses plain fetch, so there is no extra
// library to install or update.
//
// It speaks the OpenAI-compatible chat completions format. The default is
// Groq's free plan, but any service that speaks the same format works by
// changing AI_API_URL, AI_API_KEY and SUMMARY_MODEL.
//
// API reference: https://console.groq.com/docs/api-reference
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";

const TIMEOUT_MS = 60 * 1000;

// Room for the reply, including the model's hidden thinking. A full summary
// is well under 1500 tokens. Kept small because the free plan counts it
// against the per-minute token limit.
const MAX_REPLY_TOKENS = 2000;

// The service said our account is over a rate limit. Nothing was used up
// on their side, so the member's daily count is given back.
// period is "minute" or "day".
export class AiRateLimitError extends HttpError {
  constructor(period) {
    super(
      429,
      period === "day"
        ? "Today's free summaries are used up. Try again tomorrow."
        : "The summary service is busy. Try again in a minute."
    );
    this.period = period;
  }
}

export function aiEnabled() {
  return Boolean(config.aiApiKey);
}

// Turns a failed AI response into a clear error for the member.
async function throwForStatus(response) {
  if (response.status === 429) {
    // Groq names the limit in the message, for example
    // "... on tokens per day (TPD): Limit 200000 ...". Anything that does
    // not say "per day" is treated as the short per-minute limit.
    const text = await response.text().catch(() => "");
    const daily = /per day|\((TPD|RPD)\)/i.test(text);
    throw new AiRateLimitError(daily ? "day" : "minute");
  }
  if (response.status >= 500) {
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
    response = await fetch(config.aiApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.aiApiKey}`,
      },
      body: JSON.stringify({
        model: config.summaryModel,
        max_completion_tokens: MAX_REPLY_TOKENS,
        // A summary is a simple job, so the model can think less. That also
        // saves tokens from the small free allowance.
        reasoning_effort: "low",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        // Asks the service to make the reply follow our JSON shape.
        // We still check every field ourselves before saving.
        response_format: {
          type: "json_schema",
          json_schema: { name: "pr_summary", strict: true, schema },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(503, "The AI service did not answer. Try again in a few minutes.");
  }

  if (!response.ok) await throwForStatus(response);
  const data = await response.json();
  const choice = data.choices?.[0];

  // "stop" means the model finished. Anything else (it ran out of room,
  // or was cut off) means the reply may not follow the shape.
  if (choice?.finish_reason !== "stop") return null;

  try {
    return JSON.parse(choice.message?.content || "");
  } catch {
    return null;
  }
}
