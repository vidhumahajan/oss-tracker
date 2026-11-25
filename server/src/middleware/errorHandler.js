// Runs when no route matched the request.
export function notFound(req, res) {
  res.status(404).json({ error: { message: "Route not found" } });
}

// Every error thrown in any route ends up here, so all errors
// leave the server in the same shape: { error: { message } }.
// Express knows this is an error handler because it takes 4 arguments.
export function errorHandler(err, req, res, next) {
  // Errors we threw on purpose carry a status. express.json() also sets one
  // for a broken or oversized request body. Anything else is a bug: 500.
  const status = err.status || err.statusCode || 500;

  // Log bugs for us, but never show their details to the user.
  if (status >= 500) {
    console.error(err);
  }

  let message = err.message;
  if (status === 500) message = "Something went wrong";
  if (err.type === "entity.parse.failed") message = "The request body is not valid JSON";
  if (err.type === "entity.too.large") message = "The request body is too large";

  res.status(status).json({ error: { message } });
}
