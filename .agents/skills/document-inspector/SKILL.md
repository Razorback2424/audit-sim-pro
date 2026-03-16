---
name: document-inspector
description: >
  Deterministic visual QA and iteration loop for generated client documents (PDF reference docs/invoices) in AuditSim Pro. Use when refining PDF templates or document generation output and you need a repeatable path: generate debug docs for specific template IDs, capture PDF/page artifacts, inspect against a checklist, patch template/render code, and repeat until all items pass.
---

# Reference Document Visual QA Loop (Deterministic)

Do not guess whether generated client documents look correct. Generate a deterministic debug document for a template, capture stable artifacts (PDF + page images), inspect against an explicit checklist, patch the template/renderer, and repeat.

This repo already supports debug refdoc generation:
- Callable: `generateDebugRefdoc` in `functions/src/cases/index.js`
- Admin UI surface: `src/pages/AdminDebugDocsPage.jsx`

## Use This Skill For

- Invoice/reference document template layout tuning
- Text overflow/clipping/overlap fixes
- Column alignment, totals formatting, pagination problems
- Template-specific regressions (e.g. check copy, AP aging, bank statement)

## Do Not Use This Skill For

- General app UI work (use the UI screenshot loop)
- Non-visual backend logic changes
- Broad template redesigns during ship stabilization

## Required Files (create if missing)

- `progress.md` in the repo root: running log for the loop
- A task checklist file copied from `references/success_checklist_template.md`
- Optional helper scripts (recommended):
  - `scripts/refdoc_debug_generate.<js|mjs>`: one-command debug generation for one template ID
  - `scripts/refdoc_capture_pages.<sh|js>`: fetch PDF + export page screenshots/text artifacts

If helper scripts do not exist, use the Admin Debug Docs page (`src/pages/AdminDebugDocsPage.jsx`) and manual artifact capture, but keep the workflow deterministic.

## Canonical Template Sources

- Template renderers: `functions/pdfTemplates.js`
- Debug data builder + callable: `functions/src/cases/index.js`
- Debug template list (seed set): `src/pages/AdminDebugDocsPage.jsx`
- Default template IDs: `references/template_ids.md`

## Preconditions

1. Pick one template ID at a time.
- Example: `invoice.seed.alpha.v1` or `refdoc.bank-statement.v1`
- Do not batch-edit unrelated templates in one loop.

2. Ensure deterministic generation path.
- Preferred: call `generateDebugRefdoc` using repo debug data.
- Fallback: generate a case and inspect `referenceDocuments` only if debug callable is unavailable.

3. Ensure stable artifacts per iteration.
- Required outputs (or equivalents):
  - `./artifacts/refdoc-loop/<templateId>/latest.pdf`
  - `./artifacts/refdoc-loop/<templateId>/page-1.png` (and additional pages as needed)
  - `./artifacts/refdoc-loop/<templateId>/latest.json` (metadata: templateId, source, timestamp, pageCount)

4. Ensure mandatory visual inspection.
- Inspect the latest page images after every iteration.
- For multi-page docs, inspect every page that changed or is likely impacted.

5. Ensure progress logging.
- If `./progress.md` is missing, create it with first line:
  - `Original prompt: <user prompt>`
- Append one short update per loop with template ID and result.

## Loop

1. Read `progress.md` and restate target template + done criteria.
2. Generate the debug refdoc for the target template.
3. Capture page artifacts (PNGs, and text extract if available).
4. Inspect every checklist item explicitly.
5. Patch the smallest template/renderer change (usually `functions/pdfTemplates.js`).
6. Repeat generate -> capture -> inspect until all items pass.
7. Final regenerate and re-check all items.
8. If shared CSS/helpers changed, spot-check one neighboring template using the same renderer family.

## Guardrails

- Never claim success without inspecting the latest artifact.
- Fix one visual defect class at a time (overflow, alignment, pagination, formatting).
- Avoid business-logic changes during visual tuning unless the bug is clearly data formatting.
- Preserve security/storage behavior; this skill is for render quality only.
- Keep a deferred list for non-blocking polish per template.

## Minimum Visual Checklist

- No clipped text (headers, payee, totals, footer notes)
- No overlapping elements
- Numeric columns align consistently
- Totals rows are readable and aligned
- Page breaks do not split critical row groups incorrectly
- Labels/dates render in intended positions
- Font fallback does not cause catastrophic layout shift

## Checklist Usage

Copy `references/success_checklist_template.md` into a task-local checklist and fill:
- `Template ID`
- `Artifact path`
- `Pages to inspect`
- Task-specific acceptance items

## Prompt Wrapper

`Use document-inspector. Target template: <templateId>. Generate a deterministic debug refdoc each iteration, save artifacts under ./artifacts/refdoc-loop/<templateId>/, inspect page images against this checklist: <items>. Patch the smallest template/renderer change and repeat until every checklist item passes.`
