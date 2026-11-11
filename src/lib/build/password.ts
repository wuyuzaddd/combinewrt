import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

type SpawnLike = typeof spawn;

function runCommand(command: string, args: string[], input: string, spawnImpl: SpawnLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`openssl passwd failed (${code}): ${stderr.trim()}`));
    });
    child.stdin?.end(input);
  });
}

export async function hashRootPassword(
  password: string,
  options: { spawnImpl?: SpawnLike; salt?: string } = {},
): Promise<string> {
  if (!password) throw new Error("root password is empty");
  const salt = options.salt ?? randomBytes(8).toString("hex");
  const hash = await runCommand(
    "openssl",
    ["passwd", "-6", "-salt", salt, "-stdin"],
    password,
    options.spawnImpl ?? spawn,
  );
  if (!hash.startsWith(`$6$${salt}$`)) {
    throw new Error("openssl returned an unexpected password hash");
  }
  return hash;
}
