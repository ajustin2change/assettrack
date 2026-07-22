// Gate 4 — build-and-mount smoke (rebuilt, Build 1a).
// Usage: node mount_smoke.js [path/to/index.html]   (default ./index.html)
//
// Catches the D3 ReferenceError class statically: identifiers that Babel
// compiles happily but that resolve to NOTHING at runtime (no binding in
// any enclosing scope, not a browser/library global). Compile-verify alone
// passes these silently; this gate does not.
//
// Requires: npm i @babel/core @babel/preset-env @babel/preset-react
//           @babel/parser @babel/traverse   (dev-machine only, not shipped)

const fs = require("fs");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const file = process.argv[2] || "./index.html";
const html = fs.readFileSync(file, "utf-8");
const TAG = '<script type="text/jsx-source" id="jsx-source">';
const s = html.indexOf(TAG);
if(s < 0){ console.log("FAIL  jsx-source block not found"); process.exit(1); }
const e = html.indexOf("</script>", s);
const code = html.slice(s + TAG.length, e);

const GLOBALS = new Set(("window document navigator console alert confirm prompt setTimeout setInterval "+
  "clearTimeout clearInterval requestAnimationFrame fetch localStorage sessionStorage location history "+
  "React ReactDOM XLSX jspdf jsPDF firebase Babel FileReader Blob File URL URLSearchParams FormData "+
  "Audio AudioContext webkitAudioContext Image crypto performance screen getComputedStyle "+
  "Date Math JSON Object Array String Number Boolean Set Map WeakMap WeakSet Promise RegExp Error TypeError "+
  "RangeError SyntaxError parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent "+
  "encodeURI decodeURI btoa atob structuredClone Symbol Proxy Reflect Intl NaN Infinity undefined globalThis "+
  "arguments CustomEvent Event KeyboardEvent MouseEvent Node HTMLElement DOMParser XMLSerializer "+
  "MutationObserver ResizeObserver IntersectionObserver AbortController Headers Request Response "+
  "TextEncoder TextDecoder queueMicrotask showDirectoryPicker showSaveFilePicker").split(/\s+/));

// Harvest top-level names declared by the page's OTHER plain <script> blocks
// (firebase bootstrap defines var auth / var repo etc. — real window globals).
let cursor = 0;
while(true){
  const ts = html.indexOf("<script", cursor);
  if(ts < 0) break;
  const tagEnd = html.indexOf(">", ts);
  const tag = html.slice(ts, tagEnd + 1);
  cursor = tagEnd + 1;
  if(tag.indexOf("src=") >= 0) continue;
  if(tag.indexOf("jsx-source") >= 0) continue;
  const ce = html.indexOf("</script>", cursor);
  const block = html.slice(cursor, ce);
  cursor = ce + 9;
  try {
    const bast = parser.parse(block, {sourceType:"script"});
    bast.program.body.forEach(function(node){
      if(node.type === "VariableDeclaration") node.declarations.forEach(function(d){ if(d.id && d.id.name) GLOBALS.add(d.id.name); });
      if(node.type === "FunctionDeclaration" && node.id) GLOBALS.add(node.id.name);
    });
  } catch(e){ /* non-JS block — ignore */ }
}

let ast;
try {
  ast = parser.parse(code, {sourceType:"script", plugins:["jsx"], errorRecovery:false});
} catch(err){
  console.log("FAIL  parse error: " + err.message.split("\n")[0]);
  process.exit(1);
}

const offenders = new Map();
traverse(ast, {
  ReferencedIdentifier(path){
    const name = path.node.name;
    if(GLOBALS.has(name)) return;
    if(path.scope.hasBinding(name, true)) return;
    const line = path.node.loc ? path.node.loc.start.line : "?";
    if(!offenders.has(name)) offenders.set(name, []);
    if(offenders.get(name).length < 3) offenders.get(name).push(line);
  },
});

if(offenders.size){
  console.log("FAIL  " + offenders.size + " undefined name(s):");
  offenders.forEach(function(lines, name){
    console.log("  " + name + "  (jsx-source line " + lines.join(", ") + ")");
  });
  process.exit(1);
}
console.log("ok    mount smoke \u2014 no undefined names in jsx-source (" + code.length + " bytes scanned)");
process.exit(0);
