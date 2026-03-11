import { spawn } from "node:child_process";

const mode = process.env.SERVICE_MODE ?? "web";

const run = (cmd, args) =>
  spawn(cmd, args, {
    stdio: "inherit",
    shell: true,
  });

if (mode === "noop") {
  // Keep container healthy while effectively disabling this service.
  const sleeper = run("sleep", ["infinity"]);
  sleeper.on("exit", (code) => process.exit(code ?? 1));
} else if (mode === "worker") {
  const worker = run("npm", ["run", "worker"]);
  worker.on("exit", (code) => process.exit(code ?? 1));
} else {
  // Run web; run worker only when REDIS_URL is set (otherwise API uses inline jobs).
  const web = run("npm", ["run", "start:web"]);
  const hasRedis = Boolean(process.env.REDIS_URL?.trim());
  const worker = hasRedis ? run("npm", ["run", "worker"]) : null;

  const shutdown = () => {
    web.kill("SIGTERM");
    if (worker) worker.kill("SIGTERM");
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  web.on("exit", (code) => {
    if (worker) worker.kill("SIGTERM");
    process.exit(code ?? 1);
  });

  if (worker) {
    worker.on("exit", (code) => {
      web.kill("SIGTERM");
      process.exit(code ?? 1);
    });
  }
}
