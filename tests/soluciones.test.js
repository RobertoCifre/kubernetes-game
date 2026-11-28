// La SOLUCIÓN que ve el jugador (botón 📖) tiene que funcionar copiándola tal cual, en los 76 niveles.
// En los niveles por tareas (examen final) tiene que sacar el 100 %.
// Uso: node tests/soluciones.test.js
const fs = require("fs");
global.SALIDA_PRUEBAS = []; global.EDITOR_PRUEBAS = [];
global.window = {getSelection:() => ({toString:() => ""})}; global.localStorage = {getItem:() => null, setItem(){}, removeItem(){}}; global.confirm = () => true;
const html = fs.readFileSync(require("path").join(__dirname, "..", "cluster-en-llamas.html"), "utf8");
let code = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/arrancarUI\(\);\s*$/, "").replace('const $ = id => document.getElementById(id);', 'const $ = id => null;');
eval(code + "\n;global.API={get S(){return S}, get P(){return P}, NIVELES, MAX, irA, ejecutarLinea, reconciliar, avanzarReloj, clusterNuevo, comprobar, get MODO(){return MODO}};");
const A = global.API; let m = 0;
const x = c => { m = SALIDA_PRUEBAS.length; A.ejecutarLinea(c); A.reconciliar(); A.comprobar(true); return SALIDA_PRUEBAS.slice(m).map(z => z.t).join("\n"); };
A.clusterNuevo();
const malos = [];
for (let id = 1; id <= A.MAX; id++){
  const n = A.NIVELES[id]; A.irA(id); A.avanzarReloj(8); A.reconciliar();
  let ultimo = ""; const saltadas = [];
  const lineas = n.sol.split("\n");
  for (let k = 0; k < lineas.length; k++){
    let l = lineas[k].trim();
    if (!l || l.startsWith("#") || l.startsWith("(")) continue;
    let alternativa = false;
    if (/^o: /.test(l)){ if (A.P.hechos[id] !== undefined) continue; alternativa = true; l = l.slice(3).trim(); }
    const pista = (l.match(/\s{2,}→\s*(.*)$/) || [])[1];
    l = l.replace(/\s{2,}(→|\(|←).*$/, "").replace(/\s+#\s.*$/, "").trim();
    if (/^kubectl edit /.test(l) && pista){
      x(l); const e = EDITOR_PRUEBAS.pop();
      if (e){ const mm = pista.match(/^([\w.]+):\s*(.*)$/); let t = e.texto;
        if (mm){ const ruta = mm[1].split("."); const clave = ruta[ruta.length - 1]; let desde = 0;
          for (const seg of ruta.slice(0, -1)){ const r = new RegExp("^\\s*-?\\s*" + seg + ":", "m"); const i = t.slice(desde).search(r); if (i >= 0) desde += i + 1; }
          const lin = t.slice(desde).split("\n"); const k = lin.findIndex(z => new RegExp("^\\s*-?\\s*" + clave + ":").test(z));
          if (k >= 0){ lin[k] = lin[k].replace(new RegExp("(" + clave + ":).*$"), "$1 " + mm[2]); t = t.slice(0, desde) + lin.join("\n"); } }
        e.alGuardar(t); A.reconciliar(); A.comprobar(true); }
      continue;
    }
    // YAML pegado tras «kubectl apply -f -   (y pega:)»
    if (/^kubectl apply -f -/.test(l) && /y pega/.test(lineas[k])){ const yaml = lineas.slice(k + 1).join("\n"); x("kubectl apply -f -"); const e = EDITOR_PRUEBAS.pop(); if (e){ e.alGuardar(yaml); A.reconciliar(); A.comprobar(true); } break; }
    // marcadores con valor deducible
    const nodoNotReady = (A.S.nodes.find(z => !z.ready) || {}).name;
    const podDe = ns => (A.S.pods.find(p => p.ns === ns && !p.efimero) || {});
    l = l.replace(/<nodo-NotReady>/g, nodoNotReady || "").replace(/<nodo>/g, (A.S.datos && A.S.datos.cka && id === 76) ? A.S.datos.cka.drenar : (A.S.datos && A.S.datos.nodosPagos ? A.S.datos.nodosPagos[0] : (podDe("nivel-" + id).node || A.S.nodes[0].name)));
    l = l.replace(/<i-…>/g, () => { const mm = ultimo.match(/i-[0-9a-f]{17}/); return mm ? mm[0] : "<i-…>"; });
    l = l.replace(/<id>/g, () => { const mm = ultimo.match(/^([0-9a-f]{13})\s/m); return mm ? mm[1] : "<id>"; });
    l = l.replace(/<pid>/g, () => { const mm = ultimo.match(/"pid": (\d+)/); return mm ? mm[1] : "<pid>"; });
    l = l.replace(/<EXTERNAL-IP>/g, () => { const mm = ultimo.match(/(\S+\.elb\.amazonaws\.com)/); return mm ? mm[1] : "<EXTERNAL-IP>"; });
    if (/^responder </.test(l)){ const r = n.resp ? n.resp() : ""; l = "responder " + r; }
    if (/<[^>]+>/.test(l)){ saltadas.push(l); continue; }
    if (/^kubectl (edit|apply)/.test(l)){ saltadas.push(l + "   [editor sin pista]"); continue; }
    ultimo = x(l);
    if (/^sleep/.test(l)) A.avanzarReloj(10);
  }
  while (A.MODO) x("exit");
  A.avanzarReloj(25); A.reconciliar(); A.comprobar(true);
  const ok = A.P.hechos[id] !== undefined && (!Array.isArray(n.tareas) || A.P.hechos[id] === 100);
  if (!ok) malos.push({id, t:n.t, saltadas, sol:n.sol});
}
console.log(`${A.MAX} niveles · se superan ejecutando la solución tal cual: ${A.MAX - malos.length}\n`);
for (const z of malos) console.log(`✗ N${z.id} ${z.t}${z.saltadas.length ? "\n   líneas no automatizables: " + z.saltadas.join(" | ") : ""}\n   SOL: ${z.sol.replace(/\n/g, " ⏎ ").slice(0, 260)}\n`);
console.log(malos.length ? malos.length + " FALLOS" : "TODO OK"); process.exitCode = malos.length ? 1 : 0;
