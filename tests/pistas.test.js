// Los comandos que aparecen en las PISTAS (💡) de cada nivel funcionan en su propio nivel.
// Uso: node tests/pistas.test.js
// Ejecuta los comandos que aparecen en las PISTAS (💡) de cada nivel, en su propio nivel.
const fs = require("fs");
global.SALIDA_PRUEBAS = []; global.EDITOR_PRUEBAS = [];
global.window = {getSelection:() => ({toString:() => ""})}; global.localStorage = {getItem:() => null, setItem(){}, removeItem(){}}; global.confirm = () => true;
const html = fs.readFileSync(require("path").join(__dirname, "..", "cluster-en-llamas.html"), "utf8");
let code = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/arrancarUI\(\);\s*$/, "").replace('const $ = id => document.getElementById(id);', 'const $ = id => null;');
eval(code + "\n;global.API={get S(){return S}, NIVELES, MAX, irA, ejecutarLinea, reconciliar, avanzarReloj, clusterNuevo, get MODO(){return MODO}};");
const A = global.API; let m = 0;
const x = c => { m = SALIDA_PRUEBAS.length; A.ejecutarLinea(c); A.reconciliar(); return SALIDA_PRUEBAS.slice(m).map(z => z.t).join("\n"); };
const RARO = /\(simulador\)(?!: el perfil| Sesión SSO| en el navegador no se abre| attach)|EXCEPCI|TypeError|ReferenceError|undefined|NaN|\[object Object\]|unknown command|doesn't have a resource type|unknown flag|unknown shorthand|command not found|sh: \S+: not found/i;
A.clusterNuevo();
let total = 0; const malos = [];
for (let id = 1; id <= A.MAX; id++){
  const n = A.NIVELES[id]; A.irA(id); A.avanzarReloj(8); A.reconciliar();
  const ns = "nivel-" + id;
  const pod = (A.S.pods.find(p => p.ns === ns && !p.efimero) || A.S.pods.find(p => !p.efimero)).name;
  const nodo = (A.S.pods.find(p => p.ns === ns && p.node) || {}).node || A.S.nodes[0].name;
  for (const pista of n.p){
    // trozos que parecen comandos: empiezan por kubectl/aws/k y acaban en «   », «→», «(» o fin
    for (const mm of pista.matchAll(/(?:^|[«:·;]\s*|\s{2,})((?:kubectl|aws) [^«»→()]+?)(?=\s{2,}|\s*→|\s*\(|\s*«|\s*$|\s+y luego|\s+y |\s*·)/g)){
      let c = mm[1].trim().replace(/[.,;]$/, "");
      c = c.replace(/<pod>/g, pod).replace(/<nodo>/g, nodo).replace(/<ns>/g, ns).replace(/<nombre>/g, "x");
      if (/…|<[^>]+>/.test(c) || c.split(/\s+/).length < 3) continue;   // huecos a propósito o solo el nombre del comando          // pistas con huecos a propósito («kubectl describe pod … -n nivel-18»)
      total++;
      let o; try { o = x(c); } catch(e){ o = "EXCEPCIÓN " + e.message; }
      while (A.MODO){ try { x("exit"); } catch(e){ break; } }
      EDITOR_PRUEBAS.length = 0;
      if (RARO.test(o)) malos.push({id, c, o});
    }
  }
}
console.log(`${total} comandos de pistas ejecutados · ${malos.length} con salida rara`);
for (const z of malos) console.log(`✗ N${z.id}: ${z.c}\n   → ${z.o.replace(/\n/g, " ⏎ ").slice(0, 220)}`);
console.log(malos.length ? malos.length + " FALLOS" : "TODO OK"); process.exitCode = malos.length ? 1 : 0;
