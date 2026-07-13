// Standalone unit tests for the AssetTrack reconcile core.
// Usage: node reconcile_tests.js [path/to/index.html]   (default ./index.html)
//
// Extracts three things from the app file and exercises them AS BUILT:
//   1. the global helpers isBlankTag/BLANK_TAG_PATTERNS/findCol,
//   2. normTkt (ticket editor duplicate-number normalizer),
//   3. the FULL runReconciliation closure body, executed inside a harness
//      that plays the part of React (fixture state in, captured report out).
//
// GATE: run after ANY edit to runReconciliation, findVendorRow, flexMatch,
// vendorByNormList, isBlankTag, BLANK_TAG_PATTERNS, findCol, or normTkt.
//
// Fixture shapes mirror a real Vantage Point audit (inventory sheet of a
// 2026 export): header row VERBATIM (27 columns), serial cells are STRINGS
// with leading zeros preserved, 'NO ASSET TAG' padded with trailing spaces,
// placeholder serials shaped PO-NNNN. Serial/tag VALUES are scrambled
// look-alikes, not real device identifiers (this repo is public).
//
// NOT covered here (documented gaps, by design):
//   - handleFile: sheet selection + FileReader/XLSX wiring (browser APIs).
//   - the ourAssets pool builder (React useMemo) incl. waived-serial
//     EXCLUSION — the harness feeds the pool directly. waivedSerials
//     passthrough into the report IS covered.

const fs = require("fs");
const file = process.argv[2] || "./index.html";
const html = fs.readFileSync(file, "utf-8");

function slice(startMarker, endMarker, what){
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker);
  if(s < 0 || e < 0 || e <= s) throw new Error(what + " block not found in " + file);
  return html.slice(s, e);
}

// 1. Global helpers -----------------------------------------------------------
const helperSrc = slice(
  '// Values treated as "no tag" for matching purposes',
  "// Levenshtein distance",
  "helper");
const helpers = new Function(helperSrc + "\nreturn {isBlankTag:isBlankTag, findCol:findCol};")();

// 2. normTkt (one-liner inside the ticket editor) -----------------------------
const ntStart = html.indexOf("function normTkt(s){");
if(ntStart < 0) throw new Error("normTkt not found in " + file);
const ntSrc = html.slice(ntStart, html.indexOf("\n", ntStart));
const normTkt = new Function(ntSrc + "\nreturn normTkt;")();

// 3. runReconciliation closure body -------------------------------------------
const coreSrc = slice("function runReconciliation(){", "var RSEC = {", "runReconciliation");
const factory = new Function(
  "vendorData","poNumber","ourAssets","pickup","tickets","shipments","waivedSerials",
  "setReport","setShipments","setVendorReport","localDateStr","alert","isBlankTag","findCol",
  coreSrc + "\nreturn runReconciliation;");

// Harness ----------------------------------------------------------------------
// Real header row, verbatim, from a Vantage Point inventory-sheet export.
const HEADERS = ["PO ID","Inventory ID","PO Line","Mfgr","Item Number","Description",
  "Asset Tag","Form Factor","Serial Number","Condition Code","Extended Description",
  "Location","Receive Status","Erasure","Grade","Engraved","Condition - Case",
  "Condition - Display","Missing Parts","Functionality Disposition","Scrap","Comments",
  "Lock/Management - Combined","Status","Sell Price.","Wipe Fee.","Rev. Share."];

// Vendor row builder — every header present, defval "" (mirrors sheet_to_json).
function vRow(serial, tag, extra){
  const r = {};
  HEADERS.forEach(function(h){ r[h] = ""; });
  r["Serial Number"] = serial;
  // Real files pad this cell with trailing spaces — preserve the shape.
  r["Asset Tag"] = (tag === undefined ? "NO ASSET TAG                       " : tag);
  r["Description"] = "LENOVO THINKPAD T14"; r["Mfgr"] = "LENOVO"; r["Form Factor"] = "LAPTOP";
  Object.keys(extra || {}).forEach(function(k){ r[k] = extra[k]; });
  return r;
}
function asset(serial, tag, tkt){
  return { serial: serial, ouInventory: (tag || ""), manufacturer: "LENOVO",
    machineType: "20UD", addedAt: "", source: "expected",
    ticketNo: (tkt || "TKT-100"), ticketId: "tid-" + (tkt || "TKT-100"), site: "Norman" };
}
// Column detection through the REAL extracted findCol, mirroring handleFile's chain.
const sampleRow = vRow("X", "Y");
const SERIAL_KEY = helpers.findCol(sampleRow, "Serial Number") || helpers.findCol(sampleRow, "Serial") || "";
const TAG_KEY    = helpers.findCol(sampleRow, "Asset Tag") || helpers.findCol(sampleRow, "Asset") || "";

