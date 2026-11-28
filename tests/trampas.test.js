// Soluciones tramposas o incorrectas NO deben superar niveles, y una ráfaga de comandos no debe provocar errores internos.
// Uso: node tests/trampas.test.js   (probado con Node 24; lee ../eks-quest.html, así que constrúyelo antes con python construir.py)
const fs = require("fs");
global.SALIDA_PRUEBAS = []; global.EDITOR_PRUEBAS = [];
global.window = {getSelection:() => ({toString:() => ""})}; global.localStorage = {getItem:() => null, setItem(){}, removeItem(){}}; global.confirm = () => true;
let code = fs.readFileSync(__dirname + "/../eks-quest.html", "utf8").match(/<script>([\s\S]*)<\/script>/)[1].replace(/arrancarUI\(\);\s*$/, "").replace('const $ = id => document.getElementById(id);', 'const $ = id => null;');
eval(code + "\n;global.API={get S(){return S}, get P(){return P}, NIVELES, MAX, irA, ejecutarLinea, reconciliar, avanzarReloj, clusterNuevo, get MODO(){return MODO}};");
const A = global.API; let fallos = 0, marca = 0;
const sal = () => { const r = SALIDA_PRUEBAS.slice(marca).map(x => x.t).join("\n"); marca = SALIDA_PRUEBAS.length; return r; };
const x = c => { marca = SALIDA_PRUEBAS.length; A.ejecutarLinea(c); A.reconciliar(); comprobar(true); return sal(); };
const ed = f => { const e = EDITOR_PRUEBAS.pop(); marca = SALIDA_PRUEBAS.length; e.alGuardar(f(e.texto)); A.reconciliar(); comprobar(true); return sal(); };
const ok = (c, m, extra) => { console.log((c ? "  ✅ " : "  ❌ ") + m + (c || !extra ? "" : "\n       ⟶ " + String(extra).slice(-300).replace(/\n/g, "\n         "))); if (!c) fallos++; };
const superado = id => A.P.hechos[id] !== undefined;
const limpio = id => { delete A.P.hechos[id]; A.irA(id); sal(); };
A.clusterNuevo();

console.log("== los niveles se desbloquean en orden ==");
{ const guarda = JSON.stringify(A.P.hechos); for (const k of Object.keys(A.P.hechos)) delete A.P.hechos[k];
  A.irA(1); sal();
  let o = x("nivel 30"); ok(/bloqueado/.test(o) && A.P.actual === 1, "no se puede saltar al nivel 30", o);
  o = x("siguiente"); ok(/Primero supera/.test(o) && A.P.actual === 1, "«siguiente» exige superar el nivel actual", o);
  x("solucion"); o = x("siguiente"); ok(A.P.actual === 1, "ver la solución no desbloquea el siguiente", o);
  x("responder hola"); o = x("siguiente"); ok(A.P.actual === 2, "superado el 1, «siguiente» lleva al 2", o);
  o = x("nivel 3"); ok(/bloqueado/.test(o) && A.P.actual === 2, "el 3 sigue cerrado mientras no se supere el 2", o);
  o = x("nivel 1"); ok(A.P.actual === 1, "se puede volver a un nivel ya superado", o);
  o = x("mision"); ok(/Namespace de este nivel: nivel-1/.test(o), "la misión dice qué namespace usar", o);
  for (const k of Object.keys(A.P.hechos)) delete A.P.hechos[k]; Object.assign(A.P.hechos, JSON.parse(guarda)); }

