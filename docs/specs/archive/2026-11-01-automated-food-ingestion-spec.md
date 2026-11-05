# Conservative Automatic Food Announcement Ingestion

Date: 2026-11-01

Status: APPROVED by the user on 2026-11-01

## 1. Outcome and scope

Automatically ingest newly arriving food announcements from the configured
official WhatsApp group without operator confirmation. Prefer rejecting a valid
message over writing uncertain facts to operational meal data.

Only two business message types are supported:

1. Complete seven-day vendor menus supplied as images or PDFs.
2. Text operational announcements concerning meal locations, service timings,
   dish changes, or whole-meal menu substitutions.

The second type may contain several supported events. If any relevant portion
cannot be interpreted unambiguously, reject the entire message. Never commit
only its clear portions.

This specification defines requirements and observable contracts only. Module
boundaries, TypeScript interfaces, and implementation plans follow explicit
approval of this artifact, in accordance with `AGENTS.md`.

## 2. Agreed requirements and proposed defaults

The following requirements were agreed during brainstorming:

- Support only complete seven-day menus, not daily or partial menus.
- Process operational announcements as text only, without reading them from
  images or PDFs.
- Reject the whole message when any relevant detail is ambiguous.
- Reject operational announcements with no stated date reference.
- Automate newly arriving messages only, excluding existing pending messages.
- Use evidence-backed extraction and strict validation rather than accepting a
  model's confidence score as sufficient authorization to ingest.
- Increase the PDF rasterization default above the current 300 DPI.
- Correct known vendor spelling errors, including `Frycrums` to `Fryums`.

The following are concrete proposals submitted for review with this draft:

- Use 600 DPI as the new PDF default, subject to representative-menu evaluation.
- Initially permit only explicitly approved spelling aliases. Do not perform
  unrestricted model-driven dish renaming or fuzzy nearest-name matching.
- Interpret text-only operational announcements as standalone text messages;
  attachment captions may explain menus but do not independently authorize
  operational updates in this release.
- Preserve rejected inputs and their reasons for inspection without automatic
  semantic reconsideration or partial ingestion.

Approval of this specification approves these proposals as well as the agreed
requirements. A request to amend them keeps the specification at this stage.

## 3. Newly arriving messages and replay protection

- The input must originate from the configured food announcement group and must
  not be authored by the bot. Do not expand the accepted sender or group scope.
- Historical `append` events and existing staged records are ineligible for
  automatic ingestion. Existing capture and manual inspection capabilities may
  retain them without causing automatic operational writes.
- Define a persistent activation boundary when automation is first enabled.
  Only messages created at or after that boundary and delivered through the
  live `notify` path are eligible. Restarting must not move that boundary.
- Missing or invalid original message timestamps make an input ineligible.
- Redelivery, reconnect, restart, and concurrent handling of the same WhatsApp
  message ID must not duplicate operational effects or change a final decision.
- A record staged before automation was enabled must not become eligible merely
  because it is redelivered after activation.
- Previously rejected messages must not be automatically reopened by a later
  deployment, spelling-list change, or redelivery.
- Recovery of unfinished work admitted by this automation is permitted; scanning
  the pre-existing staging backlog to discover new work is not.
- Do not send acknowledgements or failure messages to the announcement group.

## 4. Classification and whole-message acceptance

- Outcomes must distinguish supported weekly menu, supported operational
  announcement, unsupported content, ambiguous content, and processing failure.
- Text mentioning food is not sufficient evidence of an operational update.
  Questions, suggestions, hypothetical arrangements, and requests to change a
  meal must not be interpreted as confirmed arrangements.
- Recognition and extraction must permit explicit abstention. No fallback may
  force a message into one of the two supported business types.
- A well-formed JSON response, valid schema, or high confidence score does not
  establish semantic correctness on its own.
- Every extracted operational fact must be traceable to the source message.
  Date conversion, documented vendor aliases, and approved dish spelling
  corrections are permitted transformations; invented facts are not.
- Harmless greetings, emoji, and sign-offs do not make a message unsupported.
  An additional unsupported or ambiguous meal instruction does reject it.
- Text or attachment instructions directed at the extractor must never override
  the ingestion rules.
- Extraction disagreement, contradictory dates, unclear vendor scope,
  unreadable required content, or missing required fields rejects the whole
  message. Never supply an implicit lunch slot or current-day fallback.
- Deterministic validation must enforce the business invariants below before any
  operational write. Model-reported evidence is not independently conclusive.

## 5. Complete weekly menus

- Supported vendors remain `cheftalk_regular`, `cheftalk_jain`, and `tcb`, using
  the existing explicit source-name aliases. No new vendor is introduced.
