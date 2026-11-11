import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("usage: npm run hash-password -- '<password>'");
  process.exit(1);
}

const salt = randomBytes(16);
const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
console.log(`scrypt$${salt.toString("hex")}$${derived.toString("hex")}`);
