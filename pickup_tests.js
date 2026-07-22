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
  "\nreturn {isNoopCorrection:isNoopCorrection, actionableCorrections:actionableCorrections, finalizePickup:finalizePickup, undecidedCounts:undecidedCounts, restateForApproval:restateForApproval, applyRescan:applyRescan};")();

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

console.log("finalizePickup \u2014 extra verbs (Build 1b)");
t("included extra becomes an approved scan-extra asset", function(){
  const out = core.finalizePickup(base({extra:[{id:"ext:ZZTOP99001", serial:"ZZTOP99001", type:"extra", resolution:"include"}]}), EXPMAP);
  const a = out.assets.find(function(x){ return x.serial==="ZZTOP99001"; });
  assert(a, "included extra missing from assets");
  eq(a.source, "scan-extra", "source");
  eq(a.approved, true, "approved");
});
t("removed extra reaches no assets and is not a rejected capture", function(){
  const out = core.finalizePickup(base({extra:[{id:"ext:ZZTOP99001", serial:"ZZTOP99001", type:"extra", resolution:"remove"}]}), EXPMAP);
  assert(!out.assets.some(function(x){ return x.serial==="ZZTOP99001"; }), "removed extra leaked into assets");
  assert(out.rejectedCaptures.indexOf("ZZTOP99001") < 0, "removed extra wrongly queued for scan-list pruning");
});
t("undecided extra stays a pending asset (unchanged 1a behavior)", function(){
  const out = core.finalizePickup(base({extra:[{id:"ext:ZZTOP99001", serial:"ZZTOP99001", type:"extra", resolution:null}]}), EXPMAP);
  const a = out.assets.find(function(x){ return x.serial==="ZZTOP99001"; });
  assert(a && a.source==="scan-extra-pending" && a.approved===null, "pending extra shape changed");
});

console.log("finalizePickup \u2014 missing kept (Build 1b)");
t("kept missing is marked approvedMissing and never enters assets", function(){
  const out = core.finalizePickup(base({missing:[{id:"exp:2", expIdx:2, serial:"HGXCTN2", type:"missing", resolution:"kept"}]}), EXPMAP);
  const m = out.missing.find(function(x){ return x.serial==="HGXCTN2"; });
  assert(m && m.approvedMissing===true, "kept missing not marked");
  assert(!out.assets.some(function(x){ return x.serial==="HGXCTN2"; }), "kept missing leaked into assets");
});
t("undecided missing passes through unmarked", function(){
  const out = core.finalizePickup(base({missing:[{id:"exp:2", expIdx:2, serial:"HGXCTN2", type:"missing", resolution:null}]}), EXPMAP);
  const m = out.missing.find(function(x){ return x.serial==="HGXCTN2"; });
  assert(m && !m.approvedMissing, "undecided missing wrongly marked");
});

console.log("undecidedCounts \u2014 the exit gate (Build 1b)");
t("mixed set counts only genuinely open items", function(){
  const r = base({
    partial:[partial({resolution:"accept"}), partial({id:"exp:1", resolution:"reject"}), partial({id:"exp:9", resolution:null})],
    missing:[{id:"exp:2", serial:"HGXCTN2", resolution:"kept"}, {id:"exp:3", serial:"C0WQ4TYJ1G5", resolution:null}, {id:"exp:4", serial:"L1", linkedTo:"ext:L1", resolution:"linked"}],
    extra:[{id:"ext:A", serial:"A1234567", resolution:"include"}, {id:"ext:B", serial:"B1234567", resolution:"remove"}, {id:"ext:C", serial:"C1234567", resolution:null}, {id:"ext:L1", serial:"L1X", linkedTo:"exp:4", resolution:"linked"}]
  });
  const u = core.undecidedCounts(r);
  eq(u.partials, 1, "partials"); eq(u.missing, 1, "missing"); eq(u.extras, 1, "extras"); eq(u.total, 3, "total");
});
t("legacy approvedMissing counts as decided", function(){
  const u = core.undecidedCounts(base({missing:[{id:"exp:2", serial:"HGXCTN2", approvedMissing:true}]}));
  eq(u.total, 0, "total");
});
t("Exit A is impossible with any undecided row", function(){
  const u = core.undecidedCounts(base({partial:[partial({resolution:null})]}));
  assert(u.total > 0, "gate open with a pending correction");
});