- User-confirmed alias during execution: unqualified `Cheftalk` means
  `cheftalk_regular`; an explicit Jain qualification means `cheftalk_jain`.
  Do not erase an explicit Jain label by quoting only the generic brand.
- The vendor and full calendar date range must be unambiguous in the source.
  Do not assign dates merely from the date the message arrived.
- A menu must contain seven consecutive valid calendar dates and exactly one
  breakfast, lunch, and dinner per date: 21 unique date-and-slot combinations.
- Counting 21 extracted entries alone is insufficient. Duplicate slots, gaps,
  invalid calendar dates, and ranges that disagree with the source reject it.
- Each supported meal must contain a nonempty list of readable dish names.
  Never fill missing cells by repeating adjacent meals or inventing dishes.
- Snacks are outside the operational meal slots and are not ingested. A clearly
  separate snacks row does not invalidate an otherwise complete weekly menu.
- Accept only a complete, unambiguous supported menu from a message. Multiple
  vendor menus or competing date ranges in one input reject it in this release.
- Do not silently ignore relevant PDF pages. A menu requiring additional pages
  or containing additional operational instructions must be fully assessed or
  rejected; a complete-looking first page alone cannot authorize ingestion.
- Conflicting menu captions, dates, and attachment contents reject the message.
- Image menus must satisfy the same acceptance rules as PDF menus.

## 6. Text operational announcements

### Dates and scope

- Require an explicit calendar date or a stated relative reference such as
  today, tomorrow, or yesterday. Resolve relative dates against the original
  WhatsApp creation timestamp in `Asia/Kolkata`, never processing time.
- Support day/month/year notation, including `1/11/26` meaning 2026-11-01.
  Two-digit years in this release denote years 2000 through 2099.
- Common unambiguous relative-date spellings such as `Tommorow` are acceptable.
- When a message contains both a relative reference and a calendar date, they
  must resolve to the same date; otherwise reject the whole message.
- Ambiguous weekdays or dates that omit necessary calendar context reject it.
- Every event must identify its meal slot and applicable date without guessing.
  A clearly shared date or meal reference may apply to several clauses.

### Supported events

- Location updates must clearly identify hostel/college allocation and the
  affected batches or an explicit all-batches scope. Conflicting allocations
  reject the message. Preserve the existing batch vocabulary.
- Timing updates include changed starts, ends, delays, and service windows.
  Preserve whether a time describes a start, an end, or a window; do not invent
  the other endpoint. Ambiguous AM/PM or scope rejects the message.
- Dish changes include explicit additions, replacements, and cancellations.
  A replacement must identify both the old and new dish; other changes must
  identify the affected dish and operation.
- Vendor-specific dish changes must identify their vendor. Shared location and
  general service announcements need not invent a vendor; unclear targeted
  vendor scope must never be expanded to all vendors.
- Whole-meal substitutions must identify source and target dates and slots.
  Both referenced meals must already exist for every applicable vendor before
  acceptance. Missing prerequisites reject the entire message, including any
  otherwise clear location or timing clauses. Do not auto-defer it for a future
  weekly menu and later silently ingest it.
- Empty extracted announcements are not successful ingestion.
- Unsupported operations, including a whole service cancellation that cannot
  be represented as an existing dish change, reject the entire message.

## 7. PDF rasterization quality

- Increase the shared PDF rasterization default from 300 to a proposed 600 DPI.
  Callers that deliberately specify a DPI retain their explicit override.
- Apply the shared default consistently to automated menu extraction and the
  existing manual menu extraction flow.
- This affects PDF rendering. Do not describe it as increasing the detail of
  an already supplied image or correcting misspellings printed in the source.
- For a fixed page size, 600 DPI produces twice the width and height of 300 DPI,
  or approximately four times the pixels. Evaluate memory, request size, and
  render time alongside extraction accuracy.
- Before claiming a quality improvement, compare 300 and 600 DPI on the same
  representative menus using manually verified expected dates, slots, and dish
  lists. Confirm that the actual model request accepts the rendered input.
- A rendering or request-size failure must not cause cropping, silently reduced
  completeness, or a guessed extraction to be committed.
- Higher DPI does not relax any acceptance gate or guarantee correct extraction.

## 8. Approved spelling corrections

- Initially approve the alias `Frycrums` to canonical `Fryums`.
- Matching is case-insensitive and applies to whole words, so `Frycrums/Papad`
  may become `Fryums/Papad`, while a longer unrelated word is untouched.
- Preserve surrounding dish words, punctuation, quantities, and meal placement.
  Do not replace a whole dish containing the typo with just `Fryums`.
