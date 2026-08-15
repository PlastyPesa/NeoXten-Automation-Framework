/**
 * P-SCROLL-JANK — how a scroll actually feels, measured instead of argued about.
 *
 * Phase 8. The owner has reported the four long pages feeling rough more than
 * once, and every previous answer to that was somebody's opinion of a
 * screenshot. A screenshot cannot show a dropped frame.
 *
 * This drives real swipes on the connected phone and reads the compositor's
 * own record of when each frame actually reached the glass.
 *
 * **Not `dumpsys gfxinfo`.** That was the first attempt and it came back with a
 * single frame per screen while the app was visibly scrolling. Flutter does not
 * draw through Android's HWUI — it renders to its own SurfaceView — so HWUI's
 * counters have almost nothing to count. The number was not small, it was
 * absent, and reporting it as "0% janky" would have been a lie dressed as a
 * pass. `SurfaceFlinger --latency` sees every presented frame regardless of who
 * drew it.
 *
 * Reported per screen:
 *
 *   dropped %  — vsyncs that came and went with no new frame. This is what a
 *                member perceives as stutter. Under ~5% reads as smooth.
 *   p50/p90/p99 — the gap between one frame reaching the screen and the next.
 *                16.7 ms is one frame at 60 Hz. p90 is the honest headline;
 *                p50 hides the stalls, and the stalls are the whole complaint.
 *
 * Run it on a **profile** build. Debug is JIT-compiled and always janky, so a
 * debug number would condemn code that is fine; release carries production ad
 * units and is off-limits for agent sessions.
 *
 * ── STATUS 2026-08-15: DO NOT QUOTE THESE NUMBERS YET ──────────────────────
 *
 * The drive loop is sound — it resets between tabs, drags continuously, and
 * photographs what it measured. The *reader* is not: on this handset
 * `--latency-clear` leaves three of the four layers returning an empty buffer,
 * so a screen that scrolled perfectly normally comes back as "0 frames", which
 * is indistinguishable from a screen that did not scroll at all.
 *
 * A ledger of what has already been ruled out, so nobody repeats it:
 *
 *   `dumpsys gfxinfo`            — blind. Flutter renders to its own
 *                                  SurfaceView and never touches HWUI, so its
 *                                  counters report one frame for a full scroll.
 *   short swipes with pauses     — measures the pauses. Idle produces no
 *                                  frames, so the gaps land in the sample and
 *                                  a median of 115 ms says 8 fps about an app
 *                                  running fine.
 *   swiping without unwinding    — a drag can open a card. Three "different
 *                                  screens" came back with identical numbers
 *                                  because all three were the same pushed
 *                                  detail page.
 *   `SurfaceFlinger --latency`   — sees the frames, but the buffer comes back
 *                                  empty after a tab change on this device.
 *
 * **Next instrument:** `integration_test` (already a dev dependency) driven by
 * `flutter drive`, with `TimelineSummary`. It is the canonical Flutter measure
 * and it splits **build** time from **raster** time — which is the whole
 * question here, because a blur behind a moving card costs raster and nothing
 * else. A build/raster split proves or kills the BackdropFilter hypothesis in
 * one run; frame-to-frame gaps never can.
 *
 * Usage:
 *   node scripts/plastypesa/scroll-jank-adb.mjs
 *   node scripts/plastypesa/scroll-jank-adb.mjs --label after-fix
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "com.app.plasty_pesa";
const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");
const labelIdx = process.argv.indexOf("--label");
const LABEL = labelIdx > -1 ? process.argv[labelIdx + 1] : "baseline";

const adb = (...args) =>
  execFileSync("adb", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const sh = (cmd) => adb("shell", cmd);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The four long pages, and how to reach each from the bottom bar.
 *
 * Tab coordinates are read from the device's own size rather than hard-coded,
 * so this survives being run on a different handset — a fixed pixel table is
 * how a test starts silently tapping the wrong thing.
 */
const TABS = [
  { name: "Home", slot: 0 },
  { name: "Learn", slot: 1 },
  { name: "Leaderboard", slot: 2 },
  { name: "Community", slot: 3 },
];

function screenSize() {
  const m = sh("wm size").match(/(\d+)x(\d+)/);
  return { w: Number(m[1]), h: Number(m[2]) };
}

/**
 * The compositor layer Flutter actually presents into.
 *
 * Resolved by name each run rather than hard-coded: the BLAST suffix and the
 * `#0` index both move between Android versions, and a stale layer name returns
 * an empty dump that looks exactly like a perfectly smooth app.
 */
function flutterLayer() {
  const lines = sh("dumpsys SurfaceFlinger --list").split(/\r?\n/);
  const hit =
    lines.find((l) => l.includes(PKG) && l.includes("SurfaceView") && l.includes("BLAST")) ||
    lines.find((l) => l.includes(PKG) && l.includes("SurfaceView"));
  if (!hit) throw new Error(`no SurfaceView layer for ${PKG} — is the app in the foreground?`);
  return hit.trim();
}

/**
 * One measured pass: park on the screen, clear the frame ledger, swipe, read it.
 *
 * The swipes are deliberately slow-ish (400 ms across most of the page). A
 * 50 ms fling would spend most of its frames in ballistic decay where the
 * engine has little to do; a real thumb drags, and dragging is when a blur
 * behind a moving card has to be recomputed every single frame.
 */
/**
 * One measured pass: a single continuous drag, then read the buffer.
 *
 * The first version fired ten short swipes with a pause after each. Idle time
 * produces no frames, so those pauses landed in the gap list and dragged the
 * median to 115 ms — a number that says 8 fps about an app that plainly is not
 * running at 8 fps. **The pauses were being measured, not the scroll.**
 *
 * One 2.5-second drag instead. Android delivers motion events continuously for
 * its whole duration, so every gap in the buffer belongs to a moving finger,
 * which is the only thing being asked about. Three drags are merged so a single
 * unlucky garbage collection cannot decide the verdict.
 */
