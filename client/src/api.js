// One function for every call to our server.
//   const data = await api("/leaderboard?window=week");
//   await api("/me", { method: "PATCH", body: { isPublic: false } });
// On failure it throws an Error whose message is ready to show to the user.
export async function api(path, { method = "GET", body, signal } = {}) {
  const options = { method, signal, headers: {} };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    // The login cookie is sent automatically because the API is on the same address.
    response = await fetch(`/api${path}`, options);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  // Every answer from our API is JSON. Anything else means the server is down.
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.error?.message || "Something went wrong. Try again.");
    error.status = response.status;
    throw error;
  }
  return data;
}
