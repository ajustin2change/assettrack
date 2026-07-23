// Standalone unit tests for the AssetTrack serial matcher.
// Usage: node matcher_tests.js [path/to/index.html]   (default ./index.html)
// Extracts levenshtein/extractIdentifiers/constants/bestMatch and the Build 3
// live helpers (liveScanStatus/captureRelatesToTicket) from the app
// file and exercises them — keep this in the repo and run after ANY matcher edit.
const fs = require("fs");
const file = process.argv[2] || "./index.html";
const html = fs.readFileSync(file, "utf-8");
const start = html.indexOf("function levenshtein");
const end = html.indexOf("// ── Correction-row visualization");
if(start < 0 || end < 0 || end <= start) throw new Error("matcher block not found in " + file);
eval(html.slice(start, end));

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if(ok){ pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + "\n  got:  " + JSON.stringify(got) + "\n  want: " + JSON.stringify(want)); }
}
function summarize(m){ return m ? {kind:m.kind, canonical:m.canonical, scanned:m.scanned, distance:m.distance} : null; }

// 1. Lenovo undelimited suffix: serial embedded in one solid token -> containment, REVIEW
t("lenovo suffix containment",
  summarize(bestMatch("PF0DBAV8", ["1S20DF00EDUSPF0DBAV8"])),
  {kind:"exact-review", canonical:"PF0DBAV8", scanned:"1S20DF00EDUSPF0DBAV8", distance:0});

// 2. Mirror direction: compound on the TICKET, bare scan -> same containment
t("mirror containment",
  summarize(bestMatch("1S20DF00EDUSPF0DBAV8", ["PF0DBAV8"])),
  {kind:"exact-review", canonical:"PF0DBAV8", scanned:"PF0DBAV8", distance:0});

// 3. Delimited Lenovo (space present) stays AUTO exact — regression
t("delimited lenovo stays auto-exact",
  summarize(bestMatch("PF0DBAV8", ["1S20DF00EDUS PF0DBAV8"])),
  {kind:"exact", canonical:"PF0DBAV8", scanned:"1S20DF00EDUS PF0DBAV8", distance:0});

// 4. HP comma compound stays AUTO exact — regression
t("hp compound stays auto-exact",
  summarize(bestMatch("5CD93423ML", ["HP CHROMEBOOK 11 G7 EE,6QY22UT#ABA,5CD93423ML,1Y1Y0Y"])),
  {kind:"exact", canonical:"5CD93423ML", scanned:"HP CHROMEBOOK 11 G7 EE,6QY22UT#ABA,5CD93423ML,1Y1Y0Y", distance:0});

// 5. Fuzzy one-off — regression (canonical = scanned value per current design)
t("fuzzy one-off",
  summarize(bestMatch("C02GMCAJDV7L", ["C02MCAJDV7L"])),
  {kind:"fuzzy", canonical:"C02MCAJDV7L", scanned:"C02MCAJDV7L", distance:1});

// 6. Clean exact — regression
t("clean exact",
  summarize(bestMatch("ABC12345", ["ABC12345"])),
  {kind:"exact", canonical:"ABC12345", scanned:"ABC12345", distance:0});

// 7. 7-char shared token = existing review tier — regression
t("7-char token review",
  summarize(bestMatch("AB12345", ["AB12345"])),
  {kind:"exact-review", canonical:"AB12345", scanned:"AB12345", distance:0});

// 8. 7-char CONTAINED token: below containment minimum -> no match
t("7-char containment rejected",
  summarize(bestMatch("AB12345", ["XXXXXAB12345YYYY"])),
  null);

// 9. Exact tier beats containment when both available
t("exact beats containment",
  summarize(bestMatch("ABCD1234", ["JUNKABCD1234JUNK", "ABCD1234"])),
  {kind:"exact", canonical:"ABCD1234", scanned:"ABCD1234", distance:0});

// 10. Unrelated strings -> null
t("no match",
  summarize(bestMatch("ABCD1234", ["ZZZZ9999XXXX"])),
  null);

// 11. Fuzzy hit INSIDE a compound capture records the matched TOKEN, not the dump
t("fuzzy in compound capture records token",
  summarize(bestMatch("C02GMCAJDV7L", ["MACBOOK PRO,C02MCAJDV7L,A1990"])),
  {kind:"fuzzy", canonical:"C02MCAJDV7L", scanned:"MACBOOK PRO,C02MCAJDV7L,A1990", distance:1});

// ── isNoopCorrection: approval-exemption rule ──
function noop(p){ return isNoopCorrection(p) && p.resolution==="accept"; }
t("noop: accepted auto-exact, record unchanged",
  noop({matchKind:"exact", canonical:"PF0DBAV8", expectedSerial:"PF0DBAV8", resolution:"accept"}), true);
