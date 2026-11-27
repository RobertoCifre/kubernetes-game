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

console.log("== soluciones tramposas o incorrectas ==");
limpio(1); x("responder 254"); ok(!superado(1), "N1: 254 no vale");
limpio(8); x("kubectl delete deployment api -n nivel-8"); x("kubectl create deployment api --image=nginx:1.27-alpine -n nivel-8"); A.avanzarReloj(2); comprobar(true); ok(!superado(8), "N8: borrar y recrear NO vale");
limpio(12); x("kubectl set resources deployment tragon --limits=memory=128Mi -n nivel-12"); A.avanzarReloj(3); comprobar(true); ok(!superado(12), "N12: 128Mi no basta (sigue OOM)");
limpio(15); x("aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego --scaling-config minSize=1,maxSize=2,desiredSize=2"); A.avanzarReloj(12); comprobar(true); ok(!superado(15), "N15: añadir nodos no lo arregla");
x("aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego --scaling-config minSize=1,maxSize=2,desiredSize=1"); A.avanzarReloj(10);
limpio(26); x("kubectl set image deployment/web nginx=nginx:1.28-alpine -n nivel-26"); comprobar(true); ok(!superado(26), "N26: subir a otra versión no es volver a la que funcionaba");
limpio(28); x("kubectl rollout restart deployment/saludo -n nivel-28"); comprobar(true); ok(!superado(28), "N28: restart sin cambiar el ConfigMap no vale");
limpio(29); x("responder s3cr3t0-eks"); ok(!superado(29), "N29: contraseña en minúsculas no vale");
limpio(36); x("kubectl scale deployment fila --replicas=2 -n nivel-36"); comprobar(true); ok(!superado(36), "N36: reducir réplicas no vale");
limpio(39); x("kubectl edit deployment gpu-app -n nivel-39"); ed(t => t.replace(/\n\s+nodeSelector:\n\s+hardware: gpu/, "")); comprobar(true); ok(!superado(39), "N39: quitar el nodeSelector no vale");
limpio(42); x("kubectl create rolebinding todo --clusterrole=view --serviceaccount=nivel-42:lector -n nivel-42"); comprobar(true); ok(!superado(42), "N42: ClusterRole view da de más");
limpio(43); x("kubectl delete rolebinding bot-todo -n nivel-43"); comprobar(true); ok(!superado(43), "N43: quitar todos los permisos no es «solo lectura»");
limpio(44); x("kubectl delete networkpolicy denegar-todo -n nivel-44"); comprobar(true); ok(!superado(44), "N44: borrar denegar-todo no vale");
limpio(45); x("kubectl label namespace nivel-45 pod-security.kubernetes.io/enforce-"); x("kubectl rollout restart deployment/inseguro -n nivel-45"); comprobar(true); ok(!superado(45), "N45: quitar la etiqueta restricted no vale");
limpio(47); x("kubectl delete pdb pagos-pdb -n nivel-47"); const nodo = A.S.datos.nodosPagos[0]; x(`kubectl drain ${nodo} --ignore-daemonsets --delete-emptydir-data`); comprobar(true); ok(!superado(47), "N47: borrar el PDB no vale");
limpio(47); const otro = A.S.nodes.map(n => n.name).find(n => !A.S.datos.nodosPagos.includes(n)); if (otro){ x(`kubectl drain ${otro} --ignore-daemonsets --delete-emptydir-data`); comprobar(true); ok(!superado(47), "N47: drenar un nodo SIN pagos no vale"); }
limpio(48); const roto = A.S.nodes.find(n => n.roto); x("aws ssm start-session --target " + roto.id); x("sudo systemctl start kubelet"); x("exit"); comprobar(true); ok(!superado(48), "N48: reiniciar kubelet no es sustituir el nodo");

