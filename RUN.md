# NeoXten Automation Framework — Run instructions

**Version:** 2.1.0  
**Node.js:** >= 18

## 1. Install dependencies

After extracting this ZIP:

```bash
npm install
```

This installs Playwright and will prompt to install Chromium if needed.

## 2. Run a config

```bash
node dist/cli/index.js run --config neoxtemus-boot.yaml
```

Use any of the included YAML configs (`neoxtemus-boot.yaml`, `neoxtemus-nav.yaml`, `neoxtemus-assistant.yaml`, etc.) or your own.

## 3. Run the Neoxtemus gate (all steps)

From this directory, with Neoxtemus AI repo at `../neoxtemus-ai`:

```bash
node dist/cli/index.js gate --preset neoxtemus --out-dir ../neoxtemus-ai/.neoxten-out
```

Adjust `--out-dir` if your Neoxtemus path is different.

## Verdict and artifacts

Output is written to the configured `--out-dir` (or `.neoxten-out` by default). Each run produces `verdict.json`, logs, and screenshots on failure.
