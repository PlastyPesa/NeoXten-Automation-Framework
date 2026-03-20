# Sort-proof enabled/disvisibility — cross-surface E2E

**One business flow:** admin toggles **Home sorting proof** → API `GET /home/sort-proof/config` → mobile Home pull-to-refresh → quick action visibility → (optional) admin restores previous flag.

## Run (NeoXten root)

```bash
npm run test:plastypesa-e2e:sort-proof-visibility
```

## Requirements

| Requirement | Why |
|-------------|-----|
| `PLASTYPESA_ADMIN_EMAIL` / `PLASTYPESA_ADMIN_PASSWORD` | Admin UI login |
| `PLASTYPESA_USER_JWT` or `PLASTYPESA_TEST_EMAIL` + `PLASTYPESA_TEST_PASSWORD` | Same user JWT the **mobile app** uses — must see the same API as the device |
| `PLASTYPESA_API_BASE` | API root |

Set these in NeoXten **`.env`** or **`.env.plastypesa`** (optional second file; overrides `PLASTYPESA_*` from `.env`). See **`.env.plastypesa.example`**. If phase 1 is **skipped**, Playwright did not see admin credentials.
| ADB device in `device` state | Flutter step |
| **Phone:** user already **logged in** on **Home** (pull-to-refresh must run on User Home) | UI assertion |

## Optional env

- `PLASTYPESA_SORT_PROOF_E2E_SKIP_RESTORE=1` — do not run step 4 (leave flag toggled).
- `PLASTYPESA_NEOXTEN_ROOT` — if Playwright cannot infer NeoXten path (writes `.neoxten/sort-proof-e2e-state.json`).

## Artifacts

- State: `.neoxten/sort-proof-e2e-state.json` (written by Playwright)
- Verdict: `.neoxten-out/plastypesa-sort-proof-visibility-verdict-*.json`

## What this replaces

Manual: admin change → curl config → open app → refresh → eyeball quick action → revert in admin.
