// An Error that also carries an HTTP status code.
// Usage: throw new HttpError(401, "Please log in");
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// A problem talking to GitHub. kind says what went wrong, so the
// sync code can react differently to "token revoked" and "slow down".
export class GithubError extends HttpError {
  constructor(kind, status, message) {
    super(status, message);
    this.kind = kind; // "unauthorized" | "rate_limited" | "failed"
  }
}