t("noop: accepted containment/7-char review, record unchanged",
  noop({matchKind:"exact-review", canonical:"PF0DBAV8", expectedSerial:"PF0DBAV8", resolution:"accept"}), true);
t("kept: rejected review is never no-op",
  noop({matchKind:"exact-review", canonical:"PF0DBAV8", expectedSerial:"PF0DBAV8", resolution:"reject"}), false);
t("kept: accepted review but record CHANGES (dirty ticket serial)",
  noop({matchKind:"exact-review", canonical:"R3XS684047X", expectedSerial:"R3XS684047X | IMEI: 35893", resolution:"accept"}), false);
t("kept: fuzzy is never no-op",
  noop({matchKind:"fuzzy", canonical:"C02MCAJDV7L", expectedSerial:"C02GMCAJDV7L", resolution:"accept"}), false);
t("noop: case-insensitive serial compare",
  noop({matchKind:"exact", canonical:"PF0DBAV8", expectedSerial:"pf0dbav8", resolution:"accept"}), true);

// \u2500\u2500 liveScanStatus / captureRelatesToTicket (Build 3 live matcher helper) \u2500\u2500
function exp(list){ return list.map(function(s){ return {serial:s}; }); }
function counts(r){ return {matched:r.matched, likely:r.likely, unaccounted:r.unaccounted}; }
function rowAt(r,i){ var x=r.rows[i]||{}; return {status:x.status, capture:x.capture===undefined?null:x.capture}; }

// 18. Exact scan -> matched
t("live: exact scanned is matched",
  counts(liveScanStatus(exp(["ABC12345"]), ["ABC12345"], new Set())),
  {matched:1, likely:0, unaccounted:0});

// 19. Fuzzy capture -> likely, capture recorded
t("live: fuzzy capture is likely",
  rowAt(liveScanStatus(exp(["C02GMCAJDV7L"]), ["C02MCAJDV7L"], new Set()), 0),
  {status:"likely", capture:"C02MCAJDV7L"});

// 20. Compound containment capture -> likely
t("live: containment capture is likely",
  rowAt(liveScanStatus(exp(["PF0DBAV8"]), ["1S20DF00EDUSPF0DBAV8"], new Set()), 0),
  {status:"likely", capture:"1S20DF00EDUSPF0DBAV8"});

// 21. 7-char shared token -> likely (review tier counts as accounted-for)
t("live: 7-char token capture is likely",
  rowAt(liveScanStatus(exp(["AB12345X"]), ["JUNK AB12345X JUNK"], new Set()), 0),
  {status:"likely", capture:"JUNK AB12345X JUNK"});

// 22. Stranger capture -> row pending, unaccounted counts it
t("live: stranger leaves row pending",
  counts(liveScanStatus(exp(["ABCD1234"]), ["ZZZZ9999XXXX"], new Set())),
  {matched:0, likely:0, unaccounted:1});

// 23. Waived line excluded from ALL counts
t("live: waived row excluded from counts",
  counts(liveScanStatus(exp(["ABCD1234","EFGH5678"]), ["EFGH5678"], new Set([0]))),
  {matched:1, likely:0, unaccounted:0});

// 24. Consume-once: one fuzzy capture accounts for the FIRST close row only
t("live: capture consumed once, in expected order",
  (function(){ var r=liveScanStatus(exp(["ABCD12345","ABCD12346"]), ["ABCD12347"], new Set()); return [rowAt(r,0).status, rowAt(r,1).status]; })(),
  ["likely","pending"]);

// 25. A capture that IS another expected serial stays out of the fuzzy pool
t("live: exact-owned capture never feeds a sibling row",
  (function(){ var r=liveScanStatus(exp(["ABCD12345","ABCD12346"]), ["ABCD12346"], new Set()); return [rowAt(r,0).status, rowAt(r,1).status]; })(),
  ["pending","matched"]);

// 26. relates: exact expected serial (incl. waived rows scanned by hand)
t("relates: exact serial relates",
  captureRelatesToTicket("ABC12345", exp(["ABC12345"])), true);

// 27. relates: fuzzy reach relates -> stays SILENT (no thunk)
t("relates: fuzzy reach relates",
  captureRelatesToTicket("C02MCAJDV7L", exp(["C02GMCAJDV7L"])), true);

// 28. relates: true stranger -> false (this is the thunk)
t("relates: stranger does not relate",
  captureRelatesToTicket("ZZZZ9999XXXX", exp(["ABCD1234"])), false);

// 29. relates: sub-threshold short capture vs different short serial -> thunk
t("relates: short junk below all tiers",
  captureRelatesToTicket("AB123", exp(["CD456"])), false);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
