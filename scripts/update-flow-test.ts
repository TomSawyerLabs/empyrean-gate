// Self-update process choreography, without needing a GitHub release.
//
// Reproduces the field failure that followed v0.4.0 -> v0.5.1 and proves both
// halves of the fix:
//
//   1. PROMOTION — after the successor takes over, the path the operator
//      launches from must end up holding the NEW binary. Without this the
//      shortcut keeps starting the old version forever.
//   2. DOWNGRADE REFUSAL — an older binary must not take the port from a newer
//      running instance. That is what put v0.4.0 back on the rig: the old exe
//      was still on the desktop, got launched, saw the port busy, and "took
//      over" a running show.
//
// Both instances run against an isolated config + port, so this never touches a
// real installation.
//
//   bun scripts/update-flow-test.ts [path to empyrean-gate exe]

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, copyFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXE =
  process.argv[2] ??
  join(import.meta.dir, "..", "src-tauri", "target", "debug", "empyrean-gate.exe");
const PORT = 9538;
const BASE = `http://127.0.0.1:${PORT}`;
const OLD_VERSION = "0.4.0";

function fail(msg: string): never {
  console.error(`UPDATE FLOW FAIL: ${msg}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), "empyrean-update-"));
const launcher = join(dir, "launcher.exe"); // what a shortcut points at
const versioned = join(dir, "empyrean-gate-v9.9.9.exe"); // what an update downloads
const configPath = join(dir, "config.json");
const children: ChildProcess[] = [];

function start(exe: string, extra: string[], fakeVersion?: string): ChildProcess {
  const child = spawn(exe, ["--headless", ...extra], {
    env: {
      ...process.env,
      EMPYREAN_CONFIG: configPath,
      ...(fakeVersion ? { EMPYREAN_FAKE_VERSION: fakeVersion } : {}),
    },
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

async function version(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/version`);
    if (!res.ok) return null;
    return ((await res.json()) as { version: string }).version;
  } catch {
    return null;
  }
}

async function waitForVersion(want: string, seconds: number): Promise<void> {
  for (let i = 0; i < seconds * 10; i++) {
    if ((await version()) === want) return;
    await sleep(100);
  }
  fail(`no instance reporting v${want} on ${BASE} after ${seconds}s (saw ${await version()})`);
}

try {
  copyFileSync(EXE, launcher);
  copyFileSync(EXE, versioned);
  // The launcher pretends to be the old release; the versioned sibling is the
  // freshly "downloaded" new one, which reports its real (higher) version.
  Bun.write(
    configPath,
    JSON.stringify({
      ...JSON.parse(readFileSync(join(import.meta.dir, "..", "tests/fixtures/default-config.json"), "utf8")),
      server: { bind: "127.0.0.1", port: PORT, max_preview_clients: 10, auth_token: null, join_token: "", require_token: false },
    }),
  );

  // --- 1. the old instance is running a show ---
  start(launcher, [], OLD_VERSION);
  await waitForVersion(OLD_VERSION, 30);
  console.log(`old instance up, reporting v${OLD_VERSION}`);
  const launcherBefore = statSync(launcher).mtimeMs;

  // --- 2. an update lands: the successor takes over and promotes itself ---
  start(versioned, ["--promote-to", launcher]);
  const newVersion = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
  ).version as string;
  await waitForVersion(newVersion, 60);
  console.log(`successor took over, reporting v${newVersion}`);

  // Promotion retries for up to ~6s after the old process releases the file.
  let promoted = false;
  for (let i = 0; i < 120; i++) {
    if (statSync(launcher).mtimeMs !== launcherBefore) {
      promoted = true;
      break;
    }
    await sleep(100);
  }
  if (!promoted) fail("the launcher path was never replaced with the new binary");
  if (statSync(launcher).size !== statSync(versioned).size) {
    fail("the launcher was replaced but does not match the new binary");
  }
  console.log("launcher path promoted to the new binary");

  // --- 3. the stale shortcut gets double-clicked: it must NOT take over ---
  const stale = start(versioned, [], OLD_VERSION);
  const exited = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 20000);
    stale.on("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!exited) fail("an older instance did not exit when a newer one held the port");
  const still = await version();
  if (still !== newVersion) {
    fail(`downgraded! the port now reports v${still}, expected v${newVersion}`);
  }
  console.log("older instance refused to take over and exited; newer one still serving");

  console.log("UPDATE FLOW PASS");
} finally {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
  await sleep(500);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may still hold a handle; the temp dir is disposable.
  }
}
