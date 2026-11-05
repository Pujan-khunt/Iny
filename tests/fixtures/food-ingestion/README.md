# Deliberate menu extraction evaluation

No representative sanitized menu corpus or evaluation credentials are included.
Deterministic PDF/extractor tests verify plumbing, not extraction accuracy.
Do not download historical announcements or query the production database for fixtures.

Supply a local JSON manifest with this shape. This example deliberately shows
only one meal/item; it is **partial and rejected** by the script:

```json
{
	"model": "explicit-configured-model",
	"cases": [
		{
			"id": "weekly-menu-1",
			"pdfPath": "/absolute/path/to/sanitized-menu.pdf",
			"expected": {
				"vendor": "tcb",
				"meals": [
					{
						"mealDate": "2026-11-01",
						"mealSlot": "breakfast",
						"items": ["Poha"]
					}
				]
			}
		}
	]
}
```

Each actual case requires all 21 unique date/slot pairs across seven consecutive
valid calendar dates, with breakfast, lunch, and dinner each day. Manually verify
vendor (`tcb`, `cheftalk_regular`, or `cheftalk_jain`), dates, slots, and nonblank
dish strings against the original PDF. Preserve raw spelling and item order.
Case IDs must be unique; all PDF paths must be absolute readable regular files,
start with `%PDF-`, and be at most 32 MiB. Unknown manifest/case fields are rejected.
The output must be a new file in an existing writable directory.
All cases and paths are validated before constructing a client or sending a request.

Only when sanitized representative inputs and separate evaluation credentials
have been deliberately supplied, run:

```bash
MENU_EVAL_API_KEY='<evaluation-key>' MENU_EVAL_BASE_URL='https://provider.example/v1' \
  npx tsx scripts/evaluate-menu-extraction.ts \
  --manifest /absolute/path/to/manifest.json --out /absolute/path/to/new-report.json
```

The script does not load `.env`, import database clients, or stage/commit menus.
It uses the same manifest model, SDK settings, prompt, JSON response format, and
provider sampling defaults at both 300 and 600 DPI, with no retries. Poppler
renders the complete first page under the existing byte, pixel, and time limits.
Multi-page PDFs are evaluated on the first page only; labels must describe it.

The report records corpus size, settings, each case/DPI, PNG dimensions/bytes,
render duration, model latency/failure, raw extracted menu, canonical menu, and
corrections. Raw mismatches compare manually verified labels exactly; canonical
mismatches normalize both labels and extraction using only approved aliases.
Item mismatch fields use `[date, slot, duplicateOccurrence, "items", itemIndex]`,
with zero-based occurrence and item indexes, so duplicate slots remain visible.
Review every vendor/date/slot/item discrepancy and failure before drawing conclusions.
Missing measurements are explicit null values with reasons, never estimates.
Peak renderer memory is explicitly unavailable: the bounded renderer runner
exposes no per-child peak RSS. Parent Node RSS is not substituted for it.
No wrapper is inserted between cancellation and the native Poppler command.
Failure details can include raw provider output; keep reports and inputs local.
Without a deliberate representative run, make no claim that 600 DPI improves accuracy.
