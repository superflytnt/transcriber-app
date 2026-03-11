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
  // Run web + worker together so uploaded files and worker share filesystem.
  const web = run("npm", ["run", "start:web"]);
  const worker = run("npm", ["run", "worker"]);

  const shutdown = () => {
    web.kill("SIGTERM");
    worker.kill("SIGTERM");
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  web.on("exit", (code) => {
    worker.kill("SIGTERM");
    process.exit(code ?? 1);
  });

  worker.on("exit", (code) => {
    web.kill("SIGTERM");
    process.exit(code ?? 1);
  });
}