console.log("== soluciones tramposas o incorrectas ==");
limpio(7); x("responder 254"); ok(!superado(7), "N7: 254 no vale");
limpio(14); x("kubectl delete deployment api -n nivel-14"); x("kubectl create deployment api --image=nginx:1.27-alpine -n nivel-14"); A.avanzarReloj(2); comprobar(true); ok(!superado(14), "N14: borrar y recrear NO vale");
limpio(18); x("kubectl set resources deployment tragon --limits=memory=128Mi -n nivel-18"); A.avanzarReloj(3); comprobar(true); ok(!superado(18), "N18: 128Mi no basta (sigue OOM)");
limpio(21); x("aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego --scaling-config minSize=1,maxSize=2,desiredSize=2"); A.avanzarReloj(12); comprobar(true); ok(!superado(21), "N21: añadir nodos no lo arregla");
x("aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego --scaling-config minSize=1,maxSize=2,desiredSize=1"); A.avanzarReloj(10);
limpio(32); x("kubectl set image deployment/web nginx=nginx:1.28-alpine -n nivel-32"); comprobar(true); ok(!superado(32), "N32: subir a otra versión no es volver a la que funcionaba");
limpio(34); x("kubectl rollout restart deployment/saludo -n nivel-34"); comprobar(true); ok(!superado(34), "N34: restart sin cambiar el ConfigMap no vale");
limpio(35); x("responder s3cr3t0-eks"); ok(!superado(35), "N35: contraseña en minúsculas no vale");
limpio(42); x("kubectl scale deployment fila --replicas=2 -n nivel-42"); comprobar(true); ok(!superado(42), "N42: reducir réplicas no vale");
limpio(45); x("kubectl edit deployment gpu-app -n nivel-45"); ed(t => t.replace(/\n\s+nodeSelector:\n\s+hardware: gpu/, "")); comprobar(true); ok(!superado(45), "N45: quitar el nodeSelector no vale");
limpio(48); x("kubectl create rolebinding todo --clusterrole=view --serviceaccount=nivel-48:lector -n nivel-48"); comprobar(true); ok(!superado(48), "N48: ClusterRole view da de más");
limpio(49); x("kubectl delete rolebinding bot-todo -n nivel-49"); comprobar(true); ok(!superado(49), "N49: quitar todos los permisos no es «solo lectura»");
limpio(50); x("kubectl delete networkpolicy denegar-todo -n nivel-50"); comprobar(true); ok(!superado(50), "N50: borrar denegar-todo no vale");
limpio(51); x("kubectl label namespace nivel-51 pod-security.kubernetes.io/enforce-"); x("kubectl rollout restart deployment/inseguro -n nivel-51"); comprobar(true); ok(!superado(51), "N51: quitar la etiqueta restricted no vale");
limpio(53); x("kubectl delete pdb pagos-pdb -n nivel-53"); const nodo = A.S.datos.nodosPagos[0]; x(`kubectl drain ${nodo} --ignore-daemonsets --delete-emptydir-data`); comprobar(true); ok(!superado(53), "N53: borrar el PDB no vale");
limpio(53); const otro = A.S.nodes.map(n => n.name).find(n => !A.S.datos.nodosPagos.includes(n)); if (otro){ x(`kubectl drain ${otro} --ignore-daemonsets --delete-emptydir-data`); comprobar(true); ok(!superado(53), "N53: drenar un nodo SIN pagos no vale"); }
limpio(54); const roto = A.S.nodes.find(n => n.roto); x("aws ssm start-session --target " + roto.id); x("sudo systemctl start kubelet"); x("exit"); comprobar(true); ok(!superado(54), "N54: reiniciar kubelet no es sustituir el nodo");

