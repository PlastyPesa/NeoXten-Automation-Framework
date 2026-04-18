# Cursor Rules Template

These are Bobby's standard quality enforcement rules for AI agents in Cursor IDE.

## How to use for a new project

Copy all `.mdc` files into your new project's `.cursor/rules/` folder:

```powershell
# From your new project root:
mkdir -p .cursor/rules
Copy-Item "C:\Users\Bobby\Documents\NeoXten-Automation-Framework\cursor-rules-template\*.mdc" ".cursor/rules/"
```

Or if you're cloning fresh and NeoXten isn't local yet:

```powershell
# Clone NeoXten first, then copy
git clone https://github.com/PlastyPesa/NeoXten-Automation-Framework.git
Copy-Item "NeoXten-Automation-Framework\cursor-rules-template\*.mdc" "your-project\.cursor\rules\"
```

## What's included

### Universal rules (apply to any project)
- `verification-first.mdc` — Verify against real output, not assumptions
- `deployment-discipline.mdc` — Deploy methodically, verify live
- `quality-over-speed.mdc` — Thoroughness prevents rework
- `real-device-testing.mdc` — ADB device testing mandatory
- `testing-innovation.mdc` — NeoXten mandatory, extend it, invent what's needed
- `cross-system-coherence.mdc` — Changes cascade to all systems, languages, legal docs
- `neoxten-test-and-commit.mdc` — Agent runs tests, never asks the user
- `deploy-when-needed.mdc` — Agent deploys, never says "please deploy"
- `phase-based-delivery.mdc` — Plan, approval, implement, test, commit

### PlastyPesa-specific (adapt or remove for other projects)
- `plastypesa-local-testing.mdc` — Credentials and test procedures

## Customization

For a new project:
1. Copy all universal rules as-is.
2. Remove or adapt `plastypesa-local-testing.mdc` for your project's credentials.
3. Add project-specific rules (like `plastypesa-agent-onboarding.mdc`) as needed.
4. Update `cross-system-coherence.mdc` if your project has different systems or languages.

## Important

All rules use `alwaysApply: true` so agents read them automatically. No manual step needed.
