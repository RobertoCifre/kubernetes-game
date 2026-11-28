// Cada comando kubectl/aws que aparece en las chuletas funciona en el simulador (con los <marcadores> sustituidos).
// Uso: node tests/comandos-chuletas.test.js
const fs = require("fs"), path = require("path");
const RAIZ = path.join(__dirname, "..");
global.SALIDA_PRUEBAS = []; global.EDITOR_PRUEBAS = [];
global.window = {getSelection:() => ({toString:() => ""})}; global.localStorage = {getItem:() => null, setItem(){}, removeItem(){}}; global.confirm = () => true;
const html = fs.readFileSync(RAIZ + "/cluster-en-llamas.html", "utf8");
let code = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/arrancarUI\(\);\s*$/, "").replace('const $ = id => document.getElementById(id);', 'const $ = id => null;');
eval(code + "\n;global.API={get S(){return S}, irA, ejecutarLinea, reconciliar, avanzarReloj, clusterNuevo, get MODO(){return MODO}};");
const A = global.API; let m = 0;
const x = c => { m = SALIDA_PRUEBAS.length; A.ejecutarLinea(c); A.reconciliar(); return SALIDA_PRUEBAS.slice(m).map(z => z.t).join("\n"); };

// recoger comandos de los bloques de código
const cmds = [];
for (const f of fs.readdirSync(RAIZ + "/chuletas")){
  const t = fs.readFileSync(path.join(RAIZ, "chuletas", f), "utf8");
  for (const b of t.matchAll(/```(?:bash|text)?\n([\s\S]*?)```/g)){
    let prev = "";
    for (let l of b[1].split("\n")){
      if (prev){ l = prev + " " + l.trim(); prev = ""; }
      if (/\\\s*$/.test(l)){ prev = l.replace(/\\\s*$/, ""); continue; }
      l = l.replace(/\s+#\s.*$/, "").trim();
      if (/^(kubectl|k|aws) /.test(l)) cmds.push({f, l});
    }
  }
}
A.clusterNuevo(); A.irA(14); A.avanzarReloj(10); A.reconciliar();
// un entorno con de todo: namespace lab con deployment web, service, configmap, secret, sa
for (const c of ["kubectl create namespace lab", "kubectl create deployment web --image=nginx:1.27-alpine --replicas=2 -n lab", "kubectl expose deployment web --port=80 -n lab",
  "kubectl create configmap cfg --from-literal=A=1 -n lab", "kubectl create secret generic sec --from-literal=password=x -n lab", "kubectl create serviceaccount sa1 -n lab",
  "kubectl create job j1 --image=busybox:1.37 -n lab -- echo hola"]) x(c);
A.avanzarReloj(15); A.reconciliar();
const pod = A.S.pods.find(p => p.ns === "lab" && p.labels.app === "web").name;
const nodo = A.S.nodes[0].name;
const SUST = [[/<ns>|<namespace>|<NS>/g, "lab"], [/<pod>/g, pod], [/<nodo>|<node>/g, nodo], [/<dep>|<deployment>|<nombre-del-deployment>/g, "web"], [/<svc>|<servicio>|<service>/g, "web"],
  [/<sa>/g, "sa1"], [/<contenedor>|<container>/g, "nginx"], [/<rol>/g, "rol1"], [/<app>/g, "web"], [/<cluster>/g, "eks-juego"], [/<imagen:tag>|<imagen>/g, "nginx:1.27-alpine"],
  [/<N>|<n>/g, "2"], [/<puerto>/g, "80"], [/<puerto-del-contenedor>|<puerto\|nombre-del-puerto>/g, "80"], [/<porcentaje>/g, "50"], [/<CLAVE>|<clave>/g, "A"], [/<valor>/g, "1"],
  [/<i-…>|<instance-id>/g, A.S.nodes[0].id], [/<id>/g, "abc"], [/<pid>/g, "1"], [/<tipo>/g, "configmap"], [/<cuenta>/g, "123456789012"], [/<qos>/g, "burstable"],
  [/<rol-iam>|<rol>/g, "eks-quest-s3-subidor"], [/<nombre>/g, "web"], [/<tu-perfil>/g, "laboratorio"], [/<init>/g, "nginx"], [/<etiqueta>/g, "app"], [/<campo>/g, "pod.spec"], [/<ng>/g, "ng-juego"], [/<label>/g, "topology.kubernetes.io/zone"], [/<otro-ns>/g, "kube-system"], [/<insight-id>/g, "a1b2c3d4-0001-4000-8000-000000000001"], [/<arn-rol>/g, "arn:aws:iam::123456789012:role/eks-juego-node-role"]];
const RARO = /\(simulador\)(?!: el perfil| Sesión SSO)|EXCEPCI|TypeError|ReferenceError|undefined|NaN|\[object Object\]|unknown command|doesn't have a resource type|Usage:|must specify|unknown flag|invalid/i;
const vistos = new Set(); const malos = [];
for (const {f, l} of cmds){
  let c = l; for (const [re, v] of SUST) c = c.replace(re, v);
  if (vistos.has(c)) continue; vistos.add(c);
  if (/<[^>]+>/.test(c)){ malos.push({f, c, o:"(marcador sin sustituir)"}); continue; }
  let o; try { o = x(c); } catch(e){ o = "EXCEPCIÓN " + e.message; }
  while (A.MODO){ try { x("exit"); } catch(e){ break; } }
  EDITOR_PRUEBAS.length = 0;
  if (RARO.test(o)) malos.push({f, c, o});
}
console.log(`${cmds.length} comandos en chuletas · ${vistos.size} distintos · ${malos.length} con salida rara\n`);
for (const z of malos) console.log(`✗ [${z.f}] ${z.c}\n   → ${z.o.replace(/\n/g, " ⏎ ").slice(0, 230)}`);
console.log(malos.length ? malos.length + " FALLOS" : "TODO OK"); process.exitCode = malos.length ? 1 : 0;