function run(opts){
  const out = { alerts: [], report: null, vendorReport: null, shipmentsAfter: null };
  const pickup = opts.pickup || { id: "pk1", name: "01-02182026-01", ticketIds: ["tid-TKT-100"] };
  const vendorData = Object.assign(
    { rows: opts.rows || [], po: "", vpNo: "", fileName: "audit.xlsx",
      serialKey: (opts.serialKey !== undefined ? opts.serialKey : SERIAL_KEY),
      tagKey: (opts.tagKey !== undefined ? opts.tagKey : TAG_KEY), headers: HEADERS },
    opts.vendorData || {});
  const rr = factory(
    vendorData, (opts.poNumber || ""), (opts.ourAssets || []), pickup,
    (opts.tickets || []), (opts.shipments || []), (opts.waived || new Set()),
    function(r){ out.report = r; },
    function(fn){ out.shipmentsAfter = fn(opts.prevShipments || [Object.assign({}, pickup)]); },
    function(r){ out.vendorReport = r; },
    function(){ return "2026-07-11"; },
    function(msg){ out.alerts.push(String(msg)); },
    helpers.isBlankTag, helpers.findCol);
  rr();
  return out;
}
function serials(list){ return (list || []).map(function(x){ return x.serial; }).sort(); }

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if(ok){ pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + "\n  got:  " + JSON.stringify(got) + "\n  want: " + JSON.stringify(want)); }
}

// ── Helper tests ──────────────────────────────────────────────────────────────
t("findCol exact on real headers", SERIAL_KEY, "Serial Number");
t("findCol exact tag on real headers", TAG_KEY, "Asset Tag");
t("findCol case-insensitive", helpers.findCol(sampleRow, "serial number"), "Serial Number");
t("findCol startsWith survives trailing header junk",
  helpers.findCol({ "Serial Number\n(as scanned)": "" }, "Serial Number"), "Serial Number\n(as scanned)");
t("findCol includes tier", helpers.findCol(sampleRow, "Tag"), "Asset Tag");
t("findCol miss is null", helpers.findCol(sampleRow, "Nonexistent Col"), null);
t("isBlankTag table",
  ["", "   ", "N/A", "na", "none", "UNKNOWN", "nil", "—", "-", "no asset tag", "NO TAG", "PHSC130X", "0231"].map(helpers.isBlankTag),
  [true, true, true, true, true, true, true, true, true, true, true, false, false]);
t("normTkt numeric strips zeros", normTkt("007"), "7");
t("normTkt uppercase + trim", normTkt(" tkt-9 "), "TKT-9");
t("normTkt empty", normTkt(""), "");

// ── Core: exact + numeric-flex matching ───────────────────────────────────────
(function(){
  const r = run({ ourAssets: [asset("PF0TEST1")], rows: [vRow("PF0TEST1")] });
  t("clean exact -> matched", serials(r.report.matched), ["PF0TEST1"]);
  t("clean exact -> no alerts", r.alerts, []);
  t("clean exact -> both NO-ASSET tags not a mismatch", r.report.tagMismatch.length, 0);
})();
(function(){
  const r = run({ ourAssets: [asset("0028224455")], rows: [vRow("28224455")] });
  t("leading-zero flex (ours padded) -> matched", serials(r.report.matched), ["0028224455"]);
})();
(function(){
  const r = run({ ourAssets: [asset("28224455")], rows: [vRow("0028224455")] });
  t("leading-zero flex (vendor padded) -> matched", serials(r.report.matched), ["28224455"]);
})();
(function(){
  const r = run({ ourAssets: [asset("pf0test1")], rows: [vRow("PF0TEST1")] });
  t("case-insensitive serial match", serials(r.report.matched), ["pf0test1"]);
})();

// ── Core: the collision regression (the load-bearing case) ───────────────────
(function(){
  const r = run({
    ourAssets: [asset("832", "", "TKT-100"), asset("00832", "", "TKT-100")],
    rows: [vRow("0832"), vRow("832")] });
  t("collision: exact side still matches", serials(r.report.matched), ["832"]);
  t("collision: ambiguous numeric REFUSES to guess -> missing", serials(r.report.missingFromVendor), ["00832"]);
  t("collision: unmatched vendor twin -> extra", serials(r.report.extraFromVendor), ["0832"]);
  t("collision: flagged, not silent",
    r.report.serialCollisions.map(function(c){ return { norm: c.norm, serials: c.serials.slice().sort() }; }),
    [{ norm: "832", serials: ["0832", "832"] }]);
})();