console.log("== comportamiento de comandos ==");
limpio(10);
let o = x("kubectl get pods"); ok(/No resources found in default/.test(o) && /te falta -n nivel-10/.test(o), "sin -n avisa del namespace", o);
o = x("kubectl create deployment web --image=nginx1.27-alpine --replicas=3 -n nivel-10"); A.avanzarReloj(5); o = x("kubectl get pods -n nivel-10"); ok(/ErrImagePull|ImagePullBackOff/.test(o), "imagen sin «:» → ImagePullBackOff", o);
o = x("kubectl describe pod -n nivel-10"); ok(/pull access denied/.test(o), "describe explica pull access denied", o.slice(-300));
o = x("kubectl delete deployment web -n nivel-10"); o = x("kubectl create deployment web --image=nginx:1.27-alpine --replicas=3 -n nivel-10"); o = x("kubectl get deploy web -n nivel-10 -o yaml"); ok(/kind: Deployment/.test(o) && /name: nginx/.test(o), "-o yaml y nombre de contenedor «nginx»", o.slice(0, 300));
o = x("kubectl get all -n nivel-10"); ok(/deployment.apps\/web/.test(o) && /pod\/web-/.test(o), "get all", o);
o = x("kubectl get pods -A -o wide | grep kube-proxy | wc -l"); ok(/^\d+$/.test(o.trim()), "tubería grep | wc -l", o);
o = x("kubectl exec -it deploy/web -n nivel-10 -- sh"); ok(!!A.MODO, "exec -it sh abre shell"); o = x("cat /etc/resolv.conf"); ok(/ndots:5/.test(o), "dentro: cat /etc/resolv.conf", o); o = x("wget -qO- http://kubernetes.default"); x("exit"); ok(!A.MODO, "exit cierra la shell");
x("kubectl expose deployment web --port=80 -n nivel-10"); o = x("kubectl run t --rm -it --image=busybox:1.37 -n nivel-10"); ok(!!A.MODO, "run --rm -it sin comando abre shell"); o = x("nslookup web"); ok(/web\.nivel-10\.svc\.cluster\.local/.test(o), "nslookup desde shell", o); o = x("exit"); ok(/deleted from nivel-10/.test(o), "al salir borra el Pod temporal", o);
o = x("kubectl get nodes -L topology.kubernetes.io/zone"); ok(/ZONE/.test(o) && /eu-west-1a/.test(o), "-L zona", o);
o = x("kubectl get pod -n nivel-10 -o jsonpath='{range .items[*]}{.metadata.name}{\"\\t\"}{.status.podIP}{\"\\n\"}{end}'"); ok((o.match(/web-/g) || []).length === 3, "jsonpath con range", o);
o = x("kubectl get pods -n nivel-10 --field-selector status.phase=Running --no-headers | wc -l"); ok(o.trim() === "3", "--field-selector", o);
o = x("kubectl logs deploy/web -n nivel-10"); ok(/Configuration complete/.test(o), "logs de nginx", o);
o = x("kubectl explain deploy.spec.replicas"); ok(/replicas <integer>/.test(o), "explain", o);
o = x("aws ec2 describe-instances --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output text"); ok(/^i-0\w+\s+running/m.test(o), "aws --query + --output text", o);
o = x("aws eks describe-nodegroup --cluster-name eks-juego --nodegroup-name ng-juego --query nodegroup.scalingConfig"); ok(/desiredSize/.test(o), "describe-nodegroup --query", o);
o = x("kubectl get secret noexiste -n nivel-10 -o jsonpath='{.data.x}' | base64 -d"); ok(/NotFound/.test(o), "error por stderr aunque haya tubería", o);
o = x("echo aG9sYQ== | base64 -d"); ok(o.trim() === "hola", "echo | base64 -d", o);
o = x("kubectl get deploy -n nivel-10; kubectl get svc -n nivel-10"); ok(/READY/.test(o) && /No resources|TYPE/.test(o), "varios comandos con ;", o);
o = x("kubectl edit pod " + A.S.pods.find(p => p.ns === "nivel-10").name + " -n nivel-10"); ok(/No se edita el Pod/.test(o), "edit pod explica", o);
o = x("kubectl auth can-i --list -n nivel-10 --as=system:serviceaccount:nivel-10:default"); ok(/selfsubjectaccessreviews/.test(o), "auth can-i --list", o);
o = x("describe deploy -n nivel-10"); ok(/todo empieza por/.test(o), "verbo sin kubectl", o.slice(0, 200));
o = x("ectl get ns"); ok(/Querías decir/.test(o), "errata ectl", o.slice(0, 200));
o = x("kubectl rollout status deployment/web -n nivel-10"); ok(/successfully rolled out/.test(o), "rollout status OK", o);
o = x("kubectl drain " + A.S.nodes[0].name); ok(/cannot delete DaemonSet-managed Pods/.test(o), "drain sin --ignore-daemonsets", o.slice(0, 300)); x("kubectl uncordon " + A.S.nodes[0].name);
o = x("kubectl taint nodes " + A.S.nodes[0].name + " x=y:NoSchedule"); ok(/tainted/.test(o), "taint"); o = x("kubectl taint nodes " + A.S.nodes[0].name + " x-"); ok(/untainted/.test(o), "untaint", o);
o = x("kubectl patch deployment web -n nivel-10 -p '{\"spec\":{\"replicas\":2}}'"); A.reconciliar(); ok(/patched/.test(o) && A.S.objs.find(z => z.kind === "Deployment" && z.metadata.name === "web" && z.metadata.namespace === "nivel-10").spec.replicas === 2, "patch merge", o);
o = x("kubectl delete ns kube-system"); ok(/may not be deleted/.test(o), "no deja borrar kube-system", o);
o = x("helm list"); ok(/no está en este simulador/.test(o), "helm explicado", o);
o = x("sleep 5"); ok(/el reloj del cluster avanza/.test(o), "sleep avanza reloj", o);

