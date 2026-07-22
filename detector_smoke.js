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
eval(extract("attesterFor"));
eval(extract("detectTicketCustody"));

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
// ── Build 1b: in-person approval capture (detectTicketCustody) ──
const tBase = {id:"t1", pickupScanned:true, assets:[{serial:"AAA111"},{serial:"BBB222"}]};
T("approvalSignature appearing emits exactly one approval-captured with signer attester", ()=>{
  events.length=0;
  requestorsRef.current = [{name:"Jane Doe", email:"jane.doe@ouhsc.edu"}];
  const a = {...tBase};
  const b = {...tBase, approvalStatus:"validated", approvalSignature:{dataUrl:"data:image/png;base64,x", printedName:"Jane Doe", signedAt:"7/22/2026, 9:00:00 AM"}};
  detectTicketCustody([a],[b]);
  requestorsRef.current = [];
  if(events.length!==1) throw new Error("expected 1, got "+events.map(e=>e.type));
  const e=last();
  if(e.type!=="approval-captured") throw new Error("type "+e.type);
  if(!e.attester || e.attester.name!=="Jane Doe") throw new Error("attester "+JSON.stringify(e.attester));
  if(e.attester.email!=="jane.doe@ouhsc.edu") throw new Error("requestor email not snapshotted: "+e.attester.email);
  if(e.serials.length!==2) throw new Error("serials "+e.serials.length);
  if(!/^In-person approval signed by Jane Doe/.test(e.note)) throw new Error("note "+e.note);
});
T("resave with the same signature emits nothing", ()=>{
  events.length=0;
  const sig = {dataUrl:"data:image/png;base64,x", printedName:"Jane Doe", signedAt:"7/22/2026, 9:00:00 AM"};
  const a = {...tBase, approvalStatus:"validated", approvalSignature:sig};
  const b = {...a};
  detectTicketCustody([a],[b]);
  if(events.length!==0) throw new Error("expected 0, got "+events.map(e=>e.type));
});
T("pickupScanned transition still emits pickup-scanned only (no spurious approval event)", ()=>{
  events.length=0;
  const a = {...tBase, pickupScanned:false};
  const b = {...tBase, pickupScanned:true};
  detectTicketCustody([a],[b]);
  const types = events.map(e=>e.type);
  if(types.filter(t=>t==="pickup-scanned").length!==1) throw new Error("pickup-scanned count wrong: "+types);
  if(types.indexOf("approval-captured")>=0) throw new Error("spurious approval-captured");
});
// ── Build 1c: remote validation (approval-validated) ──
T("Mark Validated transition emits approval-validated with requestor attester and filename note", ()=>{
  events.length=0;
  requestorsRef.current = [{name:"Javiert Gray", email:"javiert.gray@ouhsc.edu"}];
  const a = {...tBase, requestor:"Javiert Gray", approvalStatus:"awaiting-approval", approvalFile:"ApprovalRequest-664883.pdf"};
  const b = {...a, approvalStatus:"validated", validatedAt:"7/22/2026, 4:12:02 PM"};
  detectTicketCustody([a],[b]);
  requestorsRef.current = [];
  if(events.length!==1) throw new Error("expected 1, got "+events.map(e=>e.type));
  const e=last();
  if(e.type!=="approval-validated") throw new Error("type "+e.type);
  if(!e.attester || e.attester.name!=="Javiert Gray") throw new Error("attester "+JSON.stringify(e.attester));
  if(e.attester.email!=="javiert.gray@ouhsc.edu") throw new Error("requestor email not snapshotted: "+e.attester.email);
  if(e.note.indexOf("ApprovalRequest-664883.pdf")<0) throw new Error("filename missing from note: "+e.note);
});
T("Exit A save (signature + validated together) emits approval-captured only", ()=>{
  events.length=0;
  const a = {...tBase, requestor:"Jane Doe"};
  const b = {...a, approvalStatus:"validated", approvalSignature:{dataUrl:"data:image/png;base64,x", printedName:"Jane Doe", signedAt:"now"}};
  detectTicketCustody([a],[b]);
  const types = events.map(e=>e.type);
  if(types.length!==1 || types[0]!=="approval-captured") throw new Error("expected [approval-captured], got "+types);
});
T("direct vendor pickup validation emits no approval-validated", ()=>{
  events.length=0;
  const a = {...tBase, pickupScanned:false, directVendorPickup:true, requestor:"Jane Doe"};
  const b = {...a, pickupScanned:true, approvalStatus:"validated"};
  detectTicketCustody([a],[b]);
  const types = events.map(e=>e.type);
  if(types.indexOf("approval-validated")>=0) throw new Error("spurious approval-validated on direct pickup: "+types);
  if(types.filter(t=>t==="pickup-attested").length!==1) throw new Error("pickup-attested missing: "+types);
});
T("resave of a validated ticket emits nothing", ()=>{
  events.length=0;
  const a = {...tBase, approvalStatus:"validated", validatedAt:"now"};
  const b = {...a};
  detectTicketCustody([a],[b]);
  if(events.length!==0) throw new Error("expected 0, got "+events.map(e=>e.type));
});
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