// ── Core: tag comparison ──────────────────────────────────────────────────────
(function(){
  const r = run({ ourAssets: [asset("PF0TEST1", "0231")], rows: [vRow("PF0TEST1", "BRX99XX1")] });
  t("real-vs-real different tags -> tagMismatch", serials(r.report.tagMismatch), ["PF0TEST1"]);
  t("tagMismatch carries vendor tag", r.report.tagMismatch[0].vendorTag, "BRX99XX1");
})();
(function(){
  const r = run({ ourAssets: [asset("PF0TEST1", "0231")], rows: [vRow("PF0TEST1", "231")] });
  t("numeric-aware tag equality (0231 vs 231) -> matched", serials(r.report.matched), ["PF0TEST1"]);
})();
(function(){
  const r = run({ ourAssets: [asset("PF0TEST1", "0231")], rows: [vRow("PF0TEST1")] });
  t("padded NO ASSET TAG stripped -> matched, not mismatch", serials(r.report.matched), ["PF0TEST1"]);
})();
(function(){
  const r = run({ ourAssets: [asset("PF0TEST1", "N/A")], rows: [vRow("PF0TEST1", "BRX99XX1")] });
  t("blank-ish our tag (N/A) -> matched", serials(r.report.matched), ["PF0TEST1"]);
})();

// ── Core: placeholders, blanks, missing/extra ─────────────────────────────────
(function(){
  const r = run({ ourAssets: [asset("PF0TEST1")],
    rows: [vRow("PF0TEST1"), vRow("2042-0107", "NO ASSET TAG", { "Item Number": "80HE-TEST" }), vRow("")] });
  t("placeholder routes to its own bucket", serials(r.report.placeholders), ["2042-0107"]);
  t("placeholder excluded from extras", r.report.extraFromVendor.length, 0);
  t("placeholder desc falls back to Item Number when Description empty",
    run({ rows: [vRow("2042-0107", "NO ASSET TAG", { "Description": "", "Item Number": "80HE-TEST" })] })
      .report.placeholders[0].desc, "80HE-TEST");
  t("placeholder excluded from vendorTotal", r.report.vendorTotal, 1);
  t("blank serial row skipped everywhere", r.report.ourTotal + r.report.vendorTotal, 2);
})();
(function(){
  const r = run({ ourAssets: [asset("PF0MISSING")], rows: [vRow("PF0EXTRA1")] });
  t("missing from vendor", serials(r.report.missingFromVendor), ["PF0MISSING"]);
  t("extra from vendor", serials(r.report.extraFromVendor), ["PF0EXTRA1"]);
  t("extra carries em-dash ticketNo", r.report.extraFromVendor[0].ticketNo, "\u2014");
})();

// ── Core: cross-ticket + duplicate-audit detection ────────────────────────────
(function(){
  const r = run({ ourAssets: [], rows: [vRow("S4X9TT77")],
    tickets: [{ id: "tid-OTHER", ticketNo: "TKT-999", site: "HSC",
      expectedAssets: [{ serial: "S4X9TT77", manufacturer: "DELL", machineType: "", ouInventory: "" }] }] });
  t("cross-ticket hit on ticket OUTSIDE pickup",
    r.report.crossTicketMatches.map(function(m){ return m.ticketNo; }), ["TKT-999"]);
  t("cross-ticket records source pickup", r.report.crossTicketMatches[0].sourcePickup, "01-02182026-01");
  t("cross-ticket serial ALSO listed as extra (as built)", serials(r.report.extraFromVendor), ["S4X9TT77"]);
})();
(function(){
  const r = run({ ourAssets: [asset("28224455")], rows: [vRow("28224455")],
    shipments: [{ id: "pk-old", name: "01-01010101-01",
      reconcileReport: { vendorSerials: ["0028224455"], fileName: "old_audit.xlsx" } }] });
  t("duplicate-audit hit via numeric norm both sides",
    r.report.duplicateAuditMatches.map(function(m){ return m.otherPickup; }), ["01-01010101-01"]);
  t("duplicate-audit names the other audit file", r.report.duplicateAuditMatches[0].otherAudit, "old_audit.xlsx");
})();

// ── Core: guards, payload, persistence ────────────────────────────────────────
(function(){
  const r = run({ serialKey: "", rows: [vRow("PF0TEST1")] });
  t("missing serial column hard-blocks with alert",
    r.alerts.length === 1 && r.alerts[0].indexOf("No serial-number column") >= 0, true);
  t("missing serial column produces no report", r.report, null);
})();
(function(){
  const r = run({ ourAssets: [asset("PF0TEST1")], rows: [vRow("PF0TEST1")],
    poNumber: "1997", waived: new Set(["PF0WAIVED"]) });
  t("typed PO used when filename PO absent", r.report.poNumber, "1997");
  t("waivedSerials passthrough", r.report.waivedSerials, ["PF0WAIVED"]);
  t("vendorSerials payload stored for cross-audit checks", r.report.vendorSerials, ["PF0TEST1"]);
  t("report saved to pickup: status flips to reconciled",
    r.shipmentsAfter[0].status + "|" + r.shipmentsAfter[0].reconcileDate, "reconciled|2026-07-11");
  t("vendorReport mirror set", r.vendorReport === r.report, true);
})();
(function(){
  const r = run({ vendorData: { po: "2042" }, poNumber: "1997", rows: [] });
  t("filename PO wins over typed PO", r.report.poNumber, "2042");
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
