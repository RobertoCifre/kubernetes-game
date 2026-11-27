// Juega los 60 niveles del simulador con su solución y comprueba que ninguno empieza resuelto.
// Uso: node tests/niveles.test.js   (probado con Node 24; lee ../eks-quest.html, así que constrúyelo antes con python construir.py)
const fs = require("fs");
global.SALIDA_PRUEBAS = []; global.EDITOR_PRUEBAS = [];
global.document = undefined; global.window = {getSelection:() => ({toString:() => ""})};
global.localStorage = {getItem:() => null, setItem(){}, removeItem(){}};
global.confirm = () => true;
let code = fs.readFileSync(__dirname + "/../eks-quest.html", "utf8").match(/<script>([\s\S]*)<\/script>/)[1].replace(/arrancarUI\(\);\s*$/, "");
code = code.replace('const $ = id => document.getElementById(id);', 'const $ = id => null;');
eval(code + "\n;global.API={get S(){return S}, get P(){return P}, NIVELES, MAX, irA, ejecutarLinea, reconciliar, avanzarReloj, obj, listos, eps, comprobar, estadoDeployment, dObj, clusterNuevo, get MODO(){return MODO}};");
const A = global.API;
let fallos = 0, marca = 0;
const salida = () => { const r = SALIDA_PRUEBAS.slice(marca).map(x => x.t).join("\n"); marca = SALIDA_PRUEBAS.length; return r; };
const x = (cmd) => { marca = SALIDA_PRUEBAS.length; A.ejecutarLinea(cmd); A.reconciliar(); A.comprobar(true); return salida(); };
const ed = (f) => { const e = EDITOR_PRUEBAS.pop(); if (!e) throw new Error("no se abrió el editor"); marca = SALIDA_PRUEBAS.length; e.alGuardar(f(e.texto)); A.reconciliar(); A.comprobar(true); return salida(); };
const espera = s => { A.avanzarReloj(s); A.reconciliar(); A.comprobar(true); };
const ok = (c, m, extra) => { console.log((c ? "  ✅ " : "  ❌ ") + m + (c || !extra ? "" : "\n       ⟶ " + String(extra).slice(-400).replace(/\n/g, "\n         "))); if (!c) fallos++; };
const nodo0 = () => A.S.nodes.slice().sort((a, b) => a.name.localeCompare(b.name))[0].name;