console.log("== comportamiento de comandos ==");
limpio(4);
let o = x("kubectl get pods"); ok(/No resources found in default/.test(o) && /te falta -n nivel-4/.test(o), "sin -n avisa del namespace", o);
o = x("kubectl create deployment web --image=nginx1.27-alpine --replicas=3 -n nivel-4"); A.avanzarReloj(5); o = x("kubectl get pods -n nivel-4"); ok(/ErrImagePull|ImagePullBackOff/.test(o), "imagen sin «:» → ImagePullBackOff", o);
o = x("kubectl describe pod -n nivel-4"); ok(/pull access denied/.test(o), "describe explica pull access denied", o.slice(-300));
o = x("kubectl delete deployment web -n nivel-4"); o = x("kubectl create deployment web --image=nginx:1.27-alpine --replicas=3 -n nivel-4"); o = x("kubectl get deploy web -n nivel-4 -o yaml"); ok(/kind: Deployment/.test(o) && /name: nginx/.test(o), "-o yaml y nombre de contenedor «nginx»", o.slice(0, 300));
o = x("kubectl get all -n nivel-4"); ok(/deployment.apps\/web/.test(o) && /pod\/web-/.test(o), "get all", o);
o = x("kubectl get pods -A -o wide | grep kube-proxy | wc -l"); ok(/^\d+$/.test(o.trim()), "tubería grep | wc -l", o);
o = x("kubectl exec -it deploy/web -n nivel-4 -- sh"); ok(!!A.MODO, "exec -it sh abre shell"); o = x("cat /etc/resolv.conf"); ok(/ndots:5/.test(o), "dentro: cat /etc/resolv.conf", o); o = x("wget -qO- http://kubernetes.default"); x("exit"); ok(!A.MODO, "exit cierra la shell");
x("kubectl expose deployment web --port=80 -n nivel-4"); o = x("kubectl run t --rm -it --image=busybox:1.37 -n nivel-4"); ok(!!A.MODO, "run --rm -it sin comando abre shell"); o = x("nslookup web"); ok(/web\.nivel-4\.svc\.cluster\.local/.test(o), "nslookup desde shell", o); o = x("exit"); ok(/deleted from nivel-4/.test(o), "al salir borra el Pod temporal", o);
o = x("kubectl get nodes -L topology.kubernetes.io/zone"); ok(/ZONE/.test(o) && /eu-west-1a/.test(o), "-L zona", o);
o = x("kubectl get pod -n nivel-4 -o jsonpath='{range .items[*]}{.metadata.name}{\"\\t\"}{.status.podIP}{\"\\n\"}{end}'"); ok((o.match(/web-/g) || []).length === 3, "jsonpath con range", o);
o = x("kubectl get pods -n nivel-4 --field-selector status.phase=Running --no-headers | wc -l"); ok(o.trim() === "3", "--field-selector", o);
o = x("kubectl logs deploy/web -n nivel-4"); ok(/Configuration complete/.test(o), "logs de nginx", o);
o = x("kubectl explain deploy.spec.replicas"); ok(/replicas <integer>/.test(o), "explain", o);
o = x("aws ec2 describe-instances --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output text"); ok(/^i-0\w+\s+running/m.test(o), "aws --query + --output text", o);
o = x("aws eks describe-nodegroup --cluster-name eks-juego --nodegroup-name ng-juego --query nodegroup.scalingConfig"); ok(/desiredSize/.test(o), "describe-nodegroup --query", o);
o = x("kubectl get secret noexiste -n nivel-4 -o jsonpath='{.data.x}' | base64 -d"); ok(/NotFound/.test(o), "error por stderr aunque haya tubería", o);
o = x("echo aG9sYQ== | base64 -d"); ok(o.trim() === "hola", "echo | base64 -d", o);
o = x("kubectl get deploy -n nivel-4; kubectl get svc -n nivel-4"); ok(/READY/.test(o) && /No resources|TYPE/.test(o), "varios comandos con ;", o);
o = x("kubectl edit pod " + A.S.pods.find(p => p.ns === "nivel-4").name + " -n nivel-4"); ok(/No se edita el Pod/.test(o), "edit pod explica", o);
o = x("kubectl auth can-i --list -n nivel-4 --as=system:serviceaccount:nivel-4:default"); ok(/selfsubjectaccessreviews/.test(o), "auth can-i --list", o);
o = x("describe deploy -n nivel-4"); ok(/todo empieza por/.test(o), "verbo sin kubectl", o.slice(0, 200));
o = x("ectl get ns"); ok(/Querías decir/.test(o), "errata ectl", o.slice(0, 200));
o = x("kubectl rollout status deployment/web -n nivel-4"); ok(/successfully rolled out/.test(o), "rollout status OK", o);
o = x("kubectl drain " + A.S.nodes[0].name); ok(/cannot delete DaemonSet-managed Pods/.test(o), "drain sin --ignore-daemonsets", o.slice(0, 300)); x("kubectl uncordon " + A.S.nodes[0].name);
o = x("kubectl taint nodes " + A.S.nodes[0].name + " x=y:NoSchedule"); ok(/tainted/.test(o), "taint"); o = x("kubectl taint nodes " + A.S.nodes[0].name + " x-"); ok(/untainted/.test(o), "untaint", o);
o = x("kubectl patch deployment web -n nivel-4 -p '{\"spec\":{\"replicas\":2}}'"); A.reconciliar(); ok(/patched/.test(o) && A.S.objs.find(z => z.kind === "Deployment" && z.metadata.name === "web" && z.metadata.namespace === "nivel-4").spec.replicas === 2, "patch merge", o);
o = x("kubectl delete ns kube-system"); ok(/may not be deleted/.test(o), "no deja borrar kube-system", o);
o = x("helm list"); ok(/no está en este simulador/.test(o), "helm explicado", o);
o = x("sleep 5"); ok(/el reloj del cluster avanza/.test(o), "sleep avanza reloj", o);