async function measure(screen, layer, size) {
  const x = Math.round(size.w / 2);
  const top = Math.round(size.h * 0.75);
  const bottom = Math.round(size.h * 0.3);

  const merged = [];
  let refreshMs = 16.67;
  for (const [from, to] of [
    [top, bottom],
    [bottom, top],
    [top, bottom],
  ]) {
    sh(`dumpsys SurfaceFlinger --latency-clear '${layer}'`);
    await sleep(250);
    sh(`input swipe ${x} ${from} ${x} ${to} 2500`);
    await sleep(250);
    const pass = parse(sh(`dumpsys SurfaceFlinger --latency '${layer}'`));
    refreshMs = pass.refreshMs;
    merged.push(...pass.gaps);
    await sleep(400);
  }

  return summarise(screen, refreshMs, merged);
}

/**
 * Turn present timestamps into the two numbers that describe a scroll.
 *
 * The dump is a refresh period followed by rows of three nanosecond stamps; the
 * middle one is when the frame was actually presented. The gap between
 * consecutive presents is what an eye sees, so a 33 ms gap at 60 Hz means one
 * vsync went by showing the previous frame again — one dropped frame.
 *
 * `INT64_MAX` appears in rows that never presented (the buffer is a ring and is
 * pre-filled); those are discarded rather than counted as enormous stalls.
 */
function parse(out) {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const refreshNs = Number(lines[0]) || 16666667;
  const presents = [];

  for (const line of lines.slice(1)) {
    const cols = line.split(/\s+/).map(Number);
    if (cols.length < 3 || !Number.isFinite(cols[1])) continue;
    if (cols[1] <= 0 || cols[1] >= 9.2e18) continue;
    presents.push(cols[1]);
  }
  presents.sort((a, b) => a - b);

  const gaps = [];
  for (let i = 1; i < presents.length; i++) {
    const ms = (presents[i] - presents[i - 1]) / 1e6;
    // Above 300 ms the finger was not moving — a settle, a fetch, the moment
    // before the drag began. Those belong to no scroll and are dropped.
    if (ms > 0 && ms <= 300) gaps.push(ms);
  }
  return { refreshMs: Number((refreshNs / 1e6).toFixed(2)), gaps };
}

function summarise(screen, refreshMs, gaps) {
  const sorted = [...gaps].sort((a, b) => a - b);
  const pct = (p) =>
    sorted.length ? Number(sorted[Math.floor((sorted.length - 1) * p)].toFixed(1)) : null;
  const dropped = gaps.reduce((n, ms) => n + Math.max(0, Math.round(ms / refreshMs) - 1), 0);

  return {
    screen,
    refreshMs,
    frames: gaps.length,
    dropped,
    droppedPct: gaps.length ? Number(((dropped / (gaps.length + dropped)) * 100).toFixed(1)) : 0,
    p50: pct(0.5),
    p90: pct(0.9),
    p99: pct(0.99),
  };
}

async function main() {
  mkdirSync(PROOF, { recursive: true });
  const size = screenSize();

  sh(`am force-stop ${PKG}`);
  await sleep(800);
  sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  // A cold start does its own heavy work — ad gate, first fetch, image decode.
  // Measuring inside that window would blame the scroll for the launch.
  await sleep(12000);

  const layer = flutterLayer();

  // The bottom bar sits above the system navigation bar, not at the very edge.
  // 0.94 lands on the labels; 0.965 lands on Android's own back/home row, which
  // is how an earlier run measured four copies of the same screen.
  // There are five destinations in the bar (Profile is the fifth) even though
  // only four are measured, so the slot arithmetic divides by five.
  const bar = Math.round(size.h * 0.92);
  const rows = [];
  for (const tab of TABS) {
    // A drag can land on a card and push a detail screen. The first run did
    // exactly that and then measured the same pushed page four times, reporting
    // three identical rows as if they were three different screens. Unwinding
    // first costs two keystrokes and makes the tab tap mean what it says.
    for (let i = 0; i < 3; i++) {
      sh("input keyevent KEYCODE_BACK");
      await sleep(400);
    }
    const x = Math.round((size.w * (tab.slot * 2 + 1)) / 10);
    sh(`input tap ${x} ${bar}`);
    await sleep(2500);
    rows.push(await measure(tab.name, layer, size));

    // Photograph what was actually measured. A frame-time table cannot tell me
    // it was pointed at the wrong screen; a screenshot can.
    sh(`screencap -p /sdcard/jank-${tab.name}.png`);
    adb("pull", "-a", `/sdcard/jank-${tab.name}.png`, join(PROOF, `jank-${LABEL}-${tab.name}.png`));
  }

  const out = { label: LABEL, at: new Date().toISOString(), device: size, layer, rows };
  const path = join(PROOF, `scroll-jank-${LABEL}-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));

  console.log(`\nscroll jank · ${LABEL} · ${size.w}x${size.h} · ${rows[0]?.refreshMs} ms/frame budget\n`);
  console.log("screen        frames  dropped        p50     p90     p99");
  for (const r of rows) {
    console.log(
      `${r.screen.padEnd(13)} ${String(r.frames).padStart(6)}  ` +
        `${String(r.dropped).padStart(4)} ${String(r.droppedPct + "%").padStart(7)}  ` +
        `${String(r.p50 ?? "-").padStart(9)}  ${String(r.p90 ?? "-").padStart(6)}  ${String(r.p99 ?? "-").padStart(6)}`
    );
  }
  console.log(`\n${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
