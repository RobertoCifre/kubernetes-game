// La shell DENTRO de un Pod (kubectl exec -it … -- sh) se comporta como la de busybox:
// variables, tuberías, for/while/if, redirecciones, red del cluster y ficheros del contenedor.
// Uso: node tests/shell.test.js
const fs = require("fs");
global.SALIDA_PRUEBAS = []; global.EDITOR_PRUEBAS = [];
global.window = {getSelection:() => ({toString:() => ""})}; global.localStorage = {getItem:() => null, setItem(){}, removeItem(){}}; global.confirm = () => true;
const html = fs.readFileSync(require("path").join(__dirname, "..", "cluster-en-llamas.html"), "utf8");
let code = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/arrancarUI\(\);\s*$/, "").replace('const $ = id => document.getElementById(id);', 'const $ = id => null;');
eval(code + "\n;global.API={get S(){return S}, irA, ejecutarLinea, reconciliar, avanzarReloj, clusterNuevo, get MODO(){return MODO}};");
const A = global.API; let m = 0, fallos = 0;
const x = c => { m = SALIDA_PRUEBAS.length; A.ejecutarLinea(c); A.reconciliar(); return SALIDA_PRUEBAS.slice(m).map(z => z.t).join("\n"); };
const ok = (c, re, msg) => { const o = x(c); const b = re.test(o); if (!b) fallos++; console.log((b ? "  ✅ " : "  ❌ ") + (msg || c) + (b ? "" : "\n     → " + o.replace(/\n/g, " ⏎ ").slice(0, 250))); };

A.clusterNuevo(); A.irA(1);
x("kubectl create namespace lab");
x("kubectl create deployment web --image=nginx:1.27-alpine -n lab");
x("kubectl create deployment caja --image=busybox:1.37 -n lab -- sleep 3600");
x("kubectl expose deployment web --port=80 -n lab");
x("kubectl set env deployment/caja COLOR=azul -n lab");
A.avanzarReloj(15); A.reconciliar();
x("kubectl exec -it deploy/caja -n lab -- sh");
ok("echo dentro", /dentro/, "se abre la shell del Pod");
ok("env | grep COLOR", /^COLOR=azul$/m);
ok("echo $COLOR", /^azul$/m);
ok("hostname", /^caja-/m);
ok("cat /etc/resolv.conf | grep nameserver", /nameserver 172\.20\.0\.10/);
ok("nslookup web", /Name:\s+web\.lab\.svc\.cluster\.local/);
ok("wget -qO- -T 2 http://web", /Welcome to nginx/);
ok("wget -qO- -T 2 http://web | grep -c nginx", /^[1-9]\d*$/m, "tubería dentro del Pod: wget | grep -c");
ok("ps", /PID\s+USER/);
ok("ps | grep -c sleep", /^[1-9]\d*$/m, "tubería: ps | grep -c");
ok("id", /uid=0\(root\)/);
ok("ls /", /bin/);
ok("ls / | head -2", /^bin\s/m, "tubería: ls | head");
ok("cat /sys/fs/cgroup/memory.max", /^max$/m);
ok("for i in 1 2 3; do echo $i; done", /^1\n2\n3$/m, "bucle for");
ok("for p in a b; do echo item-$p; done | wc -l", /^2$/m, "for con tubería");
ok("if true; then echo si; else echo no; fi", /^si$/m, "if / else");
ok("echo hola > /tmp/a; cat /tmp/a", /^hola$/m, "redirección > y cat");
ok("x=5; echo $x", /^5$/m);
x("y=7"); ok("echo $y", /^7$/m, "las variables se conservan entre líneas");
ok("ls /noexiste || echo fallo", /fallo/, "||");
ok("true && echo bien", /^bien$/m, "&&");
ok("env | grep -v PATH | grep COLOR", /^COLOR=azul$/m, "varias tuberías seguidas");
x("exit");
ok("kubectl get pods -n lab --no-headers | wc -l", /^2$/m, "tras exit se vuelve a la terminal normal");
console.log(fallos ? `${fallos} FALLOS` : "TODO OK"); process.exitCode = fallos ? 1 : 0;