console.log("== Mundo 8: trampas ==");
limpio(51); x("responder sh"); ok(!superado(51), "N51: «sh» no es el PID 1");
limpio(52); x("responder 134217728"); ok(!superado(52), "N52: 128Mi no es el límite de api");
limpio(52); x("responder 192Mi"); ok(!superado(52), "N52: hay que dar los BYTES, no 192Mi");
limpio(53); x("responder 300"); ok(!superado(53), "N53: 300 (milicores) no son microsegundos");
limpio(54); x("responder 0000000000000000"); ok(!superado(54), "N54: los ceros son de «blindado», no de «normal»");
limpio(54); x("responder a80425fb"); ok(superado(54), "N54: se acepta el hex sin ceros a la izquierda");
limpio(55); x(`kubectl patch serviceaccount default -n nivel-55 -p '{"automountServiceAccountToken":false}'`); A.avanzarReloj(20); comprobar(true); ok(!superado(55), "N55: cambiar la SA sin recrear los Pods no vale");
limpio(55); x("kubectl scale deployment web --replicas=0 -n nivel-55"); A.avanzarReloj(5); comprobar(true); ok(!superado(55), "N55: apagar web no vale");
limpio(56); x(`kubectl patch deployment app -n nivel-56 --type=json -p '[{"op":"remove","path":"/spec/template/spec/initContainers"}]'`); A.avanzarReloj(10); comprobar(true); ok(!superado(56), "N56: quitar el init container no vale");
limpio(57); x("aws eks create-pod-identity-association --cluster-name eks-juego --namespace nivel-57 --service-account default --role-arn arn:aws:iam::123456789012:role/eks-quest-s3-subidor"); x("kubectl rollout restart deployment subidor -n nivel-57"); A.avanzarReloj(15); comprobar(true); ok(!superado(57), "N57: asociar la SA equivocada no vale");
o = x("aws eks create-pod-identity-association --cluster-name eks-juego --namespace nivel-57 --service-account default --role-arn arn:aws:iam::123456789012:role/eks-quest-s3-subidor"); ok(/ResourceInUseException/.test(o), "N57: asociación duplicada da ResourceInUseException", o);
o = x("aws eks create-pod-identity-association --cluster-name eks-juego --namespace nivel-57 --service-account subidor --role-arn eks-quest-s3-subidor"); ok(/Invalid role ARN/.test(o), "N57: ARN mal formado se rechaza", o);
limpio(58); x("responder sh"); ok(!superado(58), "N58: «sh» no vale");
o = x("kubectl debug -it deploy/minimo -n nivel-58 --image=busybox:1.37 --target=otro"); ok(/no tiene un contenedor llamado/.test(o), "N58: --target inexistente avisa", o); if (A.MODO) x("exit");
limpio(59); x("kubectl create clusterrole todo --verb=* --resource=pods"); x("kubectl create clusterrolebinding auditor-todo --clusterrole=todo --serviceaccount=nivel-59:auditor"); comprobar(true); ok(!superado(59), "N59: verbo * (borrar incluido) no vale");
limpio(59); x("kubectl create role ver-pods --verb=get,list,watch --resource=pods -n nivel-59"); x("kubectl create rolebinding auditor-pods --role=ver-pods --serviceaccount=nivel-59:auditor -n nivel-59"); comprobar(true); ok(!superado(59), "N59: un RoleBinding solo vale para su namespace");
o = x("kubectl auth can-i list pods -A --as=system:serviceaccount:nivel-59:auditor"); ok(/^no/m.test(o), "N59: auth can-i -A con RoleBinding dice no", o);
limpio(59); ok(!A.S.objs.some(z => z.kind === "ClusterRoleBinding"), "estadoBase borra los ClusterRoleBindings de niveles anteriores");
o = x("kubectl delete clusterrole view"); ok(/predefinidos/.test(o), "no deja borrar el ClusterRole view", o);
limpio(60); x("kubectl label namespace nivel-60 pod-security.kubernetes.io/enforce=privileged --overwrite"); x(`kubectl patch deployment pedidos -n nivel-60 --type=json -p '[{"op":"remove","path":"/spec/template/spec/initContainers"}]'`); x("kubectl create secret generic cola-cred --from-literal=password=x -n nivel-60"); x(`kubectl patch deployment pedidos -n nivel-60 --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'`); A.avanzarReloj(25); comprobar(true); ok(!superado(60), "N60: rebajar la seguridad y quitar el init no vale");
limpio(60); x("kubectl apply -f -"); o = ed(() => "apiVersion: v1\nkind: Pod\nmetadata:\n  name: malo\n  namespace: nivel-60\nspec:\n  securityContext:\n    runAsNonRoot: true\n    seccompProfile:\n      type: RuntimeDefault\n  initContainers:\n  - name: prep\n    image: busybox:1.37\n    command: [\"true\"]\n  containers:\n  - name: app\n    image: nginxinc/nginx-unprivileged:1.28-alpine\n    securityContext:\n      allowPrivilegeEscalation: false\n      capabilities:\n        drop: [\"ALL\"]\n"); ok(/violates PodSecurity/.test(o) && /container "prep"/.test(o), "PSA restricted también revisa los initContainers", o);
console.log("== ráfaga de comandos variados (no debe haber errores internos) ==");
const rafaga = ["kubectl debug","kubectl debug x","kubectl debug -it nope --image=busybox:1.37","kubectl debug node/nope -it --image=busybox:1.37","kubectl create clusterrole","kubectl create clusterrole a","kubectl create clusterrolebinding b","kubectl get clusterroles","kubectl get clusterrolebindings -o yaml","kubectl describe clusterrole view","kubectl delete clusterrolebinding nope","kubectl auth can-i list pods -A","aws eks create-pod-identity-association","aws eks list-pod-identity-associations --cluster-name eks-juego","aws eks delete-pod-identity-association --cluster-name eks-juego --association-id a-x","aws eks describe-pod-identity-association --cluster-name eks-juego","kubectl logs nope -c x","kubectl exec nope -- cat /proc/1/status","kubectl","kubectl get","kubectl get pods -o","kubectl get xyz","kubectl describe","kubectl describe nodes","kubectl logs","kubectl create","kubectl create deployment","kubectl create deployment a","kubectl scale deploy/web","kubectl set image deploy/web","kubectl set env deploy/web --list -n nivel-4","kubectl rollout history deploy/web -n nivel-4","kubectl rollout undo deploy/web -n nivel-4","kubectl expose deploy/web -n nivel-4","kubectl get events -A","kubectl get ep -n nivel-4","kubectl get endpointslices -n nivel-4","kubectl get rs -n nivel-4 -o wide","kubectl get ds -A","kubectl describe ds kube-proxy -n kube-system","kubectl get clusterroles","kubectl describe clusterrole view","kubectl get sa -A","kubectl top nodes","kubectl top pods -A","kubectl api-resources","kubectl config view","kubectl config get-contexts","kubectl auth whoami","kubectl version","kubectl cluster-info","kubectl get ns -o name","kubectl get nodes -o json | head -n 5","kubectl get pods -A --show-labels | grep coredns","kubectl get pods -n kube-system -o custom-columns=NOMBRE:.metadata.name,NODO:.spec.nodeName","kubectl describe svc kube-dns -n kube-system","kubectl get hpa -A","kubectl get pdb -A","kubectl get netpol -A","kubectl get quota -A","kubectl get jobs -A","kubectl get cj -A","aws","aws eks","aws eks list-clusters","aws eks describe-cluster --name otro","aws eks describe-cluster --name eks-juego --query cluster.arn --output text","aws ec2 describe-instances","aws sts get-caller-identity --output text","aws ssm start-session","curl","curl http://web","curl http://localhost:1","echo","base64","ls","cd /","nslookup web","k get po -A","kubectl get po,svc,deploy -n kube-system","kubectl delete pod x -n nivel-4","kubectl apply","kubectl apply -f algo.yaml","kubectl patch deploy web -n nivel-4 -p 'nojson'","kubectl patch deploy web -n nivel-4 --type=json -p '[{\"op\":\"replace\",\"path\":\"/spec/nada/x\",\"value\":1}]'","kubectl label node x a=b","kubectl label nodes --all prueba=si","kubectl label nodes --all prueba-","kubectl taint nodes --all","kubectl exec x","kubectl port-forward","kubectl port-forward svc/web 9090:80 -n nivel-4","curl localhost:9090","kubectl run","kubectl run r --image=nginx:1.27-alpine -n nivel-4","kubectl get pod r -n nivel-4","kubectl delete pod r -n nivel-4","kubectl create job j --image=busybox:1.37 -n nivel-4 -- sh -c 'exit 3'","sleep 20","kubectl get jobs -n nivel-4","kubectl get pods -n nivel-4","kubectl create cronjob c --image=busybox:1.37 --schedule='mal' -n nivel-4","kubectl create quota q --hard=pods=50 -n nivel-4","kubectl describe quota q -n nivel-4","kubectl create pdb p --selector=app=web --min-available=1 -n nivel-4","kubectl get pdb -n nivel-4","kubectl create role r --verb=volar --resource=pods -n nivel-4","kubectl create sa s -n nivel-4","kubectl auth can-i delete pods -n nivel-4 --as=system:serviceaccount:nivel-4:s","kubectl auth can-i volar pods -n nivel-4","kubectl explain","kubectl explain nada","kubectl config set-context --current --namespace=nivel-4","kubectl get deploy","kubectl config set-context --current --namespace=default","kubectl rollout restart deploy/web -n nivel-4","kubectl rollout pause deploy/web -n nivel-4","kubectl rollout resume deploy/web -n nivel-4","kubectl get deploy web -n nivel-4 -o jsonpath='{.spec.template.spec.containers[0].image}'","kubectl get nodes -o jsonpath='{.items[*].status.conditions[?(@.type==\"Ready\")].status}'","kubectl get pods -n nivel-4 -l 'app!=web'","kubectl wait","kubectl debug","kubectl delete all --all -n nivel-4","kubectl get all -n nivel-4","mapa","progreso","nivel 99","nivel 3","responder x","pista","pista","pista","pista","solucion","siguiente","anterior","chuletas","help"];
let internos = 0;
for (const c of rafaga){
  marca = SALIDA_PRUEBAS.length;
  try { A.ejecutarLinea(c); A.reconciliar(); comprobar(true); } catch(e){ internos++; console.log("  ❌ EXCEPCIÓN en «" + c + "»: " + e.message); }
  if (A.MODO){ A.ejecutarLinea("exit"); }
}
ok(internos === 0, `ráfaga de ${rafaga.length} comandos sin excepciones`);
console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO OK"); process.exitCode = fallos ? 1 : 0;
