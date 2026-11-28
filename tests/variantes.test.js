// La misma orden escrita de formas distintas (todas válidas en kubectl real) da el mismo resultado:
// -n antes o después, -oyaml, -o=yaml, --output yaml, deploy/x, deployment.apps/x, -lapp=x, selectores in/notin…
// Uso: node tests/variantes.test.js
// La misma orden escrita de formas distintas (todas válidas en kubectl real) debe dar el mismo resultado.
const fs = require("fs");
global.SALIDA_PRUEBAS = []; global.EDITOR_PRUEBAS = [];
global.window = {getSelection:() => ({toString:() => ""})}; global.localStorage = {getItem:() => null, setItem(){}, removeItem(){}}; global.confirm = () => true;
const html = fs.readFileSync(require("path").join(__dirname, "..", "cluster-en-llamas.html"), "utf8");
let code = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/arrancarUI\(\);\s*$/, "").replace('const $ = id => document.getElementById(id);', 'const $ = id => null;');
eval(code + "\n;global.API={get S(){return S}, irA, ejecutarLinea, reconciliar, avanzarReloj, clusterNuevo};");
const A = global.API; let m = 0, fallos = 0;
const x = c => { m = SALIDA_PRUEBAS.length; A.ejecutarLinea(c); A.reconciliar(); return SALIDA_PRUEBAS.slice(m).map(z => z.t).join("\n"); };
const limpia = s => s.replace(/\b\d+s\b|\b\d+m\d*s?\b/g, "T").trim();
A.clusterNuevo(); A.irA(6); A.avanzarReloj(5); A.reconciliar();       // contador (4 réplicas) en nivel-6
const grupos = [
  ["kubectl get pods -n nivel-6", "kubectl get pod -n nivel-6", "kubectl get po -n nivel-6", "kubectl get pods --namespace nivel-6", "kubectl get pods --namespace=nivel-6", "kubectl get pods -n=nivel-6", "kubectl -n nivel-6 get pods", "kubectl  get   pods  -n  nivel-6", "k get pods -n nivel-6", "kgp -n nivel-6", "kubectl get pods.v1 -n nivel-6"],
  ["kubectl get deploy contador -n nivel-6", "kubectl get deployment contador -n nivel-6", "kubectl get deployments contador -n nivel-6", "kubectl get deploy/contador -n nivel-6", "kubectl get deployment.apps/contador -n nivel-6", "kubectl get deployments.apps contador -n nivel-6"],
  ["kubectl get deploy contador -n nivel-6 -o yaml", "kubectl get deploy contador -n nivel-6 -oyaml", "kubectl get deploy contador -n nivel-6 -o=yaml", "kubectl get deploy contador -n nivel-6 --output yaml", "kubectl get deploy contador -n nivel-6 --output=yaml"],
  ["kubectl get deploy contador -n nivel-6 -o jsonpath='{.spec.replicas}'", "kubectl get deploy contador -n nivel-6 -o jsonpath=\"{.spec.replicas}\"", "kubectl get deploy contador -n nivel-6 -o=jsonpath='{.spec.replicas}'", "kubectl get deploy contador -n nivel-6 -ojsonpath='{.spec.replicas}'", "kubectl get deploy contador -n nivel-6 -o jsonpath={.spec.replicas}"],
  ["kubectl describe deploy contador -n nivel-6", "kubectl describe deployment contador -n nivel-6", "kubectl describe deploy/contador -n nivel-6", "kubectl describe deployments contador -n nivel-6"],
  ["kubectl get pods -n nivel-6 -l app=contador --no-headers", "kubectl get pods -n nivel-6 --selector app=contador --no-headers", "kubectl get pods -n nivel-6 --selector=app=contador --no-headers", "kubectl get pods -n nivel-6 -lapp=contador --no-headers", "kubectl get pods -n nivel-6 -l 'app in (contador)' --no-headers"],
  ["kubectl get nodes", "kubectl get node", "kubectl get no", "kubectl get nodes.v1"],
  ["kubectl get svc -A --no-headers", "kubectl get services --all-namespaces --no-headers", "kubectl get service -A --no-headers"],
];
for (const g of grupos){
  const ref = limpia(x(g[0]));
  if (!ref || /error|not found/i.test(ref)) { fallos++; console.log("❌ referencia con error: " + g[0] + "\n   → " + ref.slice(0, 200)); continue; }
  for (const v of g.slice(1)){
    const o = limpia(x(v)); const ok = o === ref;
    if (!ok) fallos++;
    console.log((ok ? "✅ " : "❌ ") + v + (ok ? "" : "\n   esperado (como «" + g[0] + "»): " + JSON.stringify(ref.slice(0, 120)) + "\n   obtenido: " + JSON.stringify(o.slice(0, 160))));
  }
}
// cambios con formas distintas
const mut = [
  ["kubectl scale deploy contador --replicas=3 -n nivel-6", () => A.S.objs.find(o => o.kind === "Deployment" && o.metadata.name === "contador").spec.replicas === 3],
  ["kubectl scale deployment/contador --replicas 2 -n nivel-6", () => A.S.objs.find(o => o.kind === "Deployment" && o.metadata.name === "contador").spec.replicas === 2],
  ["kubectl scale --replicas=4 deployment contador -n nivel-6", () => A.S.objs.find(o => o.kind === "Deployment" && o.metadata.name === "contador").spec.replicas === 4],
  ["kubectl set image deploy/contador contador=nginx:1.28-alpine -n nivel-6", () => /1\.28/.test(A.S.objs.find(o => o.kind === "Deployment" && o.metadata.name === "contador").spec.template.spec.containers[0].image)],
  ["kubectl set image deployment contador contador=nginx:1.27-alpine -n nivel-6", () => /1\.27/.test(A.S.objs.find(o => o.kind === "Deployment" && o.metadata.name === "contador").spec.template.spec.containers[0].image)],
  ["kubectl label deploy contador equipo=a -n nivel-6", () => A.S.objs.find(o => o.kind === "Deployment" && o.metadata.name === "contador").metadata.labels.equipo === "a"],
  ["kubectl delete pod -l app=contador -n nivel-6 --wait=false", () => true],
  ["kubectl create ns pruebas-x", () => !!A.S.ns["pruebas-x"]],
  ["kubectl delete ns pruebas-x", () => !A.S.ns["pruebas-x"]],
];
for (const [c, f] of mut){ const o = x(c); A.avanzarReloj(3); A.reconciliar(); let ok = false; try { ok = f(); } catch(e){} if (!ok) fallos++; console.log((ok ? "✅ " : "❌ ") + c + (ok ? "" : "\n   → " + o.slice(0, 200))); }
console.log(fallos ? `${fallos} FALLOS` : "TODO OK"); process.exitCode = fallos ? 1 : 0;
