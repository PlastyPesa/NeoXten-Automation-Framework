/**
 * Batch 1 gate: Velarune icon pack disk parity (manifest + naming-map + icons/ tree + checksums).
 * Depends on sibling repo `Veralune Studio` built to dist/.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const neoRoot = resolve(__dirname, "..", "..");
const velaruneRoot = resolve(neoRoot, "..", "Veralune Studio");
const verifyModulePath = join(velaruneRoot, "dist", "icon-pack", "verify-export-parity.js");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>`;

async function runVelaruneIconPackBatch1Gate(): Promise<void> {
  if (!existsSync(velaruneRoot)) {
    throw new Error(`Velarune Studio not found at ${velaruneRoot}`);
  }
  if (!existsSync(verifyModulePath)) {
    execSync("npm run build", { cwd: velaruneRoot, stdio: "inherit" });
  }
  if (!existsSync(verifyModulePath)) {
    throw new Error(`Missing ${verifyModulePath} after build`);
  }

  const mod = (await import(pathToFileURL(verifyModulePath).href)) as {
    verifyIconPackFromDisk: (root: string) => { ok: boolean; errors: string[] };
    hashSvgSha256Hex: (s: string) => string;
  };
  const { verifyIconPackFromDisk, hashSvgSha256Hex } = mod;

  const root = mkdtempSync(join(tmpdir(), "nx-icon-batch1-"));
  try {
    mkdirSync(join(root, "icons", "nav"), { recursive: true });
    const rel = "icons/nav/vr-test-16.svg";
    writeFileSync(join(root, rel), svg, "utf8");
    const h = hashSvgSha256Hex(svg);
    const namingMap = { "test-16": rel };
    writeFileSync(join(root, "naming-map.json"), JSON.stringify(namingMap), "utf8");
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({
        slice: "icon_family",
        fileChecksums: { [rel]: h },
        catalogNamingKeys: ["test-16"],
      }),
      "utf8",
    );

    const good = verifyIconPackFromDisk(root);
    if (!good.ok) {
      throw new Error(`Expected parity PASS, got: ${good.errors.join("; ")}`);
    }

    writeFileSync(join(root, "icons/nav/extra.svg"), svg, "utf8");
    const bad = verifyIconPackFromDisk(root);
    if (bad.ok) {
      throw new Error("Expected parity FAIL after orphan svg");
    }
    if (!bad.errors.some((e) => e.includes("orphan"))) {
      throw new Error(`Expected orphan error, got: ${bad.errors.join("; ")}`);
    }

    console.log("PASS: Velarune icon pack Batch 1 parity gate (NeoXten)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

runVelaruneIconPackBatch1Gate().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
