# Refdoc Visual QA Checklist

Template ID:
- `<templateId>`

Artifact Path:
- `./artifacts/refdoc-loop/<templateId>/`

Pages To Inspect:
- `1`

Task Goal:
- <What visual issue is being fixed?>

Acceptance Items:
- [ ] No clipped text in header/body/footer on inspected pages
- [ ] No overlapping text or boxes
- [ ] Numeric columns/totals align cleanly
- [ ] Critical labels/date fields are positioned correctly
- [ ] Pagination/page breaks are acceptable for this template
- [ ] No new regression visible in unchanged sections

Template-Specific Checks:
- [ ] <e.g., check MICR line remains visible>
- [ ] <e.g., invoice line-item totals fit without wrapping>

Final Verification:
- [ ] Final regenerate performed after last code change
- [ ] Latest artifacts inspected (not a prior run)
