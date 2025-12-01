# AGENTS.md — Audit Flight Simulator (Codex Operating Guide)

> Read this first. If you’re unsure what to build next, re-read the **North Star** and ship the smallest thing that increases *realism + detection skill + immediate feedback*.

## North Star (Product Vision)
We are replacing passive, generic audit training with **active, high-stakes simulation**—turning “auditor judgment” from an abstract concept into a **measurable skill**.

Traditional training is a **lecture hall**. This product is a **flight simulator**:
- Briefing → cockpit (workpaper) → realistic disaster (“the trap”) → crash safely → learn instantly.

**10X differentiator**
- We don’t teach “rules.” We teach **detection**.
- We don’t provide perfect data. We provide **defective data** and make the user find the needle in the haystack.

If the user doesn’t feel a spike of adrenaline when they find the error, we haven’t done our job.

---

## What this repo is (and is not)

### Is
A **content-agnostic simulation OS** that can run many audit scenarios (“cartridges”) with consistent mechanics:
- Just-in-time instruction
- Workpaper simulation (evidence + work)
- Real-time/instant feedback
- Mastery tracking (competency, not completion)

### Is not
- A generic LMS
- A video library with quizzes
- A course builder full of “nice-to-have” UI
- A project that prioritizes “login page polish” over the core simulation loop

When tempted by scope creep, ship the next improvement to the **core loop** instead.

---

## The Universal Audit Engine (4 layers)

### Layer 1 — The Academy (Instruction Engine)
**Metaphor:** the senior’s desk  
**Function:** deliver Just-in-Time theory that enables correct judgment inside the sim.

Required components:
- **Hook:** high-stakes context (why it matters, fraud/misstatement risk)
- **Asset:** embedded visual (video/diagram/timeline)
- **Heuristic:** the “golden rule” (memorable detection rule)
- **Gate:** forcing function quiz that blocks cockpit entry until grasped

Implementation rule: the Academy exists to make the cockpit decisions *meaningful*, not to be a standalone course.

---

### Layer 2 — The Workpaper (Simulation Engine)
**Metaphor:** the cockpit  
**Function:** a split-screen environment that mimics real work.

- **Left panel (Evidence):** PDFs, emails, bank statements, supporting docs
- **Right panel (Work):** interactive grid/spreadsheet, ticking/tying, assertions, classification choices

**Trap logic**
- **Distractors:** realistic noise that should be “passed”
- **Triggers:** specific embedded errors that should be flagged
- The engine validates against a hidden **Answer Key** in real time (or on submit), then routes feedback through the Reviewer.

Design constraint: realism comes from the *shape* of the workflow and imperfect data—not from UI decoration.

---

### Layer 3 — The Reviewer (Feedback Engine)
**Metaphor:** review note  
**Function:** instant, context-aware correction.

- If the user is correct: crisp “good catch” dopamine hit
- If incorrect: immediate remediation explaining *why* the judgment was wrong and what heuristic applies

Hard constraint: **no waiting for a grade**. Feedback must be immediate.

---

### Layer 4 — The Partner (Mastery Dashboard)
**Metaphor:** performance review  
**Function:** aggregate learning across modules.

Tracks **competency**, not just completion.
Example: “User has mastered SURL but struggles with Existence assertions.”

---

## Launch content (Vertical slices / “Cartridges”)
We prove the engine is universal by shipping distinct scenarios that reuse the same underlying mechanics.

### Module A — Search for Unrecorded Liabilities (SURL)
- **Risk:** timing / cutoff
- **Trap:** invoice dated Jan 3 for services performed Dec 28
- **Lesson:** expenses follow the work, not the paper
- **Mechanic:** document inspection (PDF vs GL)

### Module B — Cash & Bank Recs
- **Risk:** existence / completeness
- **Trap:** “phantom check” outstanding that never clears subsequent bank statement
- **Lesson:** just because it balances doesn’t mean it’s real
- **Mechanic:** recon logic (bank vs GL vs outstanding list)

### Module C — Expenses & Vouching (future)
- **Risk:** classification / occurrence
- **Trap:** R&M expense that should be capitalized (CapEx)
- **Lesson:** big numbers need to be capitalized
- **Mechanic:** classification choice (expense vs capitalize)

---

## The “Happy Path” user journey (the core loop)
1. User enters dashboard: **SURL open**, **Cash locked**
2. User opens SURL → Academy briefing → passes Gate question
3. Cockpit (split screen):
   - Left: invoice stack
   - Right: January check register (or GL view)
   - User passes first 3 distractors, flags the 4th trap as exception
4. User submits audit
5. Results modal:
   - “Audit complete. You found the unrecorded liability. Net income adjusted by -$4,500.”
6. SURL marked **Mastered** → Cash module unlocks

If a change does not strengthen steps 2–6, it’s probably not the next thing to build.

---

## Business goals (what “success” means)
- Immediate: validate “realism sells”
- Short term: reach **$2,000/month** via individual sales (lifetime deal / manager toolkit)
- Long term: enterprise licensing to regional firms lacking L&D
- Ultimate: acquisition by major training provider (Becker/Wiley/etc.) or a major firm

Product implication: prioritize features that make the sim feel **credible, tense, and teachable**, not features that make it feel like “another platform.”

---

## Codex working agreement (how to operate in this repo)
When you’re asked to implement something:

1. **Restate the user-visible outcome** in one sentence.
2. Identify where it fits (Academy / Workpaper / Reviewer / Partner).
3. Ship the **smallest vertical slice** that improves the core loop.
4. Prefer **existing repo patterns** over new frameworks.
5. Avoid large refactors unless they directly unblock the slice.

### Guardrails
- Don’t introduce features that delay feedback.
- Don’t “perfect” UI at the expense of trap realism.
- Don’t add complexity to make it “future-proof” unless today’s slice needs it.
- Don’t store or ship anything that looks like real client data (keep all content fictional).

### Quality bar (“Fully Baked” standard)
A feature is done when:
- The user can complete an end-to-end loop (brief → gate → sim → feedback → mastery impact).
- The trap is detectable via the heuristic (not guesswork).
- Feedback is specific, immediate, and teaches judgment.
- The module can be replayed without breaking state or logic.

---

## Product principles (defaults)
- **Realism over gamification** (but keep the dopamine: crisp success/fail feedback)
- **Detection over memorization**
- **Defective data is a feature**
- **Immediate feedback always**
- **Competency tracking > completion tracking**
- **Unlocks are earned** (mastery gates future modules)

---

## Reference mantra
“We do not build courses. We build experience.”