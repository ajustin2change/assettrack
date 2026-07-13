# AssetTrack & DisposalRequest — Project Handoff

## Purpose of This Document

This is the working handoff for the AssetTrack ecosystem: a set of web applications for managing IT asset disposal (ITAD) at the University of Oklahoma. It captures **what the system does today**, **the findings from the audit/hardening review**, and — most importantly — **the target architecture the project is moving toward** (integration with TDX, the org's ITIL helpdesk system).

> **Read this first:** The current build is a deliberately primitive prototype (single-file HTML + Firebase) used to prove out the workflow. It works and is in real use. The **end-state is different**: a TDX-integrated system whose backend database is not yet chosen. Everything in this document should be read with that trajectory in mind. The prototype's job is to be *correct about the workflow* and *easy to re-platform*, not to be the final architecture.

---

## Status — Current State (fast path)

> This is the "where things stand" summary. Detailed findings below are updated in place (✅ = done). When this conflicts with an older section, this wins.

> **⚠ TRUST THE CODE, NOT THIS DOC.** The project's copies of `AssetTrack.html` / `handoff.md` lag the deployed build — repeatedly, within a single working session. Before acting on ANY backlog claim here (especially "not done / untouched"), `grep` the current file to confirm. This doc has already been wrong about completed work (see reconciliation, below), which caused real mis-planning. Re-derive edits against live bytes, never remembered line numbers.

**Completed in the durability/security session (all verified live against Firestore, not just compiled):**

- ✅ **Silent write failures surfaced.** `fbSet`/`fbDelete` are gone; all writes go through the `repo` layer and report errors via `reportWriteError` → a persistent, dismissable red banner (`writeError` state). Failed/denied/oversized writes are now loud. (Closes §8 [MUST].)
- ✅ **Diff-and-delete footgun eliminated.** The four `save*` wrappers are now **upsert-only** — they never infer deletion from absence. Deletion is explicit via four `remove*` functions wired to the four delete sites (`onDelete*` props). (Closes §8 [SHOULD].)
- ✅ **Side-effects-in-updater fixed.** Persistence runs *outside* the React updater, using four `*Ref` refs (`ticketsRef`…) as the "previous" snapshot. (Closes §8 [SHOULD].)
- ✅ **Data-access abstraction layer (the swap seam, §2.4).** One global `repo` object is now the only Firestore-aware code: `subscribe*/get*/save*/delete*` for all four collections. Re-platform = reimplement `repo`, nothing else.
- ✅ **Ref-desync in session-load paths closed.** `hydrateAll()` sets state + refs together; `handleFSAOpen`, `handleFSANew`, the legacy-load branch, and `pushToFirestore` route through it. `runFolderImport` confirmed **dead code** (defined, never called).
- ✅ **Public-read exposure CLOSED.** Firestore was world-readable (`allow read: if true`) with the config public in the HTML — anyone could read every serial, location, and requestor PII without signing in. Fixed: read now requires `request.auth != null`, and the `allow create: if true` injection hole was removed (§4). App change shipped with it: the subscribe effect is now **gated on `user`** (was unconditional on mount) so it subscribes only after sign-in and clears data on sign-out. Verified via Rules Playground (anon `get` denied, auth `get` allowed) + signed-in load.
- ✅ **1 MiB reconcile risk** now fails **loud** (write-error banner), and largest real audits confirmed **< 200 KB** — well under the cap. Sub-collection move downgraded to [NICE].
- ✅ **Pickup-scan waive reworked (line-level).** Waive is keyed by expected-line INDEX, not serial, so duplicate serials waive independently (previously waiving one waived both). Added a ⊘ Waive control on Missing rows in the post-scan results view (waive an item you forgot to waive before scanning — e.g. an untracked printer/monitor — without losing results). **Persistence format changed:** `pickupResult` now stores `waivedLines` (line indices, authoritative for the scan page) AND a derived `waived` serial list (a serial is waived for reconcile only if ALL its lines are waived) — the Reconcile consumer still reads `waived` serials unchanged. Result-row ids are now deterministic (`exp:{idx}` / `ext:{serial}`) so links/partial-resolutions survive an in-place recompute. Legacy tickets (serials only) convert on load.
- ✅ **Embedded-serial matching in the pickup scan (Phases 1–2b).** People put extra text in the serial field (`R3XS684047X | IMEI: 359522021141397`), or the scan captures a bare identifier while the ticket has serial+model (Lenovo). The scan matcher now extracts identifiers from BOTH sides (`extractIdentifiers`) and matches on the isolated identifier (`bestMatch`). Tiers: shared exact token **≥8 chars → auto-accepted** correction; **exactly 7** (e.g. a Dell tag inside a string) → **exact but review**; **≤6 ignored** (coincidence guard); **fuzzy** 1–2 edits on tokens ≥6, distance 2 only when both ≥10 (IMEI-scale) → **review**. Nothing applies silently — correction rows show the stripped part dimmed/struck and the matched token highlighted, with Accept/Reject; exacts pre-accepted. Canonical serial = bare identifier (exact) or scanned value (fuzzy). Logic is unit-tested in **`matcher_tests.js`** (in the repo since the matcher-refinement session; SELF-EXTRACTING — it reads the matcher out of `index.html` at run time, so it can never test stale code). NOTE: the tiers were extended in the matcher-refinement session (containment tier; fuzzy canonical = scan-side token; see the completed block above). Old whole-string `findPartialMatch` is now unused (subsumed) but still defined.

**Completed in the chain-of-custody session (BUILD 1 — deployed and smoke-tested live; 11-step checklist passed incl. no-spurious-events-on-reload):**

- ✅ **`custodyEvents` collection + append-only repo methods** (`subscribeCustodyEvents`/`getCustodyEvents`/`saveCustodyEvent`; deliberately NO update/delete). `saveCustodyEvent` does NOT reuse `repoSet`: the server-side `recordedAt` FieldValue must attach AFTER the JSON-cleaning pass or stringify destroys it.
- ✅ **Event schema v1 frozen:** `{id, v:1, type, ticketIds[], shipmentId|null, provenance("scanned"|"expected"|null — pickup events only), serials[], recorderEmail, attester{name,email}|null (expected-provenance only; denormalized snapshot, name-matched from requestors, empty email never blocks), witness|null (reserved), vendorRef|null, occurredAt (ISO; date-only for arrivals), recordedAt (server), note}`. **Types:** ticket-created, pickup-scanned, pickup-attested, grouped-into-shipment, ungrouped-from-shipment, vendor-handoff, warehouse-arrival, reconciled; `codd-attached` LIVE as of build 2 (see the CoDD session block). **No backfill — log starts at go-live.**
- ✅ **Emission = Option A, wrapper transition detection.** `detectTicketCustody`/`detectShipmentCustody` run inside `saveTickets`/`saveShipments` — every interactive write path flows through those two wrappers, including the two paths per-site emission would have missed (VendorPickupForm's status `<select>`; ReconcilePickup's status write). Bulk paths (subscribe echo, `hydrateAll`, legacy load, `pushToFirestore`) bypass the wrappers by design → session load/sync can never fabricate events (smoke-verified). A scheduled→reconciled jump emits BOTH vendor-handoff (noted "Inferred") and reconciled. Detectors ride on the meaning of `pickupScanned`/`directVendorPickup`/`status`/`ticketIds`/`arrivedDate` — revisit them if those semantics ever change.
- ✅ **Explicit emissions outside the wrappers:** `ungrouped-from-shipment` inside `removeShipment` (deletes bypass `saveShipments`); `warehouse-arrival` via a **Log Arrival** button (prompts receipt-email date + optional PO) or the form's new Arrival Date field — mechanically still wrapper-detected via the `arrivedDate` transition; `occurredAt` = the entered date, and the occurredAt/recordedAt gap for arrivals is by design (honest after-the-fact recording). Changing an existing arrival date emits a correction event; nothing is ever edited.
- ✅ **Shipment record gains `vendorPO` + `arrivedDate`** (form fields + 🏭 card chip). Shipment-level events snapshot `vendorRef = vendorPO || auditPo` — the **PO # is the vendor's handle** for a pickup (their paperwork doesn't always carry our number); the shipment `name` is OUR reference (format `VendorID-PickupDate-SequenceID`, vendor IDs 01–04, given to the vendor at scheduling). Without the PO captured, a batch CoDD referencing only a PO would be an orphaned certificate — this closes that.
- ✅ **No rules deploy needed:** the `match /{document=**}` wildcard already covers `custodyEvents` (auth read / owner write). Immutability rules remain deferred per the kickoff lean (rules-only tightening; can ship independently later, app-first ordering not required since it's rules-only). **UPDATE: SHIPPED in the immutability-rules session** — the wildcard is gone and `custodyEvents` is rules-enforced create-only; see that session block.

**Completed in the matcher-refinement session (deployed + confirmed on live data step-by-step; custody log untouched by all of it):**

- ✅ **Raw capture visible on correction rows.** Whenever the raw scan differs from the canonical, the scan view shows a "captured:" line with junk struck-through and the matched token highlighted — the mirror case (clean ticket serial, dirty scan e.g. HP/Lenovo compound barcodes) was previously invisible. Same treatment on fuzzy rows.
- ✅ **No-op correction rule** (`isNoopCorrection` + `actionableCorrections`, defined beside the matcher): an ACCEPTED exact or exact-review match whose canonical equals the ticket serial VERBATIM (case-insensitive) is approval-exempt — excluded from `needsApproval` routing, derived pickup status, the awaiting-approval panel, approval email counts, the approval XLSX, and BOTH approval PDFs. A scan whose only discrepancies are no-ops closes clean with no customer round-trip. Untouched by design: `buildFinalAssets` (the record), `pickupScanList` (raw truth), JSON-export counts, and all scan-view UI. Fuzzy is never no-op; rejected rows are never no-op.
- ✅ **Truthful correction direction on every customer-facing surface:** the green/target value is `canonical` (what WILL be recorded); both PDFs' "Serial # Scanned" column is renamed **"Will Record As"** with `(captured: raw)` appended when they differ; the XLSX details carry "Will record as:"; distance renders only when > 0.
- ✅ **Containment matcher tier:** one side's token appearing as an exact substring of a STRICTLY LONGER token on the other side (undelimited compound barcodes — Lenovo `1S`+MTM+serial scans as one solid token). Contained token must be ≥8 chars (EXACT_AUTO_LEN); works both directions; lands as `exact-review` — NEVER auto-accepted; loses to the exact tier. canonical = the contained token. Delimited compounds still auto-accept as before.
- ✅ **Fuzzy canonical = the matched scan-side TOKEN** (`fuzzy.scTok`), no longer the whole raw scan — a fuzzy hit inside a compound capture records the serial, not the barcode dump. Design rule adopted: *the scanner is the verifiable truth, stripped to the identifier; raw captures are preserved in `pickupScanList`, never in the serial field.*
- ✅ **`validatedAt` stamped** on Mark Validated and on direct-pickup validation (same format as `approvalSentAt`), closing the untimestamped-approval gap.
- ✅ **`matcher_tests.js` exists in the repo** (self-extracting: reads the matcher + no-op rule out of `index.html`, so it can never test stale code). **REQUIRED gate: `node matcher_tests.js index.html` after ANY edit to the matcher or the no-op rule.** 17 cases pin every tier boundary.

**Completed in the CoDD session (custody BUILD 2 — deployed and smoke-tested live; 11-step checklist passed 100%):**

- ✅ **`codd-attached` is LIVE** (was reserved in schema v1). Batch Certificate of Data Destruction recorded at shipment level as ONE nested `codd` object: `{certPO (REQUIRED — the join key as printed on the cert), destructionDate (REQUIRED, YYYY-MM-DD), certNo?, signedBy?, fileName?, fileUrl?, attachedAt, note}`. **The PDF is NEVER stored** — filename captured via a picker that reads nothing; `fileUrl` is a pointer reserved for the future SharePoint/records home (pasting a link later emits a correction event automatically). CoDD↔pickup is 1:1 by vendor practice (single object, NOT an array — settled, do not retrofit); replacement = append-only correction events, never edits.
- ✅ **Real-cert grounding:** Vantage Point's CoDD prints NO certificate number — "For: University of Oklahoma P.O. NNNN" is the document's sole identity, confirming the PO as the join key. Its "Date of destruction" drives the event's `occurredAt` (after-the-fact convention, same as arrivals); the cert delegates serial detail to the attached audit — cert + audit ship together as one package, which drove the attach placement.
- ✅ **Attach point = the Reconcile view, step 1 ABOVE the audit upload** (real flow: CoDD first, then audit, then run). The cert PO seeds the audit PO field; `normPO` compares alphanumeric cores ("P.O. 2737" == "PO#2737" == "2737"); a mismatch vs the pickup's vendor reference requires confirmation and is recorded in codd.note → the event note; an EMPTY vendor reference is backfilled from the cert. A missing CoDD is a loud amber notice at attach time AND on the generated report — never a block (exceptions are tracked, not gates). Vendor Pickup card gains a 📜 chip.
- ✅ **Emission stays pure Option A:** the panel writes `pickup.codd` through the `setShipments` prop (= the `saveShipments` wrapper) → `detectShipmentCustody` emits. NO new emission sites, NO repo changes, append-only preserved. Unchanged resaves are silent (JSON compare of the codd object); bulk paths still bypass the wrappers.
- ✅ **Re-reconcile detection (ridealong, same detector hunk):** `reconcileReport.generatedAt` changing while status is already `reconciled` emits `reconciled` — "Re-reconciled - audit file replaced" when a prior report existed, "Reconciliation run on already-reconciled pickup" for the manually-advanced-then-run path. Waive/unwaive rewrites keep the same generatedAt → silent (smoke-verified).
- ✅ **`detector_smoke.js` added to the repo** (self-extracting like `matcher_tests.js` — evals `emitCustody`/`shipVendorRef`/`detectShipmentCustody` out of `index.html` at run time, so it can never test stale code). 9 transition scenarios pinned (attach / silent resave / replace / fileUrl-later / re-reconcile / manual-advance / single-emit on normal reconcile / silent waive rewrite / new-doc attach). **REQUIRED gate: `node detector_smoke.js index.html` after ANY edit to `emitCustody` or the `detect*` functions.**
- ✅ **handleFile PO fix (ridealong):** a filename with no extractable PO no longer clobbers the CoDD-seeded/typed PO with ""; audit-PO-vs-cert-PO disagreement surfaces an amber warning before the run.
- **Delivery artifacts:** `apply_codd_build2.py` (9 hunks, exact-match assertions, reproducible from the 345,235-byte base), `codd_build2_notes.md`, deployed `index.html` = **357,037 bytes** (md5 f55c71a5f9cc29e28a9bc62eff75ce32).

**Completed in the timeline session (custody BUILDS 3 + 3.1 — deployed and smoke-tested live; BUILD 4 deployed and smoke-tested live — ALL FOUR BUILDS SHIPPED):**

- ✅ **Custody timeline view (BUILD 3).** First READER of `custodyEvents`: `repo.subscribeCustodyEvents` wired into the user-gated subscribe effect (clears on sign-out). **Design rule locked: the log is display-only in the app** — `custodyEvents` NEVER enters the session JSON, `hydrateAll`, or `pushToFirestore` paths (export stays `version:5`), so no load/import can ever write events back; appends still go only through the emission layer. Reusable `CustodyTimeline` + `CustodyModal`; `recordedAt` handled as Firestore Timestamp / `{seconds}` / ISO; sorted by `occurredAt` (string compare — date-only sorts before same-day timestamps, chronologically correct) with `recordedAt` tie-break; the "recorded …" second date shows only when the recorded LOCAL day differs from the occurred day (the honest after-the-fact gap: arrivals, CoDDs); unknown event types render via a fallback meta (forward-compatible); pre-go-live tickets get a clean "log starts at go-live" empty state.
- ✅ **Three entrances, one component:** 📋 **History** on every ticket row (modal; events where `ticketIds` contains the ticket — shipment-level events appear in the ticket's story, end to end), a **fold-out** inside the ticket editor (hidden on New), and 📋 **Log** on every vendor-pickup card (modal; `shipmentId` match — the pickup's own story).
- ✅ **3.1 polish (deployed):** ONE header context row per timeline — PO chip + "N serials in custody ▾" expander, both from the LATEST event carrying them (= current custody snapshot). Per-event chips render only on DEVIATION: a PO different from the header's, or a serial snapshot whose CONTENT differs from the header list (join-compare, not count-compare). Identical rows go quiet; deviations (ticket added between handoff and arrival, pre-PO events, a ticket's own scan vs the shipment aggregate) stay loud. Verified by SSR fixture tests — real React `renderToStaticMarkup` of the SHIPPED component, 9/9.
- ✅ **Data fact recorded (asked and answered):** shipment-event `serials` = OUR aggregate. `shipmentSerials()` concatenates `custodySerials()` per member ticket: post-scan `assets` for scanned tickets (canonical serials incl. extras that left), vendor-direct `assets` (copied from expected at attestation by `saveDirectPickup`) for direct pickups, `expectedAssets` for unscanned. NEVER the vendor's audit list (`reconcileReport.vendorSerials`). Snapshot at emission time; later ticket edits do not rewrite old events — append-only semantics working as intended.
- ✅ **BUILD 4 SHIPPED — governance manifest STUB (last Phase-5 item; live-smoked, 6-step checklist passed).** New `config/app` Firestore doc through the repo seam (`getConfig`/`saveConfig` — the wildcard rule covers it, no rules deploy); **Governance Manifest** card in Settings → Data Management holds the destination email (`appConfig.governanceEmail`); ✉ **Manifest** button on pickup cards generates a serial-level custody-manifest PDF (jsPDF/autoTable — per-ticket serial tables labeled with provenance scanned/attested/expected, header with pickup/vendor/location/date/PO, totals footer) and opens a pre-filled mailto to the configured address. The PDF is attached MANUALLY — mailto cannot attach; automated send is exactly what the backend tier adds. Unconfigured destination → prompt-and-save path. **NO custody event is emitted — deliberate:** the app cannot verify a manual send, and the log records only verified facts; the sent-event ships with the backend's automated send. Serials to GOVERNANCE are fine — blind-audit protects the manifest from VENDORS, and governance is the internal neutral party the anchor exists for. Verified by executing the shipped generator under real jsPDF+autotable in node: 10/10 incl. serial-source rules and both config paths.

**Completed in the immutability-rules session (RULES-ONLY — zero app bytes changed; deployed `index.html` remains 376,167 bytes / md5 b6df106bcb2302e1f824d85653078cf5; no test gates triggered):**

- ✅ **Wildcard rule replaced with explicit per-collection enumeration.** Firestore rules are permissive-OR (any matching allow grants access), so a stricter `custodyEvents` block beside the old `match /{document=**}` write rule would have done nothing. The wildcard is GONE for both read and write; the six known collections (`tickets`, `shipments`, `locations`, `requestors`, `custodyEvents`, `config`) are enumerated. **Any future collection fails LOUD** (write-error banner on writes, empty reads) until the rules name it — deliberate, the right failure mode.
- ✅ **`custodyEvents` is now rules-enforced append-only:** `allow create` only (owner), pinned with `request.resource.data.recordedAt == request.time`. The app already sends `FieldValue.serverTimestamp()` on every event (repo layer, verified in live bytes), so the pin blocks forged-timestamp writes without touching the app. NO update/delete rules exist = denied for every client, INCLUDING the owner account. **Honest limit for audit conversations:** rules bind client-SDK traffic only — the Firebase console / Admin SDK is NOT bound. Accurate claim: "no application or client can alter the custody log, including the owner account." Hard immutability still lands at the SQL backend (this is the planned middle tier).
- ✅ **`config` is create/update only** (never deletable). The four main collections keep full owner write (create/update/delete) — same behavior as before, now stated explicitly per collection.
- ✅ **One seam for future access control:** reader and writer are each defined ONCE as rules functions — `signedIn()` and `isOwner()` (the latter with an `email_verified` guard). The eventual campus-ID/SSO gate (via the TDX backend) or an interim email allowlist changes `signedIn()` only; every collection inherits.
- ✅ **Verified in two stages.** Rules Playground pre-publish: anon read denied; authed read allowed on all six collections; owner `update` AND `delete` on `custodyEvents` denied; owner `create` with a hand-entered `recordedAt` denied (timestamp pin working); non-owner create denied. Live post-publish: signed-in data load across all tabs, owner ticket write, `config/app` round-trip, and one real custody emission — no write-error banner anywhere.
- ✅ **Permanent verification artifact (documented here = its provenance; NOT an anomaly):** custody event **`mrh1bg8zznr7`** — `ticket-created`, recordedAt 2026-07-11 19:07:52 UTC-5 (occurredAt `2026-07-12T00:07:52.067Z`, the SAME instant rendered in UTC), recorder `jsmith.ouhsc@gmail.com`, serials EMPTY, ticketIds `["mrh1a3gsw9xn"]`. It is the live-emission smoke for this rules deploy; the `RULES-SMOKE` throwaway ticket it references was deleted after the test (ticket deletion emits no event, per v1 design), so the event is intentionally orphaned. It is permanent BECAUSE the test passed — the log now refuses edits and deletes. Point any auditor at this line.
- **NEW open-work item surfaced by the smoke (see open-work list):** events do not snapshot the human-readable `ticketNo` — a deleted ticket orphans its events down to internal ids. Serials remain the surviving audit index (and real events carry them; the smoke event, with zero serials, is the worst case). Candidate small build: additive `ticketNos` snapshot at emission, optionally + a `ticket-deleted` event type. Touches `emitCustody`/detectors → **`detector_smoke.js` gate required**. Cannot retro-label existing events (append-only — as just proven).

**Completed in the reconcile-tests session (NEW FILE ONLY — zero app bytes changed, third session running; deployed `index.html` remains 376,167 bytes / md5 b6df106bcb2302e1f824d85653078cf5):**

- ✅ **`reconcile_tests.js` added to the repo — 46 cases, the third self-extracting gate.** Extracts the global helpers (`isBlankTag`/`BLANK_TAG_PATTERNS`/`findCol`), `normTkt`, and the **FULL `runReconciliation` closure body**, executed via `new Function` inside a harness that fakes the React environment (fixture state in, captured `setReport` out; the fake `alert` doubles as the error trap because the closure's try/catch reports via alert). Tests the deployed code AS BUILT — no refactor, no copies, cannot go stale. **REQUIRED gate: `node reconcile_tests.js index.html` after ANY edit to `runReconciliation`, `findVendorRow`, `flexMatch`, `vendorByNormList`, `isBlankTag`, `BLANK_TAG_PATTERNS`, `findCol`, or `normTkt`.**
- ✅ **What's pinned:** the collision centerpiece (exact side matches; ambiguous numeric REFUSES to guess → missing; unmatched twin → extra; collision flagged, never silent last-wins); leading-zero flex both directions; case-insensitive serial matching; tag logic (padded `NO ASSET TAG` strip, the blank-tag pattern table, numeric-aware tag equality, real-vs-real mismatch); placeholders (`PO-NNNN` bucket, Item Number desc fallback, excluded from extras and `vendorTotal`); blank-serial-row skip; missing/extra buckets; cross-ticket detection **incl. the as-built fact that cross-ticket serials ALSO appear in extras**; duplicate-audit detection with numeric norm on both sides; the serial-column hard-block guard (alert + no report); PO precedence (filename PO wins over typed); `waivedSerials` passthrough; `vendorSerials` payload; the `setShipments` merge (status → `reconciled` + `reconcileDate`); `findCol`'s four tiers; `normTkt`.
- ✅ **Fixtures mirror a REAL Vantage Point audit** (2026 "Final Audit" export, PO 1997): verbatim 27-column header row, serial cells as STRINGS with leading zeros, `NO ASSET TAG` padded with ~23 trailing spaces, placeholder serials shaped `PO-NNNN`. Serial/tag VALUES are scrambled look-alikes — the repo is public, real device identifiers are never committed. Separately, ALL 864 real rows were run end-to-end through the extracted core (local only): no alerts, columns detected, arithmetic closes exactly (863 non-blank serials = 853 vendor units + 10 placeholders, 0 collisions).
- ✅ **Verified 46/46 twice:** against the deployed bytes in the build environment, and independently on Justin's machine (macOS, Node v24). Gates are only gates if they run without the author's session.
- **Documented gaps (in the gate's header comment, honest by design):** `handleFile` (sheet selection + FileReader/XLSX — browser APIs) and the `ourAssets` pool builder incl. waived-serial EXCLUSION (React `useMemo`; the harness feeds the pool directly — waiver *passthrough* into the report IS covered).
- **Finding, resolved by PROCESS not code (Justin's call — simplest fix first):** real "Final Audit" exports can carry a SECOND sheet (PO/sales lines) with MORE rows than the inventory sheet; the pick-the-biggest-sheet heuristic in `handleFile` then selects the wrong sheet, finds no serial column, and hard-blocks the run — loud and harmless (the no-positional-fallback design doing its job), but blocked. Decision: no code change; the second sheet is irrelevant to this app. **OPERATING RULE: vendor audit workbooks must be SINGLE-SHEET — strip stray sheets before upload. SYMPTOM POINTER: if the app says "No serial-number column detected," check for a stray second sheet FIRST, before suspecting anything else.** (This rule matters once Data Governance reconcilers exist.)

**Discrepancy-tracker session — IN PROGRESS (checkpoint after Build D2.1; Build D3 Track-button pending):**

- **Design settled with Justin (grounded in his real chase workflow):** the tracker IS the University's exception process being born, not a recording of an existing one. Name: **Discrepancies** (tab label + Firestore collection `discrepancies` — name is permanent in rules/seam/records). One record per **(pickup, type, serial)** — deterministic identity, so seeding and re-runs are idempotent by construction. FIVE types ranked by severity: `missing` (chain-of-custody hole, highest), `cross-ticket`, `duplicate-audit`, `extra`, `tag-mismatch`. States: open → chasing → resolved; resolution vocabulary from Justin's REAL endings: found-later-audit, vendor-serial (vendor-created), vendor-confirmed, our-data-error, never-left, other (note required). **Posture: AUTO-RESOLVE** — cleared items resolve as the SYSTEM's act (`resolvedBy:"system"`, evidence attached); resolved items that reappear AUTO-REOPEN. State follows evidence in both directions; a closed record never pretends a human reviewed it.
- **Pertinence rule (Justin's): extras NEVER auto-open.** The vendor returns serialized items OU does not track (loose drives etc.); only Justin can judge pertinence. Extras stay in the report view; a manual **Track** button (Build D3) promotes the rare genuine case. The other four types are anchored to OUR serials and cannot be noise.
- ✅ **Build D0 (rules-only): `discrepancies` block deployed** between `custodyEvents` and `config` — read `signedIn()`, create+update `isOwner()`, **NO delete rule** (records are resolved, never removed; `config`'s posture). Playground-verified incl. owner delete DENIED. Deployed BEFORE the app that writes it — the safe order.
- ✅ **Build D1 (data layer, headless): SHIPPED + LIVE-SMOKED.** Five surgical edits: repo methods (`subscribeDiscrepancies`/`saveDiscrepancy`, no delete method), state+ref, subscription (same session-JSON/hydrateAll/pushToFirestore EXCLUSION posture as custodyEvents), `harvestDiscrepancies` between `detectShipmentCustody` and `upsertList`, one call-site line in `saveShipments`. Harvest fires on the SAME trigger as the custody re-reconcile detector (`reconcileReport.generatedAt` changed) — first reconciles, re-runs, and future backfills all feed it automatically. Doc ids `dx_<pickupId>_<type>_<encodedSerial>` (`dxKeyPart` char-code-escapes non-alphanumerics — Firestore-safe, collision-free). Waived serials auto-resolve with reason `waived`; cleared ones with `cleared-by-re-reconcile`. Schema v1 per record: `{id, v:1, type, serial, ticketNo (SNAPSHOT — rules-session lesson pre-applied), ticketId, pickupId, pickupName, state, openedAt, lastSeenAt, notes[{at,by,text}], evidence{type-specific}, resolution null|{reason,note,resolvedBy,at}}`. Live smoke: re-reconcile created records, extras correctly absent, second identical run produced NO duplicates (only `lastSeenAt` advanced), custody re-reconcile event still emitted. All three gates green; compile-verified. **Deployed at D1: 381,710 bytes, md5 aaee9398a4fb5b830f81c60c15d53e80.**
- ✅ **Build D2 (the Discrepancies tab): SHIPPED + LIVE-SMOKED.** Seventh tab with a RED open-count badge (a debt counter, deliberately not blue). Ranked list: severity = type rank, worst-first, then oldest-first. Filter chips (type / state / pickup select), show-resolved toggle. Rows expand to type-specific evidence + a dated note trail (system entries amber, user entries carry the signed-in email) + add-note. Resolve flow uses the six-reason vocabulary (`found-later-audit`, `vendor-serial`, `vendor-confirmed`, `our-data-error`, `never-left`, `other` with note REQUIRED); **Reopen is the only undo — no deletes exist anywhere**. Copy-open-serials respects active filters (the chase-email workflow: filter to a pickup's missing, click, paste). UI writes go through App-level `updateDiscrepancy` → `repo.saveDiscrepancy` directly — discrepancies are NOT session state. Resolver attribution displays the stored `resolvedBy`, never the current viewer (DG-proofing).
- ✅ **Build D2.1 (first-use feedback + a posture fix): SHIPPED + LIVE-SMOKED.** (1) Collapsed-row state pill is DISPLAY-ONLY; state changes are explicit labeled buttons in the expanded panel ("Mark as Chasing" / "Back to Open") — the silent-toggle pill failed discoverability AND feedback. (2) **RULE: automation may only reopen what automation closed.** The harvest's reopen branch is guarded on `resolution.resolvedBy==="system"` — a human resolution (vendor email, judgment call) is never contradicted by a report that merely STILL lists the serial; old evidence is not new evidence. System-resolved records still reopen on reappearance — state follows evidence in both directions, but only inside the evidence domain. (3) **Seed REMOVED entirely** (button, empty-state block, App handler): its only job was the pre-tracker transition (the 5 already-reconciled pickups), completed on its first click; every future record — including all backfill — enters through live reconciles. Dead scaffolding stripped per the lean rule. Disaster-recovery note: if `discrepancies` were ever lost, re-reconciling pickups regenerates OPEN records, but notes/states are not re-derivable from reports. Guard live-smoked: a human-resolved item survived a re-reconcile of the same audit file untouched while other records' `lastSeenAt` advanced (harvest ran and deliberately skipped it). **Deployed: 400,644 bytes, md5 54638e02f1709433b108f138f632cd81.** All three gates green on every build; compile-verified each time.

**Highest-value open work (code):**

- ✅ **Reconciliation correctness — ALREADY DONE** (verified in code this session; this doc previously and wrongly listed it as untouched). Collision-aware serial index (exact match wins; numeric-flex only when one serial owns the numeric value; ambiguous collisions refused and surfaced in a warning banner). Column detection hardened: positional `[8]` fallback removed, serial column resolved at parse time via an ordered variant list, detected mapping shown for confirmation, and reconciliation hard-blocked with the header list when no serial column is found. **Remaining here = unit tests only** (nothing pins this logic).
- **Build step** ([SHOULD], §6) — schedule-anytime deploy-safety insurance.
- **Bug list: CLOSED.** All matcher-refinement items and both pinned smalls were resolved in the matcher-refinement session. No known open bugs at handoff time.
- Reads are now enumerated per-collection (immutability-rules session) but the reader test is still **any Google account, not OU-only**. Tightening (email allowlist, or SSO with a campus ID via the TDX backend — the stated end-state) is future work and now lives in ONE place: the `signedIn()` rules function. Domain-matching won't work because the owner account is a personal `gmail.com`.
- **`ticketNo` snapshot in custody events** (surfaced by the rules smoke): events carry internal `ticketIds` only; deleting a ticket orphans its events (serials remain the surviving index). Additive `ticketNos` snapshot at emission (+ optional `ticket-deleted` event type) — small build, `detector_smoke.js` gate.

**Non-code risks surfaced (escalate, don't code):**

- **Prior-exposure disclosure.** Serials, locations, and requestor PII were publicly readable for some period before the rules fix. Whoever owns OU data governance should be told proactively — a "what was exposed / what changed" summary can be drafted on request.
- **Ownership concentration.** The whole production stack (GitHub Pages, the Firebase project, auth keyed to a personal Gmail) is owned by one person. If they're unavailable, OU has an ITAD system of record nobody else can administer or recover. This is the real driver behind the TDX/backend/SSO migration — name it to leadership as an institutional risk.

---

## 1. What These Apps Do

**AssetTrack** — the internal management app. IT staff use it to track disposal tickets, schedule pickups, scan assets at pickup, group tickets into vendor pickups, reconcile vendor audit files against expected inventory, and run cross-reference audits. Single-writer, multi-reader.

**DisposalRequest** — a request-intake form for anyone in the department who wants equipment disposed.

> **CORRECTION (was wrong in prior handoff):** The current `DisposalRequest.html` does **not** write to any database. It has no Firebase, no network calls. It is a **pure client-side CSV generator**: the requestor fills it out, it produces a CSV, and they hand that CSV to IT staff for manual ticket creation. The earlier description of it "writing directly into AssetTrack's Firestore via an open `create` rule" describes an *older or intended* design, not the delivered file. **Action: confirm which version is actually deployed**, because it changes the security model (see §7).

**Current workflow (as built):** Requestor fills DisposalRequest → downloads CSV → hands to IT → staff imports/creates ticket in AssetTrack → staff manually adds the TDX ticket number → ticket proceeds through pickup, scanning, vendor-pickup grouping, and reconciliation.

---

## 2. TARGET ARCHITECTURE — TDX Integration (the framework this project is being built toward)

This section is the strategic core of the handoff. The database backend is **undecided** (SQL, Firestore, or other), and the app was kept "deliberately primitive" specifically so the backend can change. The following constraints and decisions should govern all future work.

### 2.1 The intended end-state

- **Request side:** SSO-enabled users on the OU TDX Service Request page submit a disposal request. This **creates a ticket in TDX**.
- **Management side:** AssetTrack receives ticket info from TDX, creates/updates the corresponding record on the AssetTrack side, and **syncs updates back to TDX** (bidirectional).
- **TDX is the ITIL system of record for the ticket.** AssetTrack owns the asset-level detail and reconciliation data that TDX does not model well.

### 2.2 Hard constraint discovered in review — a backend service is REQUIRED

**A browser-hosted static HTML file cannot securely talk to the TDX Web API.** This is the single most important architectural finding. Reasons:

1. **Credentials are secrets.** TDX API auth uses a service-account login (username/password, OAuth client secret, or an admin BEID + WebServicesKey) that returns a JWT Bearer token. Any such credential placed in a public GitHub Pages file is fully exposed to the world.
2. **SSO is not usable for automation.** TDX explicitly does **not** support SSO for automated/scripted API access. Automated integration must use a non-SSO TeamDynamix service account. (The `loginsso` endpoint is for TDX's own internal client JS only.)
3. **CORS / origin.** The TDX API is not designed to be called from arbitrary browser origins.
4. **Rate limits are per-IP.** ~60 calls per IP per 60 seconds — a server-side budget, not something to distribute across many users' browsers.
5. **Token lifecycle.** Standard tokens expire (≈24h) and must be refreshed server-side.

**Conclusion:** A small **backend service / middleware tier** is non-optional once TDX is in scope. It holds the TDX credentials, brokers all API calls, and is the natural home for the chosen database. The architecture becomes a standard "SPA + API backend," which is well-trodden and safe.

```
[SSO requestor] → [TDX: ticket system of record]
                        ↕  (REST API out; Workflow Web Service in)
                  [Backend service]  ← holds TDX creds, brokers ALL calls
                        ↕
                  [Database: SQL / Firestore / TBD]
                        ↕
                  [AssetTrack client]  ← never touches TDX or DB directly
```

### 2.3 Key architectural decisions to make early

1. **Native TDX form vs. custom form (request side).** Because the form lives on the TDX Service Request page behind SSO, a **native TDX Service Catalog form** with custom attributes may create the ticket directly — no custom code, TDX handles SSO and creation. A custom HTML form only earns its place if the native catalog form can't capture the dynamic per-asset serial/tag rows. **Decide this before building anything on the request side.**
2. **System-of-record ownership per field.** TDX owns ticket-level fields (status, requestor, assignment). AssetTrack's DB owns asset-level/reconciliation detail. **Write down which side owns each field** to avoid two-master sync conflicts.
3. **Sync direction mechanics:**
   - AssetTrack → TDX: REST `POST/PUT /TDWebApi/api/{appId}/tickets...` (create/update). Store the **TDX ticket ID as the join key**. Use an idempotency key to prevent double-creates.
   - TDX → AssetTrack: **push** via a TDX Workflow "Web Service" step that calls a backend endpoint on ticket events (preferred), or **pull** by polling the Ticket Search API on an interval (simpler fallback).
4. **Asset modeling in TDX.** ITAD is fundamentally asset-lifecycle. Evaluate the **TDX Assets / CMDB (Configuration Items) module** for per-asset records (serials, tags) vs. cramming everything into ticket custom attributes. The CI/asset model is the more ITIL-correct fit.
5. **Backend stack.** Undecided, but it must be something that can hold secrets and expose HTTPS endpoints: a small Node/.NET service, or serverless functions (Azure Functions / Cloud Functions). The DB sits behind it.

### 2.4 The one thing to do NOW to make the backend swappable

> **✅ DONE (durability/security session).** Implemented as the global `repo` object — `subscribe*/get*/save*/delete*` for tickets/shipments/locations/requestors, now the only Firestore-aware code in the app. The rationale below is the original motivation, now satisfied.

**Introduce a data-access abstraction layer in AssetTrack immediately**, even while still on Firebase. Today, Firestore calls are scattered inline throughout the app (`onSnapshot` in a component, `fbSet`/`fbDelete` helpers). That couples the entire UI to Firebase. Replace the scattered calls with a single small "repository" interface — e.g. `getTickets()`, `subscribeTickets(cb)`, `saveTicket(t)`, `deleteTicket(id)`, and the same for shipments/locations/requestors. Today those wrap Firestore; tomorrow they wrap the REST backend. **When the backend is chosen, you reimplement one adapter file, not the whole app.** This is the highest-leverage prep work and is independent of which backend wins.

---

## 3. Current Tech Stack (prototype)

Single-file HTML + in-browser Babel-transpiled React. No build step.

### CDN Dependencies
```
React 18.2.0    https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.production.min.js
ReactDOM 18.2.0 https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.production.min.js
Babel 7.24.4    https://cdn.jsdelivr.net/npm/@babel/standalone@7.24.4/babel.min.js
SheetJS         https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
jsPDF           https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
AutoTable       https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js
Firebase 10.12.0 firebase-app-compat.js + firestore-compat + auth-compat (from gstatic.com)
Fonts           Geist + Geist Mono (Google Fonts)
```

### Babel / JS constraints — re-verify, the prior list was partly inaccurate
The previous handoff listed "no arrow functions / no template literals / no destructuring." **The delivered code uses all of these throughout and works** (e.g. `onClick={()=>setOpen(o=>!o)}`, template literals, `let`/`const`). Babel Standalone handles them fine. The *real* historical breakages were almost certainly:
- Multi-line string literals in JSX (use `"\n"` concatenation instead).
- Regex literals containing literal newlines/tabs.
- When editing via Python `str.replace`, `\\n` vs `\n` escaping and Unicode em-dashes breaking matches.

**Trusting the wrong constraint list wastes effort.** The durable fix is a build step (see §6), which eliminates this entire class of runtime failure.

---

## 4. Firebase Configuration (interim backend — treat as "Backend v0")

**Project:** `assettrack-67dd3`
```js
{
  apiKey: "AIzaSyCON6TTMYVI7Btc_EB-X9Y5OXGX4KRKdYM",
  authDomain: "assettrack-67dd3.firebaseapp.com",
  projectId: "assettrack-67dd3",
  storageBucket: "assettrack-67dd3.firebasestorage.app",
  messagingSenderId: "332759989629",
  appId: "1:332759989629:web:b63cf04c549acfff872014"
}
```

### Firestore Collections
- `tickets` — all disposal tickets
- `shipments` — vendor pickups ("shipments" in code, "Vendor Pickup" in UI)
- `locations` — `{id, name, address, campus}`
- `requestors` — `{id, name, email, phone, department}`
- `custodyEvents` — append-only chain-of-custody log (schema v1; see Status). Read via subscription (build 3); written ONLY by the emission layer; excluded from session JSON/hydrate/push by design. **Rules-enforced create-only with the server-timestamp pin as of the immutability-rules session.**
- `config` — single `config/app` doc of small settings (build 4): `{ governanceEmail }`.

### Auth
Google sign-in popup. One owner account has write access; everyone else is read-only.

### Security Rules (set in Firebase console) — UPDATED (immutability-rules session)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ONE definition of "reader" — when SSO/allowlist arrives, change this
    // function only and every collection inherits it.
    function signedIn() { return request.auth != null; }

    // ONE definition of "writer". email_verified guards the email claim.
    function isOwner() {
      return request.auth != null
        && request.auth.token.email == "jsmith.ouhsc@gmail.com"
        && request.auth.token.email_verified == true;
    }

    match /tickets/{id} {
      allow read: if signedIn();
      allow create, update, delete: if isOwner();
    }
    match /shipments/{id} {
      allow read: if signedIn();
      allow create, update, delete: if isOwner();
    }
    match /locations/{id} {
      allow read: if signedIn();
      allow create, update, delete: if isOwner();
    }
    match /requestors/{id} {
      allow read: if signedIn();
      allow create, update, delete: if isOwner();
    }

    // Chain-of-custody log: APPEND-ONLY, server-stamped.
    // recordedAt must equal Firestore's own clock — the app already sends
    // serverTimestamp() on every event, so this pin only blocks forgeries.
    // No update rule, no delete rule = both denied, for everyone, forever.
    match /custodyEvents/{id} {
      allow read: if signedIn();
      allow create: if isOwner()
        && request.resource.data.recordedAt == request.time;
    }

    // App settings (config/app): overwritten in place, never deleted.
    match /config/{id} {
      allow read: if signedIn();
      allow create, update: if isOwner();
    }
  }
}
```
> **Changed (immutability-rules session):** wildcard removed entirely (permissive-OR would have defeated a per-collection carve-out); reads AND writes enumerated per collection; `custodyEvents` create-only with the `recordedAt == request.time` pin; `config` create/update only; reader/writer centralized in `signedIn()`/`isOwner()`. Rules-only deploy — app bytes unchanged, no coupling, no deploy-order concern. Verified via Rules Playground + live smoke (see the session block in Status). Console/Admin SDK remains unbound; hard immutability = SQL backend.
> **Changed (security session, prior):** (1) read now requires authentication — `allow read: if true` had made every collection world-readable via the public Firebase config. (2) The per-`tickets` block and its `allow create: if true` (anonymous-create injection hole) were removed; tickets fall under the single owner-write rule. When the DisposalRequest→Firestore path lands later, creates come through the authenticated backend, not anonymous client writes.
> **Caveat (still true):** `signedIn()` allows *any* Google account to read, not OU staff specifically. Tighter access (email allowlist, or SSO with a campus ID via the TDX backend) is future work — and now a one-function change. Domain-matching fails because the owner uses a personal `gmail.com`.
> **Coupled app change:** the rule change required gating the subscribe effect on `user` (the app previously subscribed on mount before auth). Deploy order for this class of change is **app first, then rules** — see §9.
### Google Maps
- API key: `AIzaSyBk-Z0RmnWFaBlBr-E0jTOMBnNp2cUfU38` (Maps Embed API only, restricted to `ajustin2change.github.io/*` — confirm restriction is active)
- Stored as `var GMAPS_API_KEY` inside PickupScanTab's map logic
- Route origin hardcoded to `800 NE 15th St, Oklahoma City, OK 73104`

---

## 5. Data Models

### Ticket
```js
{
  id, ticketNo, date, scheduledPickupDate,
  site, requestor, phone, notes,
  vendorPickupNo,                 // NN-NNNNNNNN-NN, links to a shipment by name
  expectedAssets: [{serial, manufacturer, machineType, ouInventory, addedAt, duplicate}],
  originalAssets,                 // frozen snapshot of expectedAssets on first validation
  itemCounts: {lcdMonitors, miscBoxes, hardDriveBoxes, printers},
  pickupScanned, pickupScanList, directVendorPickup,
  pickupResult: {matched, missing, extra, partial[], waived[] /*serials, derived*/, waivedLines[] /*line indices, authoritative*/, linkedTo pairs},
    // partial[] item now: {id:"exp:{idx}", expIdx, expectedSerial, scannedSerial, matchKind:"exact"|"exact-review"|"fuzzy", canonical, expToken, scanToken, distance, resolution:"accept"|"reject"|"pending"}
  assets: [{serial, manufacturer, machineType, ouInventory, source, approved}],
  approvalStatus,                 // "awaiting-approval" | "validated" | undefined
  approvalFile, approvalUploadedAt,
  _campus, _department, _requestorEmail, _importedFrom, submittedViaForm, submittedAt
}
```
> **Data-model drift to clean up:** four overlapping asset arrays (`expectedAssets`, `originalAssets`, `assets`, `pickupScanList`) and several `_`-prefixed fields. Document which array is authoritative at each lifecycle stage and remove dead fields. This is a recurring source of "wrong array read" bugs and will complicate the TDX field mapping.

### Shipment (Vendor Pickup)
```js
{
  id, name,                       // name = NN-NNNNNNNN-NN
  vendor, location, createdDate, pickupDate, reconcileDate,
  status,                         // "scheduled" | "picked-up" | "reconciled"
  ticketIds: [],
  auditFileName, auditPo,
  reconcileReport: {
    matched, tagMismatch, missingFromVendor, extraFromVendor, placeholders,
    crossTicketMatches, duplicateAuditMatches,
    vendorSerials: [], waivedSerials: [],
    pickupNo, poNumber, fileName, generatedAt, ourTotal, vendorTotal
  }
}
```
> **1 MiB risk — downgraded.** The full `reconcileReport` (incl. `vendorSerials`) is written into one shipment doc. As of the durability session the write now fails **loud** (the write-error banner), not silently, and the largest real vendor audits are confirmed **< 200 KB** — well under the cap. Moving `vendorSerials` to a sub-collection is now [NICE], not [MUST]. See §8.

### Location / Requestor / Vendor codes
- Location `{id, name, address, campus}` — campus = "Norman" | "HC" | ""
- Requestor `{id, name, email, phone, department}`
- Vendor codes (first 2 digits of pickup number): `01`=VantagePoint (Tue → HC), `02`=Marrs, `03`=CDR (Thu → Norman)
- Session JSON: `{version:5, exportedAt, tickets, shipments, locations, requestors}`

---

## 6. App Structure — 6 Tabs + Settings

Pickup Scan tab (index 1) is hidden for non-signed-in users.

- **Tab 0 — Tickets:** create/edit/delete; import Excel or DisposalRequest CSV; search/sort/filter; site & requestor autocomplete with phone autofill; campus-aware scheduled-pickup suggestion (HC=Tue, Norman=Thu, skips days at 6 tickets); Scheduled/Overdue/Scan Pending pills; approve/deny workflow; download Original Submitted List; re-download Approval PDF; Export Confirmed Assets CSV; **duplicate ticket-number prevention** (numeric-aware, empty allowed) — this logic is solid.
- **Tab 1 — Pickup Scan** (signed-in only): Today's Pickups with draggable route tiles, route-order strip, embedded Google Map (hardcoded origin); serial scanning with match/extra/missing/partial resolution; vendor-direct-pickup toggle.
- **Tab 2 — Vendor Pickup:** container records; two-tier ticket selection; status Scheduled→Picked Up→Reconciled.
- **Tab 3 — Reconcile:** upload vendor audit xlsx; run reconciliation; per-ticket breakdown; inline waive/unwaive; cross-ticket & duplicate-audit alerts; per-ticket reconciliation PDFs.
- **Tab 4 — Report:** metrics dashboard with date-range filter, donut/stacked charts.
- **Tab 5 — Audit X-Ref:** live serial lookup across tickets + vendor audits; bidirectional cross-reference run (Type A = serial in wrong audit, Type B = serial in audit but ticket unassigned).
- **Settings (⚙):** Locations, Requestors, Data Management (Download Snapshot, Database Stats, one-time spreadsheet import).

**Persistence note:** child tabs receive the Firestore-wired **upsert-only** wrapper (`saveTickets`/`saveShipments`/…) under the prop name `setTickets` etc., and deletes go through explicit `onDelete*` props → `remove*`. The App-level session-load/import paths now route through `hydrateAll()` (state + refs together), so they no longer bypass persistence or desync the refs. See the Status block and §8.

---

## 7. Security Model

> **Updated (security session):** reads now require authentication (§4), so a signed-out browser sees **no data at all**, not a read-only view. The UI-hiding below still applies as defense-in-depth, but the data layer is now the primary gate. The signed-out view is being retired; a clean sign-in gate is a [NICE] UX follow-up (the shell still shows Create/Export affordances when signed out — cosmetic, not a leak).

When **not signed in**: Pickup Scan hidden; Tickets import/new/save/delete hidden (Open→View); Vendor Pickup inputs disabled; Reconcile upload/run/waive hidden; Settings add/update hidden. Writes blocked at both the UI and the Firestore rules (defense in depth).

**Auth implementation note:** a stale-closure bug (the `user` state was null inside `setTickets` updater closures at write time) was fixed by maintaining `userRef` (a ref kept in sync with auth state) and checking `userRef.current` in all write helpers. **Audit other async callbacks/updaters for the same class of bug** — the raw-setter import paths in §8 are the clearest remaining examples.

**Open items (security):**
1. ✅ **DONE — open `create` rule removed** this session; tickets now fall under owner-write (§4).
2. ✅ **DONE — public read closed** this session: read now requires `request.auth != null` (§4). *Remaining:* it's any Google account, not OU-only — allowlist/SSO is future.
3. **No server-side validation** — all validation is client-side. Add field-level Firestore rule constraints (types, required fields, max sizes); this also caps the 1 MiB risk.
4. **CSV formula injection** in DisposalRequest: `csvCell` quotes commas/quotes/newlines but does not neutralize leading `= + - @`. A field starting with those becomes a live formula when staff open the CSV in Excel. Prefix such cells with a leading apostrophe/space.
5. **Firebase App Check** to ensure only the real app (not a scripted client) can reach Firestore.
6. **Prior-exposure disclosure** (governance, not code) — see Status block. Data was publicly readable before the rules fix; notify OU data governance proactively.
7. **Ownership concentration** (institutional risk, not code) — entire prod stack on one person's personal accounts/Gmail. See Status block.
---

## 8. Review Findings — Prioritized Backlog

Tags: **[MUST]** / **[SHOULD]** / **[NICE]**. Items marked **(interim)** become moot once on the TDX backend; items marked **(durable)** matter regardless of backend.

### Data durability / loss vectors
- ✅ **DONE — [MUST] (durable) Public-read exposure.** Firestore was world-readable; closed via rules (`read: if request.auth != null`) + removing anonymous create + gating the subscribe effect on auth. Verified at the rules layer (Rules Playground), not just the UI. See §4 / §7 / Status.
- **[MUST] (interim)** No database backup. Enable Firestore **Point-in-Time Recovery** and/or scheduled backups in Google Cloud. This addresses the core "data loss" fear more than any code change. *(Note: data lives in Firestore, not in the HTML file — losing the file loses code, not data.)*
- ✅ **DONE — [MUST] (durable) Silent write failures.** Writes go through `repo`; errors surface via `reportWriteError` → persistent `writeError` banner. (Note: `saveStatus` was dead/never-rendered and owned by the FSA auto-save effect, so a dedicated `writeError` state was used instead of overloading it.)
- ✅ **MITIGATED — [MUST]→[NICE] (interim) Reconcile report 1 MiB.** Now fails **loud** (write-error banner); largest real audits confirmed < 200 KB. Sub-collection move downgraded to [NICE]; do it only if you're already touching that read path (§5).
- ✅ **DONE — [SHOULD] (durable) Local-state bypass paths.** `handleFSAOpen`, `handleFSANew`, and the legacy-load branch now route through `hydrateAll()` (sets state + refs together), closing both the persistence bypass and the new ref-desync risk. `runFolderImport` confirmed **dead code** (defined, never called) — safe to delete as housekeeping.
- ✅ **DONE — [SHOULD] (durable) Diff-and-delete footgun.** `save*` wrappers are upsert-only (never delete); deletion is explicit via `remove*`. A stray filtered subset can no longer mass-delete.
- ✅ **DONE — [SHOULD] (durable) Side effects inside setState updater.** Persistence moved out of the updater; `save*` compute `next` from `*Ref.current` and persist after `setState`.
- **[NICE] (interim)** Write fan-out: order-sensitive `JSON.stringify` diff causes spurious rewrites; per-doc `.set()` fans out. Use `writeBatch` for bulk ops.

### Reconciliation correctness (durable — this logic likely survives any re-platform)
- ✅ **DONE — [MUST] Numeric flex-match collisions.** Collision-aware index: exact match wins; numeric-flex used only when exactly one vendor serial owns the numeric value; ambiguous collisions refused (exact-only) and surfaced in a report warning banner. No more silent norm→serial last-wins.
- ✅ **DONE — [MUST] Fragile column detection.** Positional `[8]` fallback removed; serial column resolved at parse time via an ordered variant list; detected mapping shown for user confirmation before running; reconciliation hard-blocked (with the detected header list) when no serial column is found.
- **[SHOULD]** Column detection uses only `rows[0]`. Detect from the header row / scan several rows.
- **[NICE]** `placeholders` and `extraFromVendor` are added to every ticket's PDF; confirm this shared-item duplication is intended and label them as pickup-level.

### Code quality / stability
- **[SHOULD] (durable)** **Introduce a build step** (Vite/esbuild). Compiles JSX at deploy time, catches syntax errors before they ship, eliminates the runtime-Babel breakage class. Output can stay a single static file on GitHub Pages.
- **[SHOULD] (durable)** **Thin test net:** the scan matcher (`bestMatch`/`extractIdentifiers`) and the no-op rule HAVE standalone tests in `matcher_tests.js`, and the custody emission detectors HAVE `detector_smoke.js` (both self-extracting from `index.html` — NOT copies, cannot go stale), and the reconcile core is now PINNED by `reconcile_tests.js` (46 cases against real-audit fixture shapes — reconcile-tests session; `flexMatch`, `findCol`, `isBlankTag`, `normTkt`, and the full `runReconciliation` closure all covered). REMAINING in this item: ideally extract the shared matcher so app + tests use one source; one smoke test that the bundle builds and mounts.
- ✅ **DONE — [SHOULD] (durable) Data-access abstraction layer** (§2.4) — delivered as the `repo` object.
- **[NICE] (durable)** Data-model cleanup (§5).

---

## 9. Development Workflow Notes

- Working copy during dev: `AssetTrack_v2.html`; delivered as `AssetTrack.html`; DisposalRequest as `DisposalRequest.html`. On GitHub both are `index.html` in their repos.
- Hosting: GitHub Pages. Edit/upload `index.html`, commit, wait ~60s, hard-refresh (Ctrl/Cmd+Shift+R). Cannot run from `file://` (CDN scripts blocked) — test via Pages or `python3 -m http.server`.
- Repos kept separate with no links between them so DisposalRequest users can't navigate to AssetTrack.
- Edits made via Python `str.replace`; watch em-dashes/Unicode and `\\n` vs `\n` escaping.
- Favicons are embedded base64 SVGs in `<head>`.
- **Derive edits against the live file bytes, not remembered line numbers.** Working copies don't persist between sessions; box-drawing/em-dash chars and dash-count in comment rules can break a naive `str.replace` match (caught one this session). Capture the exact block, assert it matches once, then replace.
- **All three gates run before ANY build is delivered:** `node matcher_tests.js index.html`, `node detector_smoke.js index.html`, `node reconcile_tests.js index.html`. The scope-based triggers (matcher edits → matcher tests, etc.) are the minimum, not the ceiling — each gate costs seconds, so run the full set every time.
- **Lean comments going forward (comment-density rule, set with Justin in the reconcile-tests session):** the historical comment density was pre-gate insurance — prose defending load-bearing behavior from well-meaning simplification. The gates now carry that institutional memory mechanically (a test that FAILS when violated beats a comment that can go stale). Rule: new code gets ONE line of "why" where it matters, no essays; any build touching a region may thin that region's comments opportunistically as part of its diff; NO dedicated de-commenting build (pure byte churn, maximum diff noise, zero behavior change).
- **Compile-check before deploy.** Extract the `text/jsx-source` block and run it through `@babel/standalone` 7.24.4 (`Babel.transform(code,{presets:['react']})`); Babel catches the runtime-JSX breakage class but NOT undefined references (e.g. a hook not in the `const { … } = React` destructure) — eyeball those.
- **Coupled app+rules changes deploy app-first, then rules.** Tightening a Firestore rule while the old app is live can lock the app out of its own data. Then **verify the lock, don't infer it**: an empty incognito view proves the *app* gate; the Firestore **Rules Playground** (anon `get` → denied) proves the *rule*. Confirm signed-in access still works so you don't lock yourself out.

---

## 10. Suggested Sequence for the Next Phase

| Phase | Goal | Items |
|---|---|---|
| **0 — Decide** | Lock the architecture framework | Native TDX form vs custom (§2.3.1); system-of-record ownership per field (§2.3.2); confirm deployed DisposalRequest version (§1) |
| **1 — Stop the bleeding** | Make silent data loss impossible | Firestore PITR/backups; surface write failures; fix diff-delete footgun; reconcile/tighten the open `create` rule |
| **2 — Trust the numbers** | Reconciliation correctness | Flex-match collision handling; column-mapping confirmation; drop positional fallback |
| **3 — De-risk delivery** | Survive without the author | Build step + smoke test + core unit tests; data-access abstraction layer; data-model cleanup |
| **4 — Integrate** | TDX wiring | Stand up the backend service; TDX service account + auth; create-ticket on request; bidirectional sync; pick + implement the DB behind the abstraction layer |
| **5 — Grow (ITAD value)** | ITIL-grade audit trail | Chain-of-custody timestamps + actor log; Certificate of Data Destruction tracking; discrepancy escalation report |

---

> **Progress against this sequence (durability/security session):** Phase 1 (stop the bleeding) is essentially done — write failures surfaced, diff-delete footgun fixed, open `create` rule removed — plus the **public-read exposure** (not originally in this table) is closed. From Phase 3, the **data-access abstraction layer is done**; build step + tests remain. **Phase 2 (reconciliation correctness) is DONE** (collision handling, column-mapping confirmation, positional fallback dropped) — earlier text in this doc wrongly called it untouched. Remaining Phase-3 items: unit tests + build step. Phase 0 decisions remain open. **Phase 5 COMPLETE: custody builds 1–4 (+3.1 polish) all shipped and live-smoked.** See the as-built record below. **The optional Firestore immutability rules (deferred at Phase-5 kickoff) SHIPPED in the immutability-rules session — rules-only, app bytes unchanged.** The automated governance send (and its sent-event) moves to the backend tier (Phase 4), by design.

---

## Chain-of-Custody Event Log — BUILDS 1–4 COMPLETE (as-built record)

**Status: all four builds (+3.1) shipped. Phase 5 complete.** Schema, vocabulary, and emission architecture are in the Status block above (authoritative). This section keeps the compliance context and what remains.

**Why this mattered.** Highest-value *missing compliance feature*. The system records pickup *outcomes* (matched/missing/reconciled) but not an auditable *chain of events*: who scanned what, when, who handed it to the vendor, when it arrived. For an ePHI-uniform ITAD process that event trail is the spine of a defensible audit.

**Settled decisions, as shipped (do not relitigate):** dedicated `custodyEvents` collection through the `repo` seam with append-only methods (no update/delete); soft app-level append-only now, **rules-enforced create-only (SHIPPED, immutability-rules session)**, hard immutability at the SQL backend; explicit `provenance` per pickup event — scanned pickups record scanned serials incl. extras (everything that physically left), direct pickups record expected serials with the **requestor as attester** (snapshot) and the IT user as `recorderEmail`. Direct-pickup anchor: the Vendor Direct Pickup toggle / `saveDirectPickup` (`directVendorPickup:true`). Governance manifest email remains DEFERRED to the backend tier; stub is build 4.

**New fact learned this session:** Justin CAN obtain a vendor signature at handoff time. The schema reserves `witness: {name, org, method}` (null in v1) so signature capture bolts on without surgery — but any artifact the vendor signs must be **serial-blind** (count-level acknowledgment only); a signed serial manifest would break blind-audit integrity. Vendor sees counts; auditors see serials.

**Compliance constraints that shape it (hard rules):**
- **Blind vendor audits must be preserved** — never expose expected serials to the vendor before their independent audit. No custody artifact shared with the vendor may leak the manifest pre-audit.
- **Certificates of Data Destruction are batch-level**, tied to a whole pickup/shipment, not per serial — destruction custody events attach at the shipment level.
- **No signed artifact exists at vendor handoff today** — only a warehouse-arrival confirmation email received after delivery. The handoff event is currently unwitnessed; the log records it honestly (a "handoff" event with recorder + timestamp, even absent a vendor signature).

**Build sequence, updated:**
1. ✅ **DONE** — collection, repo methods, wrapper emission, Log Arrival, `vendorPO`. (The kickoff's sketched event shape was superseded: `ticketIds[]` array replaces singular `ticketId` — shipment-level events are ONE physical event spanning tickets; `recorderEmail` + `attester` replace single actor+role — expected-provenance events have TWO parties; `occurredAt`/`recordedAt` split forced by after-the-fact arrival recording.)
2. ✅ **DONE (CoDD session)** — `codd-attached`: batch CoDD at shipment level, joined via the PO printed on the certificate. As-built detail lives in the CoDD session block in Status (authoritative): nested `codd` object (metadata + filename/`fileUrl` pointer, PDF never stored), attach panel as Reconcile step 1, PO normalization + mismatch confirmation + empty-reference backfill, re-reconcile detection, `detector_smoke.js` gate.
3. ✅ **DONE (timeline session)** — per-ticket / per-shipment custody timeline; `subscribeCustodyEvents` wired (the console-only era is over). As-built detail in the timeline session block in Status (authoritative), incl. the 3.1 header-hoist/deviation rule and the display-only design rule.
4. ✅ **DONE (timeline session)** — governance manifest stub: `config/app` doc via repo, Settings destination field, ✉ Manifest PDF + mailto. No custody event by design (unverifiable manual send). See the Status block.

**Delivery artifacts this session:** `apply_custody_diffs.py` (10 hunks, exact-match assertions, reproducible byte-for-byte), `custody_build1_notes.md` (frozen schema, hunk rationale, 11-step smoke test), deployed `index.html` = **342,160 bytes**.

---

*Prepared from a full audit of the delivered files; updated after the chain-of-custody session, the matcher-refinement session, the CoDD session (build 2), the timeline session (builds 3, 3.1, 4), the immutability-rules session (rules-only; deployed app bytes unchanged), and the reconcile-tests session (new gate file only; deployed app bytes unchanged). Latest delivered AssetTrack build is **400,644 bytes** (md5 54638e02f1709433b108f138f632cd81; custody builds 1–4 + matcher refinements + `validatedAt` + discrepancy builds D1–D2.1); Phase 5 complete, discrepancy tracker in progress (D0–D2.1 live, D3 pending). ALWAYS re-verify against live bytes before planning diffs (`https://raw.githubusercontent.com/ajustin2change/AssetTrack/main/index.html`). Matcher or no-op-rule edits must pass `node matcher_tests.js index.html`; edits to `emitCustody` or the `detect*` functions must pass `node detector_smoke.js index.html`; edits to the reconcile core (`runReconciliation`/`findVendorRow`/`flexMatch`/`findCol`/`isBlankTag`/`normTkt`) must pass `node reconcile_tests.js index.html` — and per §9, all three gates run on every build regardless of scope. The TDX target architecture (§2) is the framework all future work should serve.*
