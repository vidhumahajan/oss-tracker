import dns from "node:dns";
import mongoose from "mongoose";
import { config } from "./config.js";
// Some networks cannot do the address lookup that MongoDB Atlas needs.
// Setting DNS_SERVERS in .env (for example 8.8.8.8,1.1.1.1) makes Node
// ask those servers instead. Leave it unset when the network works.
if (process.env.DNS_SERVERS) {
  const servers = process.env.DNS_SERVERS.split(",").map((s) => s.trim());
  dns.setServers(servers);
  dns.promises.setServers(servers);
}
export async function connectDB() {
  await mongoose.connect(config.mongoUri);
  console.log("MongoDB connected");
}