- Apply the approved normalization consistently to extracted weekly-menu dish
  items in both automatic and manual extraction paths.
- Preserve the source spelling and corrected value in the ingestion audit.
  The raw WhatsApp content and media remain unchanged.
- Additional aliases require an explicit reviewed correction-list change.
- Names outside the approved list remain as extracted when clearly readable;
  unfamiliar cuisine or transliteration alone is not a reason to rename them.
- If the actual dish identity cannot be read unambiguously, reject the entire
  message. A correction rule must not conceal uncertainty about the source.
- Do not automatically rewrite existing operational rows or historical staged
  messages when this correction is introduced.

## 9. Persistence and outcome contracts

For each automatically considered message, retain its source ID, original
timestamp and content, recognized type when available, final outcome, and a
machine-readable reason plus useful human-readable detail. Accepted inputs also
retain extracted facts, applied corrections, and operational provenance.

Observable outcomes are:

| Outcome    | Operational effect                                             |
| ---------- | -------------------------------------------------------------- |
| Ineligible | No automatic extraction or operational write                   |
| Accepted   | All validated events and completion recorded atomically        |
| Rejected   | No operational write; preserve the rejection reason            |
| Failed     | No partial operational effect; preserve the processing failure |
| Duplicate  | No additional operational effect or decision change            |

- Operational writes and successful completion must be one atomic transaction.
- Concurrency protection must cover committing, not just initial staging.
- A database or external-service failure is not evidence of unsupported content.
  Record it separately from a semantic rejection and continue other messages.
- Semantic rejection must not trigger repeated model attempts to obtain a more
  permissive answer. Recovery of a processing failure must preserve the same
  source timestamp, eligibility, and validation rules.
- Later delivery of an older source must not overwrite a newer accepted update
  to the same operational fact. Conflicting order that cannot be resolved
  safely must produce no operational write.
- Existing provenance and surgical manual rollback capabilities remain
  available. This feature does not trigger automatic rollback or re-ingestion.

## 10. Acceptance examples and validation

The implementation must demonstrate at least these cases:

1. A readable seven-day menu with 21 unique slots, vendor, and dates is accepted.
2. Twenty-one entries containing duplicate slots and a missing day are rejected.
3. Daily menus, unknown vendors, undated menus, and unreadable cells are rejected.
4. A menu containing `Frycrums` stores `Fryums` with both spellings audited.
5. Correction preserves surrounding words and does not affect unrelated names.
6. A clearly readable unfamiliar dish retains its source name.
7. `Tommorow (1/11/26), lunch will be arranged in the hostel for all batches`
   sent on 2026-10-31 IST is accepted as a location update for 2026-11-01 lunch.
8. The same text sent on 2026-11-01 IST is rejected because its dates conflict.
9. `Lunch will be arranged in the hostel for all batches` is rejected as undated.
10. A clear location update combined with an ambiguous meal change is rejected
    with zero writes, as is a swap with a missing source or target meal.
11. Operational announcements supplied only in media are not ingested.
12. Existing pending messages, historical append events, and pre-activation
    messages delivered as notify events are ineligible for automation.
13. Duplicate and concurrent deliveries produce at most one operational effect.
14. A restart does not reprocess accepted/rejected messages or admit old backlog.
15. A failed commit leaves no partial rows or successful completion marker.
16. Delayed processing resolves relative dates from original IST message time.
17. The default PDF render uses 600 DPI; explicit DPI overrides still work.
18. A representative-menu comparison records extraction accuracy and resource
    impact before any claim that 600 DPI improves extraction reliability.

## 11. Exclusions

No historical backfill, scheduled backlog sweep, daily-menu support, unrestricted
spelling correction, operational-media OCR, new vendor, new meal slot, WhatsApp
reply flow, automatic spec archival, commit, deployment, or merge is authorized
by this specification. Implementation must follow the separately approved design
and worktree/TDD workflow.

## 12. Supporting evidence

- Current `PdfRasterizer.ts` explicitly supplies 300 DPI to `pdftoppm`; it does
  not use the tool's own default. Its current flow renders only the first page.
- Current menu schema checks entry count but does not establish seven-day
  coverage or uniqueness. Current text extraction contains date and meal-slot
  fallbacks that cannot authorize conservative automatic ingestion.
- The Poppler manual defines `-r` as both X and Y resolution in DPI, and
  `-singlefile` as first-page-only output:
  [pdftoppm manual](https://manpages.debian.org/unstable/poppler-utils/pdftoppm.1.en.html).
  It does not establish an optimal DPI for this project's model or menu inputs.
