# AGENTS

This repo is used to test PlastyPesa like a real user.

## Ground Truth

- Work from the live PlastyPesa repos and the user's current instructions.
- Do not rely on deleted Intelligence Lab documents or old planning artifacts.
- If older docs conflict with the user's latest instruction, the latest instruction wins.

## Primary Purpose

Use this framework to verify real end-to-end behavior across:

- PlastyPesa mobile app
- PlastyPesa admin dashboard
- landing pages
- legal/privacy/terms surfaces
- trust-critical flows such as signup, sorting, points, leaderboard, rewards, and moderation

## Credentials and Access

- Canonical local credentials/config live in:
  - `C:\Users\Bobby\Documents\plastypesa-admin-dashboard\ALL CREDENTIALS FOR PLASTYPESA 15-03-2026\`
- Useful quick-reference/testing material may also exist in:
  - `C:\Users\Bobby\Documents\plastypesa-admin-dashboard\.local\plastypesa-test-credentials.md`
  - `C:\Users\Bobby\Documents\plastypesa-admin-dashboard\DOCS\PLASTYPESA_REAL_USER_TEST_GUIDE.md`
- AWS CLI, Firebase CLI, and MongoDB tooling are installed locally.
- Agents should attempt to use local access when needed.
- If access is blocked, do not invent fallback architecture. Stop and report the exact failing command/auth point so the user can restore access.

## Verify Access Before Cloud-Dependent Work

Only when needed for the task, verify:

- AWS access
- Firebase access
- MongoDB access
- any local config/env needed from the admin dashboard repo

Examples:

```powershell
aws sts get-caller-identity
firebase projects:list
mongosh --eval "db.adminCommand({ ping: 1 })"
```

## Real Device Rule

The owner keeps a physical Android device connected via ADB.
Use it for mobile verification whenever the tested flow touches the app.

At minimum:

```powershell
adb devices
adb logcat
```

Do not treat browser-only or code-only checks as sufficient for mobile-facing changes.

## Phase-Based Verification Rule

When PlastyPesa work is being executed in phases:

- test one phase at a time
- do not mark a phase complete without real verification
- do not skip affected surfaces just because the code compiles

If a phase changes:

- backend behavior → verify user-facing app/admin impact
- mobile UI/logic → verify on connected ADB device
- admin or landing → verify directly in browser
- translations/legal/copy → verify visible text, not just files

## What "Real User" Testing Means

Test like a normal user would:

- open screens
- tap buttons
- complete flows
- trigger errors
- inspect visible text
- verify translations
- verify points/results/status changes
- verify admin-side effects when relevant

For PlastyPesa, this includes checking:

- signup/login
- sort submission
- sort status visibility
- leaderboard/prize copy
- feed/community behavior
- settings/legal pages
- admin review and moderation behavior

## Phase Closeout Format

For every completed testing phase, produce:

1. What was implemented
2. What was tested
3. Real-user test results
4. Admin test results
5. Bugs found and fixed
6. Remaining risks
7. Completion decision:
   - `Phase complete, proceed`
   - `Phase not complete, continue working this phase`

Do not mark a phase complete based only on code review or unit tests.

## Never

- Never commit credentials or secrets.
- Never skip real-device/manual verification for affected PlastyPesa user flows.
- Never hide failed tests behind vague wording.
- Never redesign around missing access before checking local access and asking the user for help.
