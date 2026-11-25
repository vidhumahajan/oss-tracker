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
// The AI service is faked in helpers.js, so this key is never really used.
process.env.AI_API_KEY = "test-ai-key";
process.env.AI_API_URL = "https://ai.test/openai/v1/chat/completions";
process.env.SUMMARY_MODEL = "test-model";
// Email is never really sent in tests: services/mail.js keeps the messages
// in memory instead. These only make the settings look complete.
process.env.SMTP_HOST = "smtp.test";
process.env.SMTP_USER = "sender@test.example";
process.env.SMTP_PASS = "test-password";
// Brevo is off unless a test turns it on, even if your own .env has a key.
process.env.BREVO_API_KEY = "";
process.env.MAIL_FROM = "OSS Tracker <sender@test.example>";
process.env.ADMIN_EMAIL = "admins@test.example";
process.env.TIME_ZONE = "Asia/Kolkata";
