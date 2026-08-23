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
import { appendFileSync, mkdtempSync, copyFileSync, readFileSync, rmSync, statSync } from "node:fs";
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

/// Make the stand-in "old" binary distinguishable from the "new" one.
///
/// Both are copies of the same build, so content and size are identical and
/// promotion would be undetectable — and mtime is no help either, because
/// `std::fs::copy` uses CopyFileExW on Windows, which carries the SOURCE's
/// timestamp across. Appended bytes sit past the last PE section and are ignored
/// by the loader, so the file still runs; size then says whether it was replaced.
function markAsOld(path: string) {
  appendFileSync(path, Buffer.alloc(4096, 0x7e));
}

async function waitForPromotion(launcherPath: string, newPath: string, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) {
    if (statSync(launcherPath).size === statSync(newPath).size) return;
    await sleep(100);
  }
  fail(`the launcher path was never replaced with the new binary (${launcherPath})`);
}
const dir = mkdtempSync(join(tmpdir(), "empyrean-update-"));
// Named as an operator's really is: either the release asset's own filename or a
// tidied-up rename. Discovery keys off the name, so testing with something like
// `launcher.exe` would prove nothing about the real case.
const launcher = join(dir, "empyrean-gate-windows-x64.exe");
const newVersion = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
).version as string;
// Named exactly as the updater names its download — `empyrean-gate-v<version>`
// with the version the binary itself reports. The successor uses that to
// recognise it is running from a download rather than from a launcher.
const versioned = join(dir, `empyrean-gate-v${newVersion}.exe`);
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
  markAsOld(launcher);
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

  // --- 2. an update lands: the successor takes over and promotes itself ---
  start(versioned, ["--promote-to", launcher]);
  await waitForVersion(newVersion, 60);
  console.log(`successor took over, reporting v${newVersion}`);

  // Promotion retries for a few seconds after the old process releases the file.
  await waitForPromotion(launcher, versioned, 12);
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

  // --- 4. the same thing, but started by a binary too old to pass --promote-to ---
  // This is the real-world path off v0.4.0/v0.5.1: their updater spawns the new
  // binary with no promotion argument at all, so the new one has to work the
  // launcher out for itself. Without this, escaping an old version would need a
  // manual install.
  for (const child of children.splice(0)) {
    child.kill();
  }
  await sleep(1500);
  copyFileSync(EXE, launcher); // pretend the launcher is the old release again
  markAsOld(launcher);
  start(launcher, [], OLD_VERSION);
  await waitForVersion(OLD_VERSION, 30);
  start(versioned, []); // NO --promote-to, exactly like an old updater
  await waitForVersion(newVersion, 60);
  await waitForPromotion(launcher, versioned, 12);
  console.log("successor with no --promote-to found and healed the launcher itself");

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
