// Standalone unit tests for the AssetTrack pickup resolution core (Build 1a).
// Usage: node pickup_tests.js [path/to/index.html]   (default ./index.html)
//
// Extracts the no-op rule block PLUS the pickup resolution core
// (isNoopCorrection, actionableCorrections, finalizePickup) and exercises
// them AS BUILT.
//
// GATE: run after ANY edit to finalizePickup, actionableCorrections,
// isNoopCorrection, saveAndClose, or any surface that renders proposed
// corrections, missing, or extras.
//
// Invariants pinned here (each traced to a live incident):
//   - a REJECTED correction never reaches assets under either serial;
//     its capture is reported for pruning and its expected serial becomes
//     Missing (ticket 660123, 7/17/2026).
//   - a PENDING correction never reaches assets as a phantom extra
//     (FVFCWEM4MNH double-listing, 7/21/2026).
//   - no serial can appear both as a correction and as a pending extra.

const fs = require("fs");
const file = process.argv[2] || "./index.html";
const html = fs.readFileSync(file, "utf-8");

function slice(startMarker, endMarker, what){
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker);
  if(s < 0 || e < 0 || e <= s) throw new Error(what + " block not found in " + file);
  return html.slice(s, e);
}

const coreSrc = slice(
  '// \u2500\u2500 No-op corrections (approval-exempt) \u2500\u2500',
  "// \u2500\u2500 Correction-row visualization (Phase 2b) \u2500\u2500",
  "pickup resolution core");
const core = new Function(coreSrc +
  "\nreturn {isNoopCorrection:isNoopCorrection, actionableCorrections:actionableCorrections, finalizePickup:finalizePickup};")();

