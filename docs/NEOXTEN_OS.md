# NeoXten OS — Apple-Grade Doctrine

System-wide rules for NeoXten projects. All agents and contributors must follow.

---

## 1. Shipping Standard

- **Apple-grade only.** No "later", no "phase", no "v1/v2/v3" framing for shipping.
- **Architectural foresight required.** Design the full final architecture immediately. No temporary foundations.

---

## 2. Evidence-First

- **Never guess.** If uncertain: verify in repo (search, logs, file inspection) and cite the proof.
- **When reporting:** Provide proof + plan, not speculation.

---

## 3. Agent Execution

- **Agent executes and tests.** Do not ask Bobby to run commands unless unavoidable.
- **If a command is required:** Request one single-line command with the exact expected output.
- **One mission at a time.** No extra unrelated changes.

---

## 4. Definition of Done

- **"Done" means:** Automation verdict is PASS with saved artifacts.

---

## 5. UI Requirements

- **Testable by default.** Add stable `data-testid` selectors for interactive elements.
- **Bounded async.** Every async action must have timeouts and must fail with evidence. No infinite spinners.

---

## 6. Assistant Reliability

- **One user action → one inference call.** Prove with logs/counters.
- **Inference accounting:** Expected = 1, actual = 1. Failure includes call counts and evidence excerpts.
