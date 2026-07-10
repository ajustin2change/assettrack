// Self-extracting smoke for detectShipmentCustody in the NEW build.
const fs = require("fs");
const html = fs.readFileSync(process.argv[2] || "out_index.html", "utf-8");
function extract(name){
  const i = html.indexOf("function "+name+"(");
  if(i<0) throw new Error(name+" not found");
  let d=0, j=html.indexOf("{", i);
  for(let k=j; k<html.length; k++){
    if(html[k]==="{") d++;
    if(html[k]==="}") d--;
    if(d===0) return html.slice(i, k+1);
  }
}
const events = [];
const userRef = {current:{email:"jsmith.ouhsc@gmail.com"}};
const ticketsRef = {current:[{id:"t1", pickupScanned:true, assets:[{serial:"AAA111"},{serial:"BBB222"}]}]};
const requestorsRef = {current:[]};
function uid(){ return "ev"+(events.length+1); }
const repo = { saveCustodyEvent: function(ev){ events.push(ev); return Promise.resolve(); } };
function reportWriteError(){ throw new Error("write error"); }
eval(extract("emitCustody"));
eval(extract("custodySerials"));
eval(extract("shipVendorRef"));
eval(extract("shipmentSerials"));
eval(extract("detectShipmentCustody"));

let pass=0, fail=0;
function T(name, fn){ try{ fn(); pass++; console.log("PASS ", name); } catch(e){ fail++; console.log("FAIL ", name, "-", e.message); } }
function last(){ return events[events.length-1]; }
const base = {id:"s1", name:"01-20260707-01", ticketIds:["t1"], status:"picked-up", vendorPO:"2737", arrivedDate:"2026-07-08"};

T("first attach emits codd-attached, occurredAt=destructionDate, vendorRef=certPO", ()=>{
  events.length=0;
  const next = {...base, codd:{certPO:"2737", destructionDate:"2026-07-09", certNo:"", signedBy:"", fileName:"CoDD.pdf", fileUrl:"", attachedAt:"x", note:""}};
  detectShipmentCustody([base],[next]);
  if(events.length!==1) throw new Error("expected 1 event, got "+events.length+" ["+events.map(e=>e.type)+"]");
  const e=last();
  if(e.type!=="codd-attached") throw new Error("type "+e.type);
  if(e.occurredAt!=="2026-07-09") throw new Error("occurredAt "+e.occurredAt);
  if(e.vendorRef!=="2737") throw new Error("vendorRef "+e.vendorRef);
  if(e.serials.length!==2) throw new Error("serials "+e.serials.length);
  if(!/^CoDD attached/.test(e.note)) throw new Error("note "+e.note);
});
T("resave with unchanged codd (spread copy) emits nothing", ()=>{
  events.length=0;
  const a = {...base, codd:{certPO:"2737", destructionDate:"2026-07-09", certNo:"", signedBy:"", fileName:"CoDD.pdf", fileUrl:"", attachedAt:"x", note:""}};
  const b = {...a};
  detectShipmentCustody([a],[b]);
  if(events.length!==0) throw new Error("expected 0, got "+events.length);
});
T("replace codd emits correction note", ()=>{
  events.length=0;
  const a = {...base, codd:{certPO:"2737", destructionDate:"2026-07-09", certNo:"", signedBy:"", fileName:"CoDD.pdf", fileUrl:"", attachedAt:"x", note:""}};
  const b = {...base, codd:{certPO:"2740", destructionDate:"2026-07-11", certNo:"", signedBy:"", fileName:"CoDD2.pdf", fileUrl:"", attachedAt:"y", note:"PO mismatch vs pickup reference 2737"}};
  detectShipmentCustody([a],[b]);
  const e=last();
  if(events.length!==1) throw new Error("expected 1, got "+events.length);
  if(!/^CoDD replaced \(was PO 2737, destroyed 2026-07-09\)/.test(e.note)) throw new Error("note "+e.note);
  if(!/PO mismatch/.test(e.note)) throw new Error("mismatch note missing: "+e.note);
});
T("adding fileUrl later (SharePoint link) emits correction", ()=>{
  events.length=0;
  const a = {...base, codd:{certPO:"2737", destructionDate:"2026-07-09", certNo:"", signedBy:"", fileName:"CoDD.pdf", fileUrl:"", attachedAt:"x", note:""}};
  const b = {...base, codd:{...a.codd, fileUrl:"https://sharepoint/x", attachedAt:"y"}};
  detectShipmentCustody([a],[b]);
  if(events.length!==1 || last().type!=="codd-attached") throw new Error("got "+events.map(e=>e.type));
});
T("re-reconcile (generatedAt change while reconciled) emits reconciled w/ replaced note", ()=>{
  events.length=0;
  const a = {...base, status:"reconciled", reconcileReport:{generatedAt:"7/9/2026, 1:00:00 PM"}, auditFileName:"audit1.xlsx"};
  const b = {...a, reconcileReport:{generatedAt:"7/10/2026, 2:00:00 PM"}, auditFileName:"audit2.xlsx"};
  detectShipmentCustody([a],[b]);
  if(events.length!==1) throw new Error("expected 1, got "+events.map(e=>e.type));
  if(last().type!=="reconciled" || !/^Re-reconciled - audit file replaced \(audit2.xlsx\)/.test(last().note)) throw new Error(last().type+" / "+last().note);
});
T("first report on manually-advanced reconciled pickup emits with honest note", ()=>{
  events.length=0;
  const a = {...base, status:"reconciled"};
  const b = {...a, reconcileReport:{generatedAt:"7/10/2026, 2:00:00 PM"}, auditFileName:"audit1.xlsx"};
  detectShipmentCustody([a],[b]);
  if(events.length!==1) throw new Error("expected 1, got "+events.map(e=>e.type));
  if(!/^Reconciliation run on already-reconciled pickup \(audit1.xlsx\)/.test(last().note)) throw new Error(last().note);
});
T("normal first reconcile (status transition + report in one write) emits exactly one reconciled", ()=>{
  events.length=0;
  const a = {...base, status:"picked-up"};
  const b = {...a, status:"reconciled", reconcileReport:{generatedAt:"7/10/2026, 2:00:00 PM"}};
  detectShipmentCustody([a],[b]);
  const types = events.map(e=>e.type);
  if(types.filter(t=>t==="reconciled").length!==1) throw new Error("reconciled count wrong: "+types);
  if(types.indexOf("codd-attached")>=0) throw new Error("spurious codd event");
});
T("resave of reconciled shipment w/ same report (waive rewrite, same generatedAt) emits nothing", ()=>{
  events.length=0;
  const a = {...base, status:"reconciled", reconcileReport:{generatedAt:"7/9/2026, 1:00:00 PM", waivedSerials:[]}};
  const b = {...a, reconcileReport:{generatedAt:"7/9/2026, 1:00:00 PM", waivedSerials:["AAA111"]}};
  detectShipmentCustody([a],[b]);
  if(events.length!==0) throw new Error("expected 0, got "+events.map(e=>e.type));
});
T("codd on new shipment doc (old undefined) emits attach not replace", ()=>{
  events.length=0;
  const b = {...base, codd:{certPO:"2737", destructionDate:"2026-07-09", certNo:"C-9", signedBy:"", fileName:"", fileUrl:"", attachedAt:"x", note:""}};
  detectShipmentCustody([],[b]);
  const attach = events.filter(e=>e.type==="codd-attached");
  if(attach.length!==1) throw new Error("codd events "+attach.length);
  if(!/^CoDD attached #C-9/.test(attach[0].note)) throw new Error(attach[0].note);
});
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
