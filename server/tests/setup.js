// Fake settings for tests. Imported first in every test file,
// before the app loads its config.
//
// Tests wipe the database they use, so they must NEVER point at your real
// one. They use a separate database called oss_tracker_test.
process.env.NODE_ENV = "test";
process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/oss_tracker_test";
process.env.GITHUB_CLIENT_ID = "test-client-id";
process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.APP_URL = "http://localhost:5173";
process.env.ADMIN_LOGINS = "the-owner";