A.clusterNuevo();
const SOL = {
  1: () => x("responder 17"),
  2: () => x("responder eu-west-1a"),
  3: () => x("kubectl create namespace mi-equipo"),
  4: () => { x("kubectl create deployment web --image=nginx:1.27-alpine --replicas=3 -n nivel-4"); return x("kubectl expose deployment web --port=80 -n nivel-4"); },
  5: () => x("kubectl scale deployment contador --replicas=5 -n nivel-5"),
  6: () => { const o = x("kubectl get pods -n nivel-6 -l tier=backend --no-headers | wc -l"); return x("responder " + o.trim()); },
  7: () => { const o = x("kubectl logs deploy/emisor -n nivel-7"); if (!/K8S-7319/.test(o)) return "logs sin código: " + o; return x("responder K8S-7319"); },
  8: () => { x("kubectl edit deployment api -n nivel-8"); return ed(t => t.replace("nginx:9.99-noexiste", "nginx:1.27-alpine")); },
  9: () => x("kubectl set image deployment/tienda tienda=nginx:1.27-alpine -n nivel-9"),
  10: () => x("kubectl create configmap app-config --from-literal=MENSAJE=hola -n nivel-10"),
  11: () => x("kubectl create secret generic db-cred --from-literal=password=MiClave123 -n nivel-11"),
  12: () => x("kubectl set resources deployment tragon --limits=memory=256Mi -n nivel-12"),
  13: () => { const l = x("kubectl logs deploy/procesador -n nivel-13 --previous"); if (!/falta la variable/.test(l)) return "logs --previous sin el error: " + l; return x("kubectl set env deployment/procesador MODO=normal -n nivel-13"); },
  14: () => x(`kubectl patch deployment reloj -n nivel-14 --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/command","value":["sleep","3600"]}]'`),
  15: () => x("kubectl set resources deployment gigante --requests=cpu=100m -n nivel-15"),
  16: () => x("kubectl set resources deployment analitica --requests=memory=64Mi -n nivel-16"),
  17: () => x("kubectl set selector service tienda app=tienda -n nivel-17"),
  18: () => { const a = x("kubectl run prueba --rm -it --image=busybox:1.37 -n nivel-18 -- wget -qO- -T 3 http://web"); if (!/refused/.test(a)) return "antes debía fallar: " + a; x("kubectl edit svc web -n nivel-18"); const r = ed(t => t.replace("targetPort: 8080", "targetPort: 80")); const b = x("kubectl run prueba --rm -it --image=busybox:1.37 -n nivel-18 -- wget -qO- -T 3 http://web"); return /Welcome/.test(b) ? r : "después no responde: " + b; },
  19: () => { x("kubectl edit deployment portal -n nivel-19"); return ed(t => t.replace("path: /salud", "path: /")); },
  20: () => { espera(20); const d = x("kubectl describe pod -l app=vigia -n nivel-20"); if (!/Liveness probe failed/.test(d)) return "describe sin el fallo de liveness: " + d.slice(-300); x("kubectl edit deployment vigia -n nivel-20"); return ed(t => t.replace(/port: 8080/, "port: 80")); },
  21: () => { x("kubectl port-forward svc/boveda 8080:80 -n nivel-21"); const c = x("curl http://localhost:8080"); if (!/PF-4096/.test(c)) return "curl sin código: " + c; return x("responder PF-4096"); },
  22: () => x("kubectl set env deployment/tienda-web API_URL=http://catalogo.nivel-22-api -n nivel-22"),
  23: () => { const r = x("kubectl run dns --rm -it --image=busybox:1.37 -n nivel-23 -- nslookup pagos"); if (!/pagos\.nivel-23\.svc\.cluster\.local/.test(r)) return "nslookup: " + r; return x("responder pagos.nivel-23.svc.cluster.local."); },
  24: () => { x("kubectl expose deployment escaparate --type=LoadBalancer --port=80 -n nivel-24"); espera(6); const g = x("kubectl get svc escaparate -n nivel-24 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'"); return x("curl http://" + g.trim()); },
  25: () => { x("kubectl set image deployment/web nginx=nginx:1.28-alpine -n nivel-25"); return x("kubectl rollout status deployment/web -n nivel-25"); },
  26: () => { const s = x("kubectl rollout status deployment/web -n nivel-26"); if (!/Waiting/.test(s)) return "rollout no estaba atascado: " + s; const pods = x("kubectl get pods -n nivel-26"); if ((pods.match(/Running/g) || []).length !== 3) return "debían quedar 3 viejos Running: " + pods; return x("kubectl rollout undo deployment/web -n nivel-26"); },
  27: () => { const h = x("kubectl rollout history deployment/app -n nivel-27"); if (!/versión inicial 1.25/.test(h)) return "historial: " + h; return x("kubectl rollout undo deployment/app --to-revision=1 -n nivel-27"); },
  28: () => { x("kubectl edit configmap saludo-config -n nivel-28"); ed(t => t.replace("MENSAJE: Hola", "MENSAJE: Bienvenido")); if (A.P.hechos[28] !== undefined) return "se superó SIN rollout restart (mal)"; x("kubectl rollout restart deployment/saludo -n nivel-28"); const l = x("kubectl logs deploy/saludo -n nivel-28"); return /Bienvenido/.test(l) ? l : "logs sin Bienvenido: " + l; },
  29: () => { const r = x("kubectl get secret credenciales -n nivel-29 -o jsonpath='{.data.password}' | base64 -d"); if (r.trim() !== "S3cr3t0-EKS") return "base64 -d dio: " + r; return x("responder S3cr3t0-EKS"); },
  30: () => { x("kubectl create job calculo --image=busybox:1.37 -n nivel-30 -- echo 42"); const l = x("kubectl logs job/calculo -n nivel-30"); return /42/.test(l) ? l : "logs del job: " + l; },
  31: () => x('kubectl create cronjob limpieza --image=busybox:1.37 --schedule="0 3 * * *" -n nivel-31 -- echo limpiando'),
  32: () => { const o = x("kubectl get pods -n kube-system --no-headers | grep kube-proxy | wc -l"); return x("responder " + o.trim()); },
  33: () => { const q = x("kubectl get pods -n nivel-33 -l app=plata -o jsonpath='{.items[0].status.qosClass}'"); if (q.trim() !== "Burstable") return "qosClass: " + q; return x("responder burstable"); },
  34: () => x("kubectl autoscale deployment web --min=1 --max=4 --cpu-percent=50 -n nivel-34"),
  35: () => { const d = x("kubectl describe hpa api -n nivel-35"); if (!/missing request for cpu/.test(d)) return "describe hpa: " + d.slice(-300); return x("kubectl set resources deployment api --requests=cpu=50m -n nivel-35"); },
  36: () => { const e = x("kubectl get events -n nivel-36"); if (!/exceeded quota/.test(e)) return "eventos sin exceeded quota: " + e.slice(-300); x("kubectl edit resourcequota limite-pods -n nivel-36"); return ed(t => t.replace(/pods: "2"/, 'pods: "4"')); },
  37: () => { const d = x("kubectl describe pod -n nivel-37 | grep -c 'Too many pods'"); if (!(parseInt(d) >= 1)) return "sin Too many pods: " + d; x("aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego --scaling-config minSize=1,maxSize=2,desiredSize=2"); espera(10); return x("kubectl get nodes"); },
  38: () => x("kubectl taint nodes --all mantenimiento-"),
  39: () => x("kubectl label node " + nodo0() + " hardware=gpu"),
  40: () => x("kubectl drain " + nodo0() + " --ignore-daemonsets --delete-emptydir-data"),
  41: () => { const c = x("aws sts get-caller-identity --query Account --output text"); return x("responder " + c.trim()); },
  42: () => { x("kubectl create role ver-pods --verb=get,list,watch --resource=pods -n nivel-42"); x("kubectl create rolebinding lector-ver-pods --role=ver-pods --serviceaccount=nivel-42:lector -n nivel-42"); return x("kubectl auth can-i list pods -n nivel-42 --as=system:serviceaccount:nivel-42:lector"); },
  43: () => { x("kubectl delete rolebinding bot-todo -n nivel-43"); return x("kubectl create rolebinding bot-lectura --clusterrole=view --serviceaccount=nivel-43:bot -n nivel-43"); },
  44: () => { x("kubectl apply -f -"); return ed(() => "apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: permitir-cliente\n  namespace: nivel-44\nspec:\n  podSelector:\n    matchLabels:\n      app: web\n  policyTypes: [\"Ingress\"]\n  ingress:\n  - from:\n    - podSelector:\n        matchLabels:\n          app: cliente\n"); },
  45: () => { const e = x("kubectl get events -n nivel-45"); if (!/violates PodSecurity/.test(e)) return "eventos sin PodSecurity: " + e.slice(-300); x("kubectl apply -f -"); return ed(() => A.NIVELES[45].sol.split("(y pega:)\n")[1]); },
  46: () => { const v = x("aws eks describe-cluster --name eks-juego --query cluster.version --output text"); return x("responder v" + v.trim()); },
  47: () => { const d1 = x("kubectl drain " + A.S.datos.nodosPagos[0] + " --ignore-daemonsets --delete-emptydir-data"); if (!/disruption budget/.test(d1)) return "el drain debía bloquearse: " + d1; x("kubectl uncordon " + A.S.datos.nodosPagos[0]); x("kubectl scale deployment pagos --replicas=3 -n nivel-47"); return x("kubectl drain " + A.S.datos.nodosPagos[0] + " --ignore-daemonsets --delete-emptydir-data"); },
  48: () => { const n = A.S.nodes.find(z => z.roto); const d = x("kubectl describe node " + n.name + " | grep ProviderID"); const id = d.trim().split("/").pop(); x("aws ec2 terminate-instances --instance-ids " + id); espera(15); return x("kubectl get nodes"); },
  49: () => { const r = x("kubectl run dns --rm -it --image=busybox:1.37 -n nivel-49 -- nslookup kubernetes.default"); if (!/timed out/.test(r)) return "debía fallar el DNS: " + r; return x("kubectl scale deployment coredns --replicas=2 -n kube-system"); },
  50: () => { x("kubectl set image deployment/api-precios nginx=nginx:1.27-alpine -n nivel-50"); x("kubectl set selector service api-precios app=api-precios -n nivel-50"); return x("kubectl set env deployment/tienda-web API_URL=http://api-precios -n nivel-50"); },
  51: () => { x("kubectl exec -it deploy/web -n nivel-51 -- sh"); const p = x("ps"); x("exit"); if (!/^\s+1 root\s+0:00 nginx: master process/m.test(p)) return "ps sin el PID 1 de nginx: " + p;
              const c = x("kubectl exec deploy/web -n nivel-51 -- cat /proc/1/cmdline"); if (!/nginx -g daemon off;/.test(c)) return "cmdline: " + c; return x("responder nginx"); },
  52: () => { const ls = x("kubectl exec deploy/api -n nivel-52 -- ls /sys/fs/cgroup"); if (!/memory\.max/.test(ls)) return "ls cgroup: " + ls;
              const m = x("kubectl exec deploy/api -n nivel-52 -- cat /sys/fs/cgroup/memory.max"); if (m.trim() !== "201326592") return "memory.max: " + m;
              const w = x("kubectl exec deploy/api -n nivel-52 -- cat /sys/fs/cgroup/cpu.weight"); if (w.trim() !== "4") return "cpu.weight (100m → 4): " + w;
              return x("responder " + m.trim()); },
  53: () => { const c = x("kubectl exec deploy/calc -n nivel-53 -- cat /sys/fs/cgroup/cpu.max"); if (c.trim() !== "30000 100000") return "cpu.max: " + c;
              const st = x("kubectl exec deploy/calc -n nivel-53 -- cat /sys/fs/cgroup/cpu.stat"); if (!/nr_throttled 0/.test(st)) return "cpu.stat: " + st;
              return x("responder 30000"); },
  54: () => { const n = x("kubectl exec deploy/normal -n nivel-54 -- cat /proc/1/status"); if (!/CapEff:\s+00000000a80425fb/.test(n) || !/Uid:\s+0\s/.test(n)) return "status normal: " + n;
              const b = x("kubectl exec deploy/blindado -n nivel-54 -- cat /proc/1/status"); if (!/CapEff:\s+0000000000000000/.test(b) || !/CapBnd:\s+0000000000000000/.test(b) || !/Uid:\s+101\s/.test(b) || !/NoNewPrivs:\s+1/.test(b)) return "status blindado: " + b;
              const i = x("kubectl exec deploy/blindado -n nivel-54 -- id"); if (!/uid=101\(nginx\)/.test(i)) return "id: " + i;
              return x("responder 00000000a80425fb"); },
  55: () => { const a = x("kubectl exec deploy/web -n nivel-55 -- ls /var/run/secrets/kubernetes.io/serviceaccount"); if (!/token/.test(a)) return "antes debía haber token: " + a;
              x(`kubectl patch serviceaccount default -n nivel-55 -p '{"automountServiceAccountToken":false}'`); espera(2);
              if (A.P.hechos[55] !== undefined) return "se superó SIN recrear los Pods (mal: el token se decide al crearlos)";
              const b = x("kubectl exec deploy/web -n nivel-55 -- cat /var/run/secrets/kubernetes.io/serviceaccount/namespace"); if (!/nivel-55/.test(b)) return "el Pod viejo debía conservar el token: " + b;
              x("kubectl rollout restart deployment web -n nivel-55"); espera(15);
              const c = x("kubectl exec deploy/web -n nivel-55 -- ls /var/run/secrets/kubernetes.io/serviceaccount"); return /No such file/.test(c) ? c : "después NO debía haber token: " + c; },
  56: () => { espera(5); const g = x("kubectl get pods -n nivel-56 -l app=app"); if (!/Init:0\/1/.test(g)) return "debía estar en Init:0/1: " + g;
              const l = x("kubectl logs deploy/app -c espera-bd -n nivel-56"); if (!/esperando a bd/.test(l) || !/NXDOMAIN/.test(l)) return "logs del init: " + l;
              const d = x("kubectl describe pod -l app=app -n nivel-56"); if (!/Init Containers:\n  espera-bd:/.test(d)) return "describe sin Init Containers: " + d.slice(0, 900);
              const sin = x("kubectl logs deploy/app -n nivel-56"); if (!/PodInitializing/.test(sin)) return "logs sin -c debía avisar de PodInitializing: " + sin;
              x("kubectl expose deployment bd --port=80 -n nivel-56"); espera(5); return x("kubectl get pods -n nivel-56"); },
  57: () => { const ds = x("kubectl get ds -n kube-system"); if (!/eks-pod-identity-agent/.test(ds)) return "falta el DaemonSet del agente: " + ds;
              const c = x("aws eks create-pod-identity-association --cluster-name eks-juego --namespace nivel-57 --service-account subidor --role-arn arn:aws:iam::123456789012:role/eks-quest-s3-subidor");
              if (!/associationId/.test(c)) return "create: " + c; espera(2);
              if (A.P.hechos[57] !== undefined) return "se superó SIN recrear los Pods (mal)";
              const l = x("aws eks list-pod-identity-associations --cluster-name eks-juego"); if (!/subidor/.test(l)) return "list: " + l;
              x("kubectl rollout restart deployment subidor -n nivel-57"); espera(15);
              const e = x("kubectl exec deploy/subidor -n nivel-57 -- env | grep AWS_"); return /AWS_CONTAINER_CREDENTIALS_FULL_URI=http:\/\/169\.254\.170\.23\/v1\/credentials/.test(e) ? e : "env sin Pod Identity: " + e; },
  58: () => { const e = x("kubectl exec deploy/minimo -n nivel-58 -- sh"); if (!/executable file not found/.test(e)) return "exec debía fallar: " + e;
              x("kubectl debug -it deploy/minimo -n nivel-58 --image=busybox:1.37 --target=minimo"); const p = x("ps"); const st = x("cat /proc/1/status"); x("exit");
              if (!/^\s+1 65535\s+0:00 \/pause/m.test(p)) return "ps sin /pause: " + p; if (!/Uid:\s+65535/.test(st)) return "status del objetivo: " + st;
              x("kubectl debug -it deploy/minimo -n nivel-58 --image=busybox:1.37"); const p2 = x("ps"); x("exit"); if (/pause/.test(p2)) return "sin --target NO debía verse /pause: " + p2;
              return x("responder /pause"); },
  59: () => { x("kubectl create clusterrolebinding atajo --clusterrole=view --serviceaccount=nivel-59:auditor"); espera(1);
              if (A.P.hechos[59] !== undefined) return "se superó con el ClusterRole view (da demasiado)";
              x("kubectl delete clusterrolebinding atajo");
              x("kubectl create clusterrole ver-pods-global --verb=get,list,watch --resource=pods");
              const b = x("kubectl create clusterrolebinding auditor-ver-pods --clusterrole=ver-pods-global --serviceaccount=nivel-59:auditor");
              const si = x("kubectl auth can-i list pods -A --as=system:serviceaccount:nivel-59:auditor"); const no = x("kubectl auth can-i list secrets -n kube-system --as=system:serviceaccount:nivel-59:auditor");
              const g = x("kubectl get clusterrolebindings"); if (!/auditor-ver-pods\s+ClusterRole\/ver-pods-global/.test(g)) return "get crb: " + g;
              return /^yes/m.test(si) && /^no/m.test(no) ? b : `can-i: ${si} / ${no}`; },
  60: () => { espera(5); const g1 = x("kubectl get pods -n nivel-60 -l app=pedidos"); if (!/Init:0\/1/.test(g1)) return "1º debía estar en Init: " + g1;
              const l = x("kubectl logs deploy/pedidos -c espera-cola -n nivel-60"); if (!/esperando a cola/.test(l)) return "logs init: " + l;
              x("kubectl expose deployment cola --port=8080 -n nivel-60"); espera(5);
              const g2 = x("kubectl get pods -n nivel-60 -l app=pedidos"); if (!/CreateContainerConfigError/.test(g2)) return "2º debía faltar el Secret: " + g2;
              x("kubectl create secret generic cola-cred --from-literal=password=s3cret0 -n nivel-60"); espera(10);
              const g3 = x("kubectl get pods -n nivel-60 -l app=pedidos"); if (!/0\/1\s+Running/.test(g3)) return "3º debía estar Running 0/1: " + g3;
              x(`kubectl patch deployment pedidos -n nivel-60 --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'`); espera(20);
              return x("kubectl get pods -n nivel-60"); },
};
for (let id = 1; id <= A.MAX; id++){
  const n = A.NIVELES[id];
  A.irA(id); salida();
  if (n.tipo === "mision"){ let pre = false; try { pre = n.ok(); } catch(e){} ok(!pre, `N${id} ${n.t}: NO está resuelto al empezar`); if (pre) continue; }
  let r; try { r = SOL[id](); } catch(e){ r = "EXCEPCIÓN: " + e.stack; }
  espera(1);
  ok(A.P.hechos[id] !== undefined, `N${id} ${n.t}: se supera con la solución`, r);
}
console.log(`\n${A.MAX} niveles · superados: ${Object.keys(A.P.hechos).length} · XP: ${Object.values(A.P.hechos).reduce((a, b) => a + b, 0)}`);
console.log(fallos ? `${fallos} FALLOS` : "TODO OK"); process.exitCode = fallos ? 1 : 0;