// Harness ---------------------------------------------------------------------
let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log("  ok  " + name); }
  catch(e){ fail++; console.log("FAIL  " + name + " \u2014 " + e.message); }
}
function eq(a, b, what){ if(a !== b) throw new Error(what + ": expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)); }
function assert(cond, what){ if(!cond) throw new Error(what); }

const EXPMAP = {
  "F9FV5BANGHKJ": {serial:"F9FV5BANGHKJ", manufacturer:"APPLE", machineType:"TABLET", ouInventory:""},
  "C0WQ4TYJ1G5":  {serial:"C0WQ4TYJ1G5",  manufacturer:"APPLE", machineType:"DESKTOP", ouInventory:""},
  "HGXCTN2":      {serial:"HGXCTN2",      manufacturer:"DELL",  machineType:"LAPTOP", ouInventory:"T100"},
};
function partial(over){
  return Object.assign({id:"exp:0", expIdx:0, expectedSerial:"F9FV5BANGHKJ", scannedSerial:"F9FV58ANGHKJ",
    matchKind:"fuzzy", canonical:"F9FV58ANGHKJ", distance:1, type:"partial", resolution:null}, over||{});
}
function base(over){
  return Object.assign({matched:[], missing:[], extra:[], partial:[]}, over||{});
}

console.log("finalizePickup \u2014 accept");
t("accepted fuzzy records the canonical serial with expected metadata", function(){
  const r = core.finalizePickup(base({partial:[partial({resolution:"accept"})]}), EXPMAP);
  eq(r.assets.length, 1, "asset count");
  eq(r.assets[0].serial, "F9FV58ANGHKJ", "recorded serial");
  eq(r.assets[0].manufacturer, "APPLE", "metadata borrowed from expected");
  eq(r.assets[0].source, "scan-fuzzy", "source tag");
  eq(r.missing.length, 0, "no missing");
  eq(r.rejectedCaptures.length, 0, "no pruned captures");
});
t("accepted exact uses canonical over raw capture", function(){
  const r = core.finalizePickup(base({partial:[partial({matchKind:"exact", scannedSerial:"1SXHGXCTN2JUNK", canonical:"HGXCTN2", expectedSerial:"HGXCTN2"})]
    .map(function(p){ p.resolution="accept"; return p; })}), EXPMAP);
  eq(r.assets[0].serial, "HGXCTN2", "canonical recorded");
  eq(r.assets[0].ouInventory, "T100", "tag carried");
});

console.log("finalizePickup \u2014 reject (device not taken)");
t("rejected correction reaches assets under NEITHER serial", function(){
  const r = core.finalizePickup(base({partial:[partial({resolution:"reject"})]}), EXPMAP);
  const serials = r.assets.map(function(a){ return a.serial; });
  assert(serials.indexOf("F9FV58ANGHKJ") < 0, "scanned serial leaked into assets");
  assert(serials.indexOf("F9FV5BANGHKJ") < 0, "expected serial leaked into assets");
  eq(r.assets.length, 0, "asset count");
});
t("rejected correction moves expected serial to Missing with metadata", function(){
  const r = core.finalizePickup(base({partial:[partial({resolution:"reject"})]}), EXPMAP);
  eq(r.missing.length, 1, "missing count");
  eq(r.missing[0].serial, "F9FV5BANGHKJ", "expected serial");
  eq(r.missing[0].manufacturer, "APPLE", "metadata");
  eq(r.missing[0].fromRejected, true, "provenance flag");
});
t("rejected capture is reported for pruning from the scan list", function(){
  const r = core.finalizePickup(base({partial:[partial({resolution:"reject"})]}), EXPMAP);
  eq(r.rejectedCaptures.length, 1, "pruned count");
  eq(r.rejectedCaptures[0], "F9FV58ANGHKJ", "pruned capture");
});
t("rejected correction leaves pickupResult.partial", function(){
  const r = core.finalizePickup(base({partial:[partial({resolution:"reject"}), partial({id:"exp:1", expIdx:1, resolution:"accept"})]}), EXPMAP);
  eq(r.partial.length, 1, "partial count");
  eq(r.partial[0].resolution, "accept", "survivor");
});

console.log("finalizePickup \u2014 pending (regression: 7/21 double-listing)");
t("pending correction NEVER enters assets", function(){
  const r = core.finalizePickup(base({partial:[partial()]}), EXPMAP);
  eq(r.assets.length, 0, "no phantom extra-pending asset");
});
t("pending correction stays in partial for the approval round-trip", function(){
  const r = core.finalizePickup(base({partial:[partial()]}), EXPMAP);
  eq(r.partial.length, 1, "kept");
  eq(r.partial[0].resolution, null, "still undecided");
});
t("no serial appears as both a correction and a pending extra", function(){
  const r = core.finalizePickup(base({partial:[partial()], extra:[{id:"ext:XU102UT#ABA", serial:"XU102UT#ABA", type:"extra", linkedTo:null}]}), EXPMAP);
  const extraSerials = r.assets.filter(function(a){ return a.source==="scan-extra-pending"; }).map(function(a){ return a.serial; });
  const corrSerials = r.partial.map(function(p){ return p.canonical||p.scannedSerial; });
  extraSerials.forEach(function(s){ assert(corrSerials.indexOf(s) < 0, s + " double-listed"); });
  eq(extraSerials.length, 1, "true extra survives");
  eq(extraSerials[0], "XU102UT#ABA", "true extra serial");
});

console.log("finalizePickup \u2014 matched, linked, extras");
t("matched always recorded with metadata", function(){
  const r = core.finalizePickup(base({matched:[{id:"exp:2", serial:"HGXCTN2"}]}), EXPMAP);
  eq(r.assets.length, 1, "count");
  eq(r.assets[0].source, "scan", "source");
  eq(r.assets[0].ouInventory, "T100", "tag");
});
t("linked extra borrows metadata from its expected pair", function(){
  const r = core.finalizePickup(base({extra:[{id:"ext:NEW1", serial:"NEW1", linkedTo:"C0WQ4TYJ1G5"}]}), EXPMAP);
  eq(r.assets[0].source, "scan-linked", "source");
  eq(r.assets[0].machineType, "DESKTOP", "borrowed metadata");
});
t("unlinked extra lands as pending with null approval", function(){
  const r = core.finalizePickup(base({extra:[{id:"ext:DQPM8V1", serial:"DQPM8V1", linkedTo:null}]}), EXPMAP);
  eq(r.assets[0].source, "scan-extra-pending", "source");
  eq(r.assets[0].approved, null, "pending approval");
});
t("pre-existing missing is preserved ahead of rejected additions", function(){
  const r = core.finalizePickup(base({missing:[{id:"exp:9", serial:"OKXQVD", type:"missing"}], partial:[partial({resolution:"reject"})]}), EXPMAP);
  eq(r.missing.length, 2, "count");
  eq(r.missing[0].serial, "OKXQVD", "original first");
  eq(r.missing[1].serial, "F9FV5BANGHKJ", "rejected appended");
});

console.log("actionableCorrections \u2014 surface filter");
t("rejected rows are excluded from all correction surfaces", function(){
  const rows = core.actionableCorrections([partial({resolution:"reject"}), partial({id:"exp:1"})]);
  eq(rows.length, 1, "only non-rejected survive");
  eq(rows[0].resolution, null, "pending kept");
});
t("accepted no-op excluded; accepted fuzzy kept (fuzzy is never no-op)", function(){
  const noop = partial({matchKind:"exact", canonical:"HGXCTN2", expectedSerial:"HGXCTN2", resolution:"accept"});
  const fz = partial({resolution:"accept"});
  const rows = core.actionableCorrections([noop, fz]);
  eq(rows.length, 1, "count");
  eq(rows[0].matchKind, "fuzzy", "fuzzy stays customer-visible");
});
t("isNoopCorrection: verbatim exact only", function(){
  eq(core.isNoopCorrection(partial({matchKind:"exact", canonical:"HGXCTN2", expectedSerial:"HGXCTN2"})), true, "exact verbatim");
  eq(core.isNoopCorrection(partial({matchKind:"fuzzy", canonical:"HGXCTN2", expectedSerial:"HGXCTN2"})), false, "fuzzy never no-op");
  eq(core.isNoopCorrection(partial({matchKind:"exact", canonical:"HGXCTN3", expectedSerial:"HGXCTN2"})), false, "differing serials");
});

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
