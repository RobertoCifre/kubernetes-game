// Juega los 76 niveles del simulador con su solución y comprueba que ninguno empieza resuelto.
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
const FALLO = "✗ ";
const SOL = {
  1: () => { const o = x("kubectl get deployments -n nivel-1"); if (!/hola/.test(o)) return FALLO + "get deploy: " + o; return x("responder hola"); },
  2: () => { const o = x("kubectl get pods -n nivel-2"); const m = o.match(/saludo-\S+/); if (!m) return FALLO + "get pods: " + o; return x("responder " + m[0]); },
  3: () => { const o = x("kubectl get svc -n nivel-3"); if (!/entrada/.test(o)) return FALLO + "get svc: " + o; return x("responder entrada"); },
  4: () => { const o = x("kubectl describe deployment tienda -n nivel-4"); if (!/Image:\s+nginx:1\.26-alpine/.test(o)) return FALLO + "describe: " + o; return x("responder nginx:1.26-alpine"); },
  5: () => { const o = x("kubectl get svc -n nivel-5"); if (!/8080\/TCP/.test(o)) return FALLO + "get svc: " + o; return x("responder 8080"); },
  6: () => { const o = x("kubectl get pods -n nivel-6 --no-headers | wc -l"); if (o.trim() !== "4") return FALLO + "wc: " + o; return x("responder 4"); },
  7: () => x("responder 17"),
  8: () => x("responder eu-west-1a"),
  9: () => x("kubectl create namespace mi-equipo"),
  10: () => { x("kubectl create deployment web --image=nginx:1.27-alpine --replicas=3 -n nivel-10"); return x("kubectl expose deployment web --port=80 -n nivel-10"); },
  11: () => x("kubectl scale deployment contador --replicas=5 -n nivel-11"),
  12: () => { const o = x("kubectl get pods -n nivel-12 -l tier=backend --no-headers | wc -l"); return x("responder " + o.trim()); },
  13: () => { const o = x("kubectl logs deploy/emisor -n nivel-13"); if (!/K8S-7319/.test(o)) return FALLO + "logs sin código: " + o; return x("responder K8S-7319"); },
  14: () => { x("kubectl edit deployment api -n nivel-14"); return ed(t => t.replace("nginx:9.99-noexiste", "nginx:1.27-alpine")); },
  15: () => x("kubectl set image deployment/tienda tienda=nginx:1.27-alpine -n nivel-15"),
  16: () => x("kubectl create configmap app-config --from-literal=MENSAJE=hola -n nivel-16"),
  17: () => x("kubectl create secret generic db-cred --from-literal=password=MiClave123 -n nivel-17"),
  18: () => x("kubectl set resources deployment tragon --limits=memory=256Mi -n nivel-18"),
  19: () => { const l = x("kubectl logs deploy/procesador -n nivel-19 --previous"); if (!/falta la variable/.test(l)) return FALLO + "logs --previous sin el error: " + l; return x("kubectl set env deployment/procesador MODO=normal -n nivel-19"); },
  20: () => x(`kubectl patch deployment reloj -n nivel-20 --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/command","value":["sleep","3600"]}]'`),
  21: () => x("kubectl set resources deployment gigante --requests=cpu=100m -n nivel-21"),
  22: () => x("kubectl set resources deployment analitica --requests=memory=64Mi -n nivel-22"),
  23: () => x("kubectl set selector service tienda app=tienda -n nivel-23"),
  24: () => { const a = x("kubectl run prueba --rm -it --image=busybox:1.37 -n nivel-24 -- wget -qO- -T 3 http://web"); if (!/refused/.test(a)) return FALLO + "antes debía fallar: " + a; x("kubectl edit svc web -n nivel-24"); const r = ed(t => t.replace("targetPort: 8080", "targetPort: 80")); const b = x("kubectl run prueba --rm -it --image=busybox:1.37 -n nivel-24 -- wget -qO- -T 3 http://web"); return /Welcome/.test(b) ? r : FALLO + "después no responde: " + b; },
  25: () => { x("kubectl edit deployment portal -n nivel-25"); return ed(t => t.replace("path: /salud", "path: /")); },
  26: () => { espera(20); const d = x("kubectl describe pod -l app=vigia -n nivel-26"); if (!/Liveness probe failed/.test(d)) return FALLO + "describe sin el fallo de liveness: " + d.slice(-300); x("kubectl edit deployment vigia -n nivel-26"); return ed(t => t.replace(/port: 8080/, "port: 80")); },
  27: () => { x("kubectl port-forward svc/boveda 8080:80 -n nivel-27"); const c = x("curl http://localhost:8080"); if (!/PF-4096/.test(c)) return FALLO + "curl sin código: " + c; return x("responder PF-4096"); },
  28: () => x("kubectl set env deployment/tienda-web API_URL=http://catalogo.nivel-28-api -n nivel-28"),
  29: () => { const r = x("kubectl run dns --rm -it --image=busybox:1.37 -n nivel-29 -- nslookup pagos"); if (!/pagos\.nivel-29\.svc\.cluster\.local/.test(r)) return FALLO + "nslookup: " + r; return x("responder pagos.nivel-29.svc.cluster.local."); },
  30: () => { x("kubectl expose deployment escaparate --type=LoadBalancer --port=80 -n nivel-30"); espera(6); const g = x("kubectl get svc escaparate -n nivel-30 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'"); return x("curl http://" + g.trim()); },
  31: () => { x("kubectl set image deployment/web nginx=nginx:1.28-alpine -n nivel-31"); return x("kubectl rollout status deployment/web -n nivel-31"); },
  32: () => { const s = x("kubectl rollout status deployment/web -n nivel-32"); if (!/Waiting/.test(s)) return FALLO + "rollout no estaba atascado: " + s; const pods = x("kubectl get pods -n nivel-32"); if ((pods.match(/Running/g) || []).length !== 3) return FALLO + "debían quedar 3 viejos Running: " + pods; return x("kubectl rollout undo deployment/web -n nivel-32"); },
  33: () => { const h = x("kubectl rollout history deployment/app -n nivel-33"); if (!/versión inicial 1.25/.test(h)) return FALLO + "historial: " + h; return x("kubectl rollout undo deployment/app --to-revision=1 -n nivel-33"); },
  34: () => { x("kubectl edit configmap saludo-config -n nivel-34"); ed(t => t.replace("MENSAJE: Hola", "MENSAJE: Bienvenido")); if (A.P.hechos[34] !== undefined) return FALLO + "se superó SIN rollout restart (mal)"; x("kubectl rollout restart deployment/saludo -n nivel-34"); const l = x("kubectl logs deploy/saludo -n nivel-34"); return /Bienvenido/.test(l) ? l : FALLO + "logs sin Bienvenido: " + l; },
  35: () => { const r = x("kubectl get secret credenciales -n nivel-35 -o jsonpath='{.data.password}' | base64 -d"); if (r.trim() !== "S3cr3t0-EKS") return FALLO + "base64 -d dio: " + r; return x("responder S3cr3t0-EKS"); },
  36: () => { x("kubectl create job calculo --image=busybox:1.37 -n nivel-36 -- echo 42"); const l = x("kubectl logs job/calculo -n nivel-36"); return /42/.test(l) ? l : FALLO + "logs del job: " + l; },
  37: () => x('kubectl create cronjob limpieza --image=busybox:1.37 --schedule="0 3 * * *" -n nivel-37 -- echo limpiando'),
  38: () => { const o = x("kubectl get pods -n kube-system --no-headers | grep kube-proxy | wc -l"); return x("responder " + o.trim()); },
  39: () => { const q = x("kubectl get pods -n nivel-39 -l app=plata -o jsonpath='{.items[0].status.qosClass}'"); if (q.trim() !== "Burstable") return FALLO + "qosClass: " + q; return x("responder burstable"); },
  40: () => x("kubectl autoscale deployment web --min=1 --max=4 --cpu-percent=50 -n nivel-40"),
  41: () => { const d = x("kubectl describe hpa api -n nivel-41"); if (!/missing request for cpu/.test(d)) return FALLO + "describe hpa: " + d.slice(-300); return x("kubectl set resources deployment api --requests=cpu=50m -n nivel-41"); },
  42: () => { const e = x("kubectl get events -n nivel-42"); if (!/exceeded quota/.test(e)) return FALLO + "eventos sin exceeded quota: " + e.slice(-300); x("kubectl edit resourcequota limite-pods -n nivel-42"); return ed(t => t.replace(/pods: "2"/, 'pods: "4"')); },
  43: () => { const d = x("kubectl describe pod -n nivel-43 | grep -c 'Too many pods'"); if (!(parseInt(d) >= 1)) return FALLO + "sin Too many pods: " + d; x("aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego --scaling-config minSize=1,maxSize=2,desiredSize=2"); espera(10); return x("kubectl get nodes"); },
  44: () => x("kubectl taint nodes --all mantenimiento-"),
  45: () => x("kubectl label node " + nodo0() + " hardware=gpu"),
  46: () => x("kubectl drain " + nodo0() + " --ignore-daemonsets --delete-emptydir-data"),
  47: () => { const c = x("aws sts get-caller-identity --query Account --output text"); return x("responder " + c.trim()); },
  48: () => { x("kubectl create role ver-pods --verb=get,list,watch --resource=pods -n nivel-48"); x("kubectl create rolebinding lector-ver-pods --role=ver-pods --serviceaccount=nivel-48:lector -n nivel-48"); return x("kubectl auth can-i list pods -n nivel-48 --as=system:serviceaccount:nivel-48:lector"); },
  49: () => { x("kubectl delete rolebinding bot-todo -n nivel-49"); return x("kubectl create rolebinding bot-lectura --clusterrole=view --serviceaccount=nivel-49:bot -n nivel-49"); },
  50: () => { x("kubectl apply -f -"); return ed(() => "apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: permitir-cliente\n  namespace: nivel-50\nspec:\n  podSelector:\n    matchLabels:\n      app: web\n  policyTypes: [\"Ingress\"]\n  ingress:\n  - from:\n    - podSelector:\n        matchLabels:\n          app: cliente\n"); },
  51: () => { const e = x("kubectl get events -n nivel-51"); if (!/violates PodSecurity/.test(e)) return FALLO + "eventos sin PodSecurity: " + e.slice(-300); x("kubectl apply -f -"); return ed(() => A.NIVELES[51].sol.split("(y pega:)\n")[1]); },
  52: () => { const v = x("aws eks describe-cluster --name eks-juego --query cluster.version --output text"); return x("responder v" + v.trim()); },
  53: () => { const d1 = x("kubectl drain " + A.S.datos.nodosPagos[0] + " --ignore-daemonsets --delete-emptydir-data"); if (!/disruption budget/.test(d1)) return FALLO + "el drain debía bloquearse: " + d1; x("kubectl uncordon " + A.S.datos.nodosPagos[0]); x("kubectl scale deployment pagos --replicas=3 -n nivel-53"); return x("kubectl drain " + A.S.datos.nodosPagos[0] + " --ignore-daemonsets --delete-emptydir-data"); },
  54: () => { const n = A.S.nodes.find(z => z.roto); const d = x("kubectl describe node " + n.name + " | grep ProviderID"); const id = d.trim().split("/").pop(); x("aws ec2 terminate-instances --instance-ids " + id); espera(15); return x("kubectl get nodes"); },
  55: () => { const r = x("kubectl run dns --rm -it --image=busybox:1.37 -n nivel-55 -- nslookup kubernetes.default"); if (!/timed out/.test(r)) return FALLO + "debía fallar el DNS: " + r; return x("kubectl scale deployment coredns --replicas=2 -n kube-system"); },
  56: () => { x("kubectl set image deployment/api-precios nginx=nginx:1.27-alpine -n nivel-56"); x("kubectl set selector service api-precios app=api-precios -n nivel-56"); return x("kubectl set env deployment/tienda-web API_URL=http://api-precios -n nivel-56"); },
  57: () => { x("kubectl exec -it deploy/web -n nivel-57 -- sh"); const p = x("ps"); x("exit"); if (!/^\s+1 root\s+0:00 nginx: master process/m.test(p)) return FALLO + "ps sin el PID 1 de nginx: " + p;
              const c = x("kubectl exec deploy/web -n nivel-57 -- cat /proc/1/cmdline"); if (!/nginx -g daemon off;/.test(c)) return FALLO + "cmdline: " + c; return x("responder nginx"); },
  58: () => { const ls = x("kubectl exec deploy/api -n nivel-58 -- ls /sys/fs/cgroup"); if (!/memory\.max/.test(ls)) return FALLO + "ls cgroup: " + ls;
              const m = x("kubectl exec deploy/api -n nivel-58 -- cat /sys/fs/cgroup/memory.max"); if (m.trim() !== "201326592") return FALLO + "memory.max: " + m;
              const w = x("kubectl exec deploy/api -n nivel-58 -- cat /sys/fs/cgroup/cpu.weight"); if (w.trim() !== "4") return FALLO + "cpu.weight (100m → 4): " + w;
              return x("responder " + m.trim()); },
  59: () => { const c = x("kubectl exec deploy/calc -n nivel-59 -- cat /sys/fs/cgroup/cpu.max"); if (c.trim() !== "30000 100000") return FALLO + "cpu.max: " + c;
              const st = x("kubectl exec deploy/calc -n nivel-59 -- cat /sys/fs/cgroup/cpu.stat"); if (!/nr_throttled 0/.test(st)) return FALLO + "cpu.stat: " + st;
              return x("responder 30000"); },
  60: () => { const n = x("kubectl exec deploy/normal -n nivel-60 -- cat /proc/1/status"); if (!/CapEff:\s+00000000a80425fb/.test(n) || !/Uid:\s+0\s/.test(n)) return FALLO + "status normal: " + n;
              const b = x("kubectl exec deploy/blindado -n nivel-60 -- cat /proc/1/status"); if (!/CapEff:\s+0000000000000000/.test(b) || !/CapBnd:\s+0000000000000000/.test(b) || !/Uid:\s+101\s/.test(b) || !/NoNewPrivs:\s+1/.test(b)) return FALLO + "status blindado: " + b;
              const i = x("kubectl exec deploy/blindado -n nivel-60 -- id"); if (!/uid=101\(nginx\)/.test(i)) return FALLO + "id: " + i;
              return x("responder 00000000a80425fb"); },
  61: () => { const a = x("kubectl exec deploy/web -n nivel-61 -- ls /var/run/secrets/kubernetes.io/serviceaccount"); if (!/token/.test(a)) return FALLO + "antes debía haber token: " + a;
              x(`kubectl patch serviceaccount default -n nivel-61 -p '{"automountServiceAccountToken":false}'`); espera(2);
              if (A.P.hechos[61] !== undefined) return FALLO + "se superó SIN recrear los Pods (mal: el token se decide al crearlos)";
              const b = x("kubectl exec deploy/web -n nivel-61 -- cat /var/run/secrets/kubernetes.io/serviceaccount/namespace"); if (!/nivel-61/.test(b)) return FALLO + "el Pod viejo debía conservar el token: " + b;
              x("kubectl rollout restart deployment web -n nivel-61"); espera(15);
              const c = x("kubectl exec deploy/web -n nivel-61 -- ls /var/run/secrets/kubernetes.io/serviceaccount"); return /No such file/.test(c) ? c : FALLO + "después NO debía haber token: " + c; },
  62: () => { espera(5); const g = x("kubectl get pods -n nivel-62 -l app=app"); if (!/Init:0\/1/.test(g)) return FALLO + "debía estar en Init:0/1: " + g;
              const l = x("kubectl logs deploy/app -c espera-bd -n nivel-62"); if (!/esperando a bd/.test(l) || !/NXDOMAIN/.test(l)) return FALLO + "logs del init: " + l;
              const d = x("kubectl describe pod -l app=app -n nivel-62"); if (!/Init Containers:\n  espera-bd:/.test(d)) return FALLO + "describe sin Init Containers: " + d.slice(0, 900);
              const sin = x("kubectl logs deploy/app -n nivel-62"); if (!/PodInitializing/.test(sin)) return FALLO + "logs sin -c debía avisar de PodInitializing: " + sin;
              x("kubectl expose deployment bd --port=80 -n nivel-62"); espera(5); return x("kubectl get pods -n nivel-62"); },
  63: () => { const ds = x("kubectl get ds -n kube-system"); if (!/eks-pod-identity-agent/.test(ds)) return FALLO + "falta el DaemonSet del agente: " + ds;
              const c = x("aws eks create-pod-identity-association --cluster-name eks-juego --namespace nivel-63 --service-account subidor --role-arn arn:aws:iam::123456789012:role/eks-quest-s3-subidor");
              if (!/associationId/.test(c)) return FALLO + "create: " + c; espera(2);
              if (A.P.hechos[63] !== undefined) return FALLO + "se superó SIN recrear los Pods (mal)";
              const l = x("aws eks list-pod-identity-associations --cluster-name eks-juego"); if (!/subidor/.test(l)) return FALLO + "list: " + l;
              x("kubectl rollout restart deployment subidor -n nivel-63"); espera(15);
              const e = x("kubectl exec deploy/subidor -n nivel-63 -- env | grep AWS_"); return /AWS_CONTAINER_CREDENTIALS_FULL_URI=http:\/\/169\.254\.170\.23\/v1\/credentials/.test(e) ? e : FALLO + "env sin Pod Identity: " + e; },
  64: () => { const e = x("kubectl exec deploy/minimo -n nivel-64 -- sh"); if (!/executable file not found/.test(e)) return FALLO + "exec debía fallar: " + e;
              x("kubectl debug -it deploy/minimo -n nivel-64 --image=busybox:1.37 --target=minimo"); const p = x("ps"); const st = x("cat /proc/1/status"); x("exit");
              if (!/^\s+1 65535\s+0:00 \/pause/m.test(p)) return FALLO + "ps sin /pause: " + p; if (!/Uid:\s+65535/.test(st)) return FALLO + "status del objetivo: " + st;
              x("kubectl debug -it deploy/minimo -n nivel-64 --image=busybox:1.37"); const p2 = x("ps"); x("exit"); if (/pause/.test(p2)) return FALLO + "sin --target NO debía verse /pause: " + p2;
              return x("responder /pause"); },
  65: () => { x("kubectl create clusterrolebinding atajo --clusterrole=view --serviceaccount=nivel-65:auditor"); espera(1);
              if (A.P.hechos[65] !== undefined) return FALLO + "se superó con el ClusterRole view (da demasiado)";
              x("kubectl delete clusterrolebinding atajo");
              x("kubectl create clusterrole ver-pods-global --verb=get,list,watch --resource=pods");
              const b = x("kubectl create clusterrolebinding auditor-ver-pods --clusterrole=ver-pods-global --serviceaccount=nivel-65:auditor");
              const si = x("kubectl auth can-i list pods -A --as=system:serviceaccount:nivel-65:auditor"); const no = x("kubectl auth can-i list secrets -n kube-system --as=system:serviceaccount:nivel-65:auditor");
              const g = x("kubectl get clusterrolebindings"); if (!/auditor-ver-pods\s+ClusterRole\/ver-pods-global/.test(g)) return FALLO + "get crb: " + g;
              return /^yes/m.test(si) && /^no/m.test(no) ? b : FALLO + `can-i: ${si} / ${no}`; },
  66: () => { espera(5); const g1 = x("kubectl get pods -n nivel-66 -l app=pedidos"); if (!/Init:0\/1/.test(g1)) return FALLO + "1º debía estar en Init: " + g1;
              const l = x("kubectl logs deploy/pedidos -c espera-cola -n nivel-66"); if (!/esperando a cola/.test(l)) return FALLO + "logs init: " + l;
              x("kubectl expose deployment cola --port=8080 -n nivel-66"); espera(5);
              const g2 = x("kubectl get pods -n nivel-66 -l app=pedidos"); if (!/CreateContainerConfigError/.test(g2)) return FALLO + "2º debía faltar el Secret: " + g2;
              x("kubectl create secret generic cola-cred --from-literal=password=s3cret0 -n nivel-66"); espera(10);
              const g3 = x("kubectl get pods -n nivel-66 -l app=pedidos"); if (!/0\/1\s+Running/.test(g3)) return FALLO + "3º debía estar Running 0/1: " + g3;
              x(`kubectl patch deployment pedidos -n nivel-66 --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'`); espera(20);
              return x("kubectl get pods -n nivel-66"); },
  67: () => { const o = x("kubectl get pods -n nivel-67 -o wide"); const m = o.match(/eco-\S+\s+1\/1\s+Running\s+\S+\s+\S+\s+(10\.\d+\.\d+\.\d+)/); if (!m) return FALLO + "get -o wide: " + o;
              const h = x("kubectl exec deploy/eco -n nivel-67 -- hostname -i"); if (h.trim() !== m[1]) return FALLO + "hostname -i: " + h; return x("responder " + m[1]); },
  68: () => { espera(8); const e = x("kubectl get endpoints tienda -n nivel-68"); if ((e.match(/10\.\d+\.\d+\.\d+:80/g) || []).length !== 2) return FALLO + "endpoints: " + e;
              const g = x("kubectl get pods -n nivel-68 -l rol=tienda"); if (!/0\/1/.test(g)) return FALLO + "un Pod debía estar 0/1: " + g; return x("responder 2"); },
  69: () => { const r = x("kubectl exec deploy/cliente -n nivel-69 -- cat /etc/resolv.conf"); if (!/nameserver 172\.20\.0\.10/.test(r) || !/ndots:5/.test(r)) return FALLO + "resolv.conf: " + r;
              const s = x("kubectl get svc -A | grep 172.20.0.10"); if (!/kube-dns/.test(s)) return FALLO + "svc: " + s; return x("responder kube-dns"); },
  70: () => { espera(6); const g = x("kubectl get pods -n nivel-70"); if (!/1\/2/.test(g)) return FALLO + "debía estar 1/2: " + g;
              const l = x("kubectl logs deploy/web -c vigia -n nivel-70 --tail=2"); if (!/FALLO http:\/\/localhost:8080/.test(l)) return FALLO + "logs vigia: " + l;
              const d = x("kubectl describe pod -l app=web -n nivel-70"); if (!/  vigia:/.test(d) || !/Readiness probe failed/.test(d)) return FALLO + "describe: " + d.slice(-700);
              x("kubectl set env deployment/web -c vigia DESTINO=http://localhost:80 -n nivel-70"); espera(15);
              const g2 = x("kubectl get pods -n nivel-70"); if (!/2\/2\s+Running/.test(g2)) return FALLO + "después debía estar 2/2: " + g2;
              const l2 = x("kubectl logs deploy/web -c vigia -n nivel-70 --tail=1"); return /OK http:\/\/localhost:80/.test(l2) ? l2 : FALLO + "logs vigia después: " + l2; },
  71: () => { x("kubectl exec -it deploy/par -c consola -n nivel-71 -- sh"); const p = x("ps"); x("exit");
              if (!/^\s+1 65535\s+0:00 \/pause/m.test(p)) return FALLO + "ps sin /pause: " + p; if ((p.match(/nginx: (master|worker)/g) || []).length !== 3) return FALLO + "nginx: " + p;
              return x("responder 3"); },
  72: () => { const o = x("kubectl exec deploy/oro -n nivel-72 -- cat /proc/1/oom_score_adj"), pl = x("kubectl exec deploy/plata -n nivel-72 -- cat /proc/1/oom_score_adj"), b = x("kubectl exec deploy/bronce -n nivel-72 -- cat /proc/1/oom_score_adj");
              if (o.trim() !== "-997" || b.trim() !== "1000" || !(parseInt(pl) > 2 && parseInt(pl) < 999)) return FALLO + `oom: ${o} / ${pl} / ${b}`;
              return x("responder bronce"); },
  73: () => { const g = x("kubectl get pods -n nivel-73 -o wide"); const nodo = (g.match(/(ip-\S+\.compute\.internal)/) || [])[1]; if (!nodo) return FALLO + "nodo: " + g;
              x(`kubectl debug node/${nodo} -it --image=busybox:1.37`); const c = x("crictl ps --name rastro"); const id = (c.match(/\n([0-9a-f]{13})\s/) || [])[1];
              const i = x(`crictl inspect ${id} | grep pid`); const pid = (i.match(/"pid": (\d+)/) || [])[1]; x("exit");
              if (!pid) return FALLO + "inspect: " + c + i; return x("responder " + pid); },
  74: () => { const dentro = x("kubectl exec deploy/medido -n nivel-74 -- cat /proc/self/cgroup"); if (dentro.trim() !== "0::/") return FALLO + "cgroup dentro: " + dentro;
              const nodo = (x("kubectl get pods -n nivel-74 -o wide").match(/(ip-\S+\.compute\.internal)/) || [])[1];
              x(`kubectl debug node/${nodo} -it --image=busybox:1.37`); const id = (x("crictl ps --name medido").match(/\n([0-9a-f]{13})\s/) || [])[1];
              const pid = (x(`crictl inspect ${id} | grep pid`).match(/"pid": (\d+)/) || [])[1]; const cg = x(`cat /proc/${pid}/cgroup`); x("exit");
              if (!/kubepods-burstable\.slice\/kubepods-burstable-pod[0-9a-f_]+\.slice\/cri-containerd-[0-9a-f]{64}\.scope/.test(cg)) return FALLO + "cgroup nodo: " + cg;
              return x("responder burstable"); },
  75: () => { const nodo = A.S.nodes[0].name; x(`kubectl debug node/${nodo} -it --image=busybox:1.37`); const r = x("iptables-save | grep pagos"); x("exit");
              const d = (r.match(/DNAT --to-destination (\S+)/) || [])[1]; if (!d || !/:8080$/.test(d)) return FALLO + "iptables: " + r;
              const e = x("kubectl get endpoints pagos -n nivel-75"); if (!e.includes(d)) return FALLO + "endpoints no casan: " + e; return x("responder " + d); },
  76: () => { const cka = A.S.datos.cka; espera(3);
              let c = x("comprobar"); if (!/Nota: 0 %/.test(c)) return FALLO + "al empezar debía ser 0 %: " + c;
              // 1 RBAC
              x("kubectl create clusterrole deployment-clusterrole --verb=create --resource=deployments,statefulsets,daemonsets");
              x("kubectl create serviceaccount cicd-token -n app-team1");
              x("kubectl create rolebinding cicd-token-binding --clusterrole=deployment-clusterrole --serviceaccount=app-team1:cicd-token -n app-team1");
              // 3 NetworkPolicy
              x("kubectl apply -f -"); ed(() => "apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: allow-port-from-namespace\n  namespace: fubar\nspec:\n  podSelector: {}\n  policyTypes: [\"Ingress\"]\n  ingress:\n  - from:\n    - namespaceSelector:\n        matchLabels:\n          kubernetes.io/metadata.name: internal\n    ports:\n    - protocol: TCP\n      port: 9000\n");
              c = x("comprobar"); if (!/Nota: 33 %/.test(c) || A.P.hechos[76] !== undefined) return FALLO + "con 2 de 6 no debía aprobar: " + c;
              // 4 exponer
              x(`kubectl patch deployment front-end -n nivel-76 --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/ports","value":[{"name":"http","containerPort":80,"protocol":"TCP"}]}]'`); espera(10);
              x("kubectl expose deployment front-end --name=front-end-svc --port=80 --target-port=http --type=NodePort -n nivel-76"); espera(2);
              // 6 nodo caído
              x(`kubectl debug node/${cka.roto} -it --image=busybox:1.37`); const st = x("systemctl status kubelet"); x("systemctl start kubelet"); x("exit");
              if (!/inactive \(dead\)/.test(st)) return FALLO + "kubelet debía estar parado: " + st; espera(5);
              c = x("comprobar"); if (!/Nota: 67 %/.test(c) || !(A.P.hechos[76] >= 60)) return FALLO + "con 4 de 6 debía aprobar (67 %): " + c + " · XP " + A.P.hechos[76];
              const xp4 = A.P.hechos[76];
              // 5 sidecar
              x("kubectl edit deployment legacy-app -n nivel-76"); ed(t => t.replace(/(\n(\s+)- name: app\n)/, "\n$2- name: sidecar\n$2  image: busybox:1.37\n$2  command: [\"/bin/sh\", \"-c\", \"tail -n+1 -f /var/log/legacy-app.log\"]\n$2  volumeMounts:\n$2  - name: logs\n$2    mountPath: /var/log\n$1"));
              espera(15); const ls = x("kubectl logs deploy/legacy-app -c sidecar -n nivel-76 --tail=2"); if (!/INFO procesado pedido/.test(ls)) return FALLO + "logs sidecar: " + ls;
              // 2 drain
              x(`kubectl drain ${cka.drenar} --ignore-daemonsets --delete-emptydir-data`); espera(5);
              c = x("comprobar"); if (!/Nota: 100 %/.test(c)) return FALLO + "al final debía ser 100 %: " + c;
              return A.P.hechos[76] === 100 && A.P.hechos[76] > xp4 ? c : FALLO + "la nota no mejoró los XP: " + A.P.hechos[76]; },
};
for (let id = 1; id <= A.MAX; id++){
  const n = A.NIVELES[id];
  A.irA(id); salida();
  if (n.tipo === "mision"){ let pre = false; try { pre = n.ok(); } catch(e){} ok(!pre, `N${id} ${n.t}: NO está resuelto al empezar`); if (pre) continue; }
  let r; try { r = SOL[id](); } catch(e){ r = "EXCEPCIÓN: " + e.stack; }
  if (String(r).startsWith(FALLO) || String(r).startsWith("EXCEPCIÓN")) ok(false, `N${id} ${n.t}: falla una comprobación intermedia`, r);
  espera(1);
  ok(A.P.hechos[id] !== undefined, `N${id} ${n.t}: se supera con la solución`, r);
}
console.log(`\n${A.MAX} niveles · superados: ${Object.keys(A.P.hechos).length} · XP: ${Object.values(A.P.hechos).reduce((a, b) => a + b, 0)}`);
const ascensos = SALIDA_PRUEBAS.filter(z => /ASCENSO/.test(z.t)).length;
ok(ascensos === 7, `se anuncian los 7 ascensos de rango (Junior → … → Listo para la CKA): ${ascensos}`);
console.log(fallos ? `${fallos} FALLOS` : "TODO OK"); process.exitCode = fallos ? 1 : 0;