console.log("restateForApproval \u2014 Exit B wipe (Build 1b)");
t("clicks clear; machine defaultResolution survives; links survive", function(){
  const r = base({
    partial:[partial({resolution:"accept"}), partial({id:"exp:1", matchKind:"exact", defaultResolution:"accept", resolution:"accept"})],
    missing:[{id:"exp:2", serial:"HGXCTN2", resolution:"kept", approvedMissing:true}, {id:"exp:4", serial:"L1", linkedTo:"ext:L1", resolution:"linked"}],
    extra:[{id:"ext:A", serial:"A1234567", resolution:"remove"}, {id:"ext:L1", serial:"L1X", linkedTo:"exp:4", resolution:"linked"}]
  });
  const out = core.restateForApproval(r);
  eq(out.partial[0].resolution, null, "clicked fuzzy accept survived the wipe");
  eq(out.partial[1].resolution, "accept", "exact defaultResolution wiped");
  eq(out.missing[0].resolution, null, "kept click survived");
  eq(out.missing[0].approvedMissing, false, "approvedMissing survived");
  eq(out.missing[1].resolution, "linked", "linked missing disturbed");
  eq(out.extra[0].resolution, null, "remove click survived");
  eq(out.extra[1].resolution, "linked", "linked extra disturbed");
});
t("restate then finalize: pending fuzzy is a proposed correction, never an asset (incident regression)", function(){
  const restated = core.restateForApproval(base({partial:[partial({resolution:"accept"})]}));
  const out = core.finalizePickup(restated, EXPMAP);
  assert(!out.assets.some(function(x){ return x.serial==="F9FV58ANGHKJ" || x.serial==="F9FV5BANGHKJ"; }), "wiped correction leaked into assets");
  eq(out.partial.length, 1, "proposed correction lost");
});
t("all-decided finalize leaves no pending sources (signed-record invariant)", function(){
  const out = core.finalizePickup(base({
    matched:[{id:"exp:0", serial:"C0WQ4TYJ1G5"}],
    partial:[partial({resolution:"accept"})],
    missing:[{id:"exp:2", serial:"HGXCTN2", resolution:"kept"}],
    extra:[{id:"ext:A", serial:"A1234567", resolution:"include"}, {id:"ext:B", serial:"B1234567", resolution:"remove"}]
  }), EXPMAP);
  assert(!out.assets.some(function(x){ return x.source==="scan-extra-pending"; }), "pending source on a signed record");
});

console.log("applyRescan \u2014 Build 2 (replace one capture; target decision cleared; siblings survive)");
const RTGT = {rowId:"exp:0", kind:"partial", removedSerial:"F9FV58ANGHKJ", expectedSerial:"F9FV5BANGHKJ"};
t("replacement: bad capture removed, new serial prepended", function(){
  const r = core.applyRescan(["ABC1","F9FV58ANGHKJ","XYZ9"], {}, {}, RTGT, "F9FV5BANGHKJ");
  eq(r.ok, true, "ok");
  eq(r.scanned.join(","), "F9FV5BANGHKJ,ABC1,XYZ9", "old out, new first");
});
t("input normalized: trimmed and uppercased", function(){
  const r = core.applyRescan(["F9FV58ANGHKJ"], {}, {}, RTGT, "  f9fv5banghkj ");
  eq(r.ok, true, "ok");
  eq(r.serial, "F9FV5BANGHKJ", "normalized");
});
t("dup against ANOTHER existing capture refused", function(){
  const r = core.applyRescan(["ABC1","F9FV58ANGHKJ"], {}, {}, RTGT, "abc1");
  eq(r.ok, false, "refused");
  eq(r.reason, "dup", "reason");
});
t("re-entering the removed serial itself is NOT a dup", function(){
  const r = core.applyRescan(["F9FV58ANGHKJ"], {}, {}, RTGT, "F9FV58ANGHKJ");
  eq(r.ok, true, "allowed");
  eq(r.scanned.join(","), "F9FV58ANGHKJ", "list unchanged");
});
t("empty input refused; missing target refused", function(){
  eq(core.applyRescan(["A"], {}, {}, RTGT, "   ").ok, false, "empty");
  eq(core.applyRescan(["A"], {}, {}, null, "B").ok, false, "no target");
});
t("target's own resolution cleared; sibling decisions survive", function(){
  const r = core.applyRescan(["F9FV58ANGHKJ"], {"exp:0":"reject","exp:1":"accept","ext:Q":"remove"}, {}, RTGT, "NEW1");
  eq(r.resolutions["exp:0"], undefined, "target cleared \u2014 old decision belonged to the old capture");
  eq(r.resolutions["exp:1"], "accept", "sibling correction survives");
  eq(r.resolutions["ext:Q"], "remove", "sibling extra survives");
});
t("target's link AND its partner dropped; sibling links survive", function(){
  const links = {"exp:0":"ext:BAD","ext:BAD":"exp:0","exp:2":"ext:OK","ext:OK":"exp:2"};
  const r = core.applyRescan(["F9FV58ANGHKJ"], {}, links, RTGT, "NEW1");
  eq(r.links["exp:0"], undefined, "target side dropped");
  eq(r.links["ext:BAD"], undefined, "partner side dropped");
  eq(r.links["exp:2"], "ext:OK", "sibling pair survives");
});
t("extra-row target: serial-keyed capture replaced, its stale decision cleared", function(){
  const xt = {rowId:"ext:BADCAP", kind:"extra", removedSerial:"BADCAP", expectedSerial:null};
  const r = core.applyRescan(["BADCAP","OTHER"], {"ext:BADCAP":"include"}, {}, xt, "GOODCAP");
  eq(r.scanned.join(","), "GOODCAP,OTHER", "replaced");
  eq(r.resolutions["ext:BADCAP"], undefined, "stale include cleared");
});
t("purity: inputs not mutated", function(){
  const s=["F9FV58ANGHKJ","K1"], res={"exp:0":"accept"}, ln={"exp:0":"ext:Z","ext:Z":"exp:0"};
  core.applyRescan(s, res, ln, RTGT, "NEW2");
  eq(s.join(","), "F9FV58ANGHKJ,K1", "scanned untouched");
  eq(res["exp:0"], "accept", "resolutions untouched");
  eq(ln["ext:Z"], "exp:0", "links untouched");
});

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
