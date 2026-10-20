import { DockerSandbox } from "eve/sandbox/docker";
import { defineSandbox } from "eve/sandbox";
import type { SandboxSession } from "eve/sandbox";

async function runOrFail(
  sandbox: SandboxSession,
  command: string,
  workingDirectory?: string
) {
  const result = await sandbox.run({ command, workingDirectory });
  if (result.exitCode !== 0) {
    throw new Error(
      `Sandbox prepare step failed (${command}): ${result.stderr || result.stdout}`
    );
  }
  return result;
}

export const environment = DockerSandbox.dockerfile({
  prepare: async (sandbox) => {
    await runOrFail(sandbox, "npm ci --no-audit --no-fund", "/workspace");
    await runOrFail(
      sandbox,
      "npx playwright install --with-deps chromium",
      "/workspace"
    );
    await runOrFail(sandbox, "ffmpeg -version");
    await runOrFail(sandbox, "python3 -V");
    await runOrFail(sandbox, "node -v");
    await runOrFail(sandbox, "ls src");
  },
});

export default defineSandbox(() =>
  environment.open({ networkPolicy: "allow-all" })
);
