// Entry point: connect to the database, start the server, start the
// background sync and the session reminders.
import { app } from "./app.js";
import { config } from "./config.js";
import { connectDB } from "./db.js";
import { startSyncLoop } from "./jobs/syncLoop.js";
import { startReminderLoop } from "./jobs/reminderLoop.js";

await connectDB();

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});

if (config.syncEnabled) {
  startSyncLoop();
}

startReminderLoop();
