// Builds the Express app: security first, then routes, then error handling.
// It does not start listening here. index.js does that, which lets the
// tests use the app without opening a real port.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { usersRouter } from "./routes/users.js";
import { publicRouter } from "./routes/public.js";
import { adminRouter } from "./routes/admin.js";

export const app = express();

// The hosting platform sits in front of the server as a proxy. This tells
// Express to read the visitor's real IP address from the proxy's header,
// which the rate limiter needs.
app.set("trust proxy", 1);

// Helmet sets security headers. The main one is the Content Security Policy:
// a list of where the page may load things from. Scripts only from our own
// site, images only from our site and GitHub's avatar server.
const cspDirectives = {
  "img-src": ["'self'", "data:", "https://avatars.githubusercontent.com"],
};
if (!config.isProduction) {
  // This directive forces HTTPS, which breaks plain http://localhost.
  cspDirectives["upgrade-insecure-requests"] = null;
}
app.use(helmet({ contentSecurityPolicy: { directives: cspDirectives } }));

// Turn JSON request bodies into req.body. Nothing we accept is large,
// so anything over 10kb is rejected.
app.use(express.json({ limit: "10kb" }));
// Turn the Cookie header into req.cookies.
app.use(cookieParser());

// ---------- API ----------

app.use("/api", apiLimiter);

// Hosting platforms ping this to check the server is alive.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/users", usersRouter);
app.use("/api/admin", adminRouter);
app.use("/api", publicRouter);
app.use("/api", notFound);

// ---------- React app ----------

// After "npm run build", the finished React app is a folder of plain files.
// The server hands those out itself, so the whole product is one deployment
// on one address. In development this folder does not exist and Vite serves
// the React app instead.
const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));

  // React Router handles page addresses like /leaderboard in the browser.
  // So for any page request we send index.html and let React take over.
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// These two must stay last.
app.use(notFound);
app.use(errorHandler);