console.log("== Mundo 8: trampas ==");
limpio(57); x("responder sh"); ok(!superado(57), "N57: «sh» no es el PID 1");
limpio(58); x("responder 134217728"); ok(!superado(58), "N58: 128Mi no es el límite de api");
limpio(58); x("responder 192Mi"); ok(!superado(58), "N58: hay que dar los BYTES, no 192Mi");
limpio(59); x("responder 300"); ok(!superado(59), "N59: 300 (milicores) no son microsegundos");
limpio(60); x("responder 0000000000000000"); ok(!superado(60), "N60: los ceros son de «blindado», no de «normal»");
limpio(60); x("responder a80425fb"); ok(superado(60), "N60: se acepta el hex sin ceros a la izquierda");
limpio(61); x(`kubectl patch serviceaccount default -n nivel-61 -p '{"automountServiceAccountToken":false}'`); A.avanzarReloj(20); comprobar(true); ok(!superado(61), "N61: cambiar la SA sin recrear los Pods no vale");
limpio(61); x("kubectl scale deployment web --replicas=0 -n nivel-61"); A.avanzarReloj(5); comprobar(true); ok(!superado(61), "N61: apagar web no vale");
limpio(62); x(`kubectl patch deployment app -n nivel-62 --type=json -p '[{"op":"remove","path":"/spec/template/spec/initContainers"}]'`); A.avanzarReloj(10); comprobar(true); ok(!superado(62), "N62: quitar el init container no vale");
limpio(63); x("aws eks create-pod-identity-association --cluster-name eks-juego --namespace nivel-63 --service-account default --role-arn arn:aws:iam::123456789012:role/eks-quest-s3-subidor"); x("kubectl rollout restart deployment subidor -n nivel-63"); A.avanzarReloj(15); comprobar(true); ok(!superado(63), "N63: asociar la SA equivocada no vale");
o = x("aws eks create-pod-identity-association --cluster-name eks-juego --namespace nivel-63 --service-account default --role-arn arn:aws:iam::123456789012:role/eks-quest-s3-subidor"); ok(/ResourceInUseException/.test(o), "N63: asociación duplicada da ResourceInUseException", o);
o = x("aws eks create-pod-identity-association --cluster-name eks-juego --namespace nivel-63 --service-account subidor --role-arn eks-quest-s3-subidor"); ok(/Invalid role ARN/.test(o), "N63: ARN mal formado se rechaza", o);
limpio(64); x("responder sh"); ok(!superado(64), "N64: «sh» no vale");
o = x("kubectl debug -it deploy/minimo -n nivel-64 --image=busybox:1.37 --target=otro"); ok(/no tiene un contenedor llamado/.test(o), "N64: --target inexistente avisa", o); if (A.MODO) x("exit");
limpio(65); x("kubectl create clusterrole todo --verb=* --resource=pods"); x("kubectl create clusterrolebinding auditor-todo --clusterrole=todo --serviceaccount=nivel-65:auditor"); comprobar(true); ok(!superado(65), "N65: verbo * (borrar incluido) no vale");
limpio(65); x("kubectl create role ver-pods --verb=get,list,watch --resource=pods -n nivel-65"); x("kubectl create rolebinding auditor-pods --role=ver-pods --serviceaccount=nivel-65:auditor -n nivel-65"); comprobar(true); ok(!superado(65), "N65: un RoleBinding solo vale para su namespace");
o = x("kubectl auth can-i list pods -A --as=system:serviceaccount:nivel-65:auditor"); ok(/^no/m.test(o), "N65: auth can-i -A con RoleBinding dice no", o);
limpio(65); ok(!A.S.objs.some(z => z.kind === "ClusterRoleBinding"), "estadoBase borra los ClusterRoleBindings de niveles anteriores");
o = x("kubectl delete clusterrole view"); ok(/predefinidos/.test(o), "no deja borrar el ClusterRole view", o);
limpio(66); x("kubectl label namespace nivel-66 pod-security.kubernetes.io/enforce=privileged --overwrite"); x(`kubectl patch deployment pedidos -n nivel-66 --type=json -p '[{"op":"remove","path":"/spec/template/spec/initContainers"}]'`); x("kubectl create secret generic cola-cred --from-literal=password=x -n nivel-66"); x(`kubectl patch deployment pedidos -n nivel-66 --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'`); A.avanzarReloj(25); comprobar(true); ok(!superado(66), "N66: rebajar la seguridad y quitar el init no vale");
limpio(66); x("kubectl apply -f -"); o = ed(() => "apiVersion: v1\nkind: Pod\nmetadata:\n  name: malo\n  namespace: nivel-66\nspec:\n  securityContext:\n    runAsNonRoot: true\n    seccompProfile:\n      type: RuntimeDefault\n  initContainers:\n  - name: prep\n    image: busybox:1.37\n    command: [\"true\"]\n  containers:\n  - name: app\n    image: nginxinc/nginx-unprivileged:1.28-alpine\n    securityContext:\n      allowPrivilegeEscalation: false\n      capabilities:\n        drop: [\"ALL\"]\n"); ok(/violates PodSecurity/.test(o) && /container "prep"/.test(o), "PSA restricted también revisa los initContainers", o);
console.log("== ráfaga de comandos variados (no debe haber errores internos) ==");
const rafaga = ["kubectl debug","kubectl debug x","kubectl debug -it nope --image=busybox:1.37","kubectl debug node/nope -it --image=busybox:1.37","kubectl create clusterrole","kubectl create clusterrole a","kubectl create clusterrolebinding b","kubectl get clusterroles","kubectl get clusterrolebindings -o yaml","kubectl describe clusterrole view","kubectl delete clusterrolebinding nope","kubectl auth can-i list pods -A","aws eks create-pod-identity-association","aws eks list-pod-identity-associations --cluster-name eks-juego","aws eks delete-pod-identity-association --cluster-name eks-juego --association-id a-x","aws eks describe-pod-identity-association --cluster-name eks-juego","kubectl logs nope -c x","kubectl exec nope -- cat /proc/1/status","kubectl","kubectl get","kubectl get pods -o","kubectl get xyz","kubectl describe","kubectl describe nodes","kubectl logs","kubectl create","kubectl create deployment","kubectl create deployment a","kubectl scale deploy/web","kubectl set image deploy/web","kubectl set env deploy/web --list -n nivel-10","kubectl rollout history deploy/web -n nivel-10","kubectl rollout undo deploy/web -n nivel-10","kubectl expose deploy/web -n nivel-10","kubectl get events -A","kubectl get ep -n nivel-10","kubectl get endpointslices -n nivel-10","kubectl get rs -n nivel-10 -o wide","kubectl get ds -A","kubectl describe ds kube-proxy -n kube-system","kubectl get clusterroles","kubectl describe clusterrole view","kubectl get sa -A","kubectl top nodes","kubectl top pods -A","kubectl api-resources","kubectl config view","kubectl config get-contexts","kubectl auth whoami","kubectl version","kubectl cluster-info","kubectl get ns -o name","kubectl get nodes -o json | head -n 5","kubectl get pods -A --show-labels | grep coredns","kubectl get pods -n kube-system -o custom-columns=NOMBRE:.metadata.name,NODO:.spec.nodeName","kubectl describe svc kube-dns -n kube-system","kubectl get hpa -A","kubectl get pdb -A","kubectl get netpol -A","kubectl get quota -A","kubectl get jobs -A","kubectl get cj -A","aws","aws eks","aws eks list-clusters","aws eks describe-cluster --name otro","aws eks describe-cluster --name eks-juego --query cluster.arn --output text","aws ec2 describe-instances","aws sts get-caller-identity --output text","aws ssm start-session","curl","curl http://web","curl http://localhost:1","echo","base64","ls","cd /","nslookup web","k get po -A","kubectl get po,svc,deploy -n kube-system","kubectl delete pod x -n nivel-10","kubectl apply","kubectl apply -f algo.yaml","kubectl patch deploy web -n nivel-10 -p 'nojson'","kubectl patch deploy web -n nivel-10 --type=json -p '[{\"op\":\"replace\",\"path\":\"/spec/nada/x\",\"value\":1}]'","kubectl label node x a=b","kubectl label nodes --all prueba=si","kubectl label nodes --all prueba-","kubectl taint nodes --all","kubectl exec x","kubectl port-forward","kubectl port-forward svc/web 9090:80 -n nivel-10","curl localhost:9090","kubectl run","kubectl run r --image=nginx:1.27-alpine -n nivel-10","kubectl get pod r -n nivel-10","kubectl delete pod r -n nivel-10","kubectl create job j --image=busybox:1.37 -n nivel-10 -- sh -c 'exit 3'","sleep 20","kubectl get jobs -n nivel-10","kubectl get pods -n nivel-10","kubectl create cronjob c --image=busybox:1.37 --schedule='mal' -n nivel-10","kubectl create quota q --hard=pods=50 -n nivel-10","kubectl describe quota q -n nivel-10","kubectl create pdb p --selector=app=web --min-available=1 -n nivel-10","kubectl get pdb -n nivel-10","kubectl create role r --verb=volar --resource=pods -n nivel-10","kubectl create sa s -n nivel-10","kubectl auth can-i delete pods -n nivel-10 --as=system:serviceaccount:nivel-10:s","kubectl auth can-i volar pods -n nivel-10","kubectl explain","kubectl explain nada","kubectl config set-context --current --namespace=nivel-10","kubectl get deploy","kubectl config set-context --current --namespace=default","kubectl rollout restart deploy/web -n nivel-10","kubectl rollout pause deploy/web -n nivel-10","kubectl rollout resume deploy/web -n nivel-10","kubectl get deploy web -n nivel-10 -o jsonpath='{.spec.template.spec.containers[0].image}'","kubectl get nodes -o jsonpath='{.items[*].status.conditions[?(@.type==\"Ready\")].status}'","kubectl get pods -n nivel-10 -l 'app!=web'","kubectl wait","kubectl debug","kubectl delete all --all -n nivel-10","kubectl get all -n nivel-10","mapa","progreso","nivel 99","nivel 3","responder x","pista","pista","pista","pista","solucion","siguiente","anterior","chuletas","help"];
let internos = 0;
for (const c of rafaga){
  marca = SALIDA_PRUEBAS.length;
  try { A.ejecutarLinea(c); A.reconciliar(); comprobar(true); } catch(e){ internos++; console.log("  ❌ EXCEPCIÓN en «" + c + "»: " + e.message); }
  if (A.MODO){ A.ejecutarLinea("exit"); }
}
ok(internos === 0, `ráfaga de ${rafaga.length} comandos sin excepciones`);
console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO OK"); process.exitCode = fallos ? 1 : 0;
