// Standalone unit tests for the AssetTrack serial matcher.
// Usage: node matcher_tests.js [path/to/index.html]   (default ./index.html)
// Extracts levenshtein/extractIdentifiers/constants/bestMatch from the app
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

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
