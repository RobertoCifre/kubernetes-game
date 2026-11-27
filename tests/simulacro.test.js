// Simulacro: en cada uno de los 60 niveles lanza ~170 comandos reales de kubectl/aws y falla si alguno
// provoca una excepción o una respuesta de «no soportado». Uso: node tests/simulacro.test.js  (tarda 1-3 min)
const fs = require("fs");
global.SALIDA_PRUEBAS = []; global.EDITOR_PRUEBAS = [];
global.window = {getSelection:() => ({toString:() => ""})}; global.localStorage = {getItem:() => null, setItem(){}, removeItem(){}}; global.confirm = () => true;
const html = fs.readFileSync(require("path").join(__dirname, "..", "eks-quest.html"), "utf8");
let code = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/arrancarUI\(\);\s*$/, "").replace('const $ = id => document.getElementById(id);', 'const $ = id => null;');
eval(code + "\n;global.API={get S(){return S}, NIVELES, irA, ejecutarLinea, reconciliar, avanzarReloj, clusterNuevo, get MODO(){return MODO}};");
const A = global.API; let marca = 0;
const x = c => { marca = SALIDA_PRUEBAS.length; A.ejecutarLinea(c); A.reconciliar(); return SALIDA_PRUEBAS.slice(marca).map(z => z.t).join("\n"); };
const RARO = /\(simulador\)(?! en el navegador no se abre| attach te conecta| copiado)|no soportad|no está (implementad|disponible|soportad)|not (yet )?(implemented|supported)|undefined|NaN|\[object Object\]|EXCEPCI|TypeError|ReferenceError|Cannot read|is not a function|error: unknown command/;
const hallazgos = new Map();   // comando-plantilla → {veces, ejemplo, salida}
function apunta(tpl, c, o){ const k = tpl; const h = hallazgos.get(k) || {veces:0, ejemplo:c, salida:o}; h.veces++; hallazgos.set(k, h); }

const PLANTILLAS = [
  // mirar
  "kubectl get all -n {ns}", "kubectl get pods -n {ns} -o wide", "kubectl get pods -n {ns} --show-labels", "kubectl get po -n {ns} -o yaml",
  "kubectl get pods -n {ns} -o json", "kubectl get pods -n {ns} -o name", "kubectl get pods -n {ns} -w", "kubectl get pods -A",
  "kubectl get pods -n {ns} --sort-by=.metadata.creationTimestamp", "kubectl get pods -n {ns} --field-selector=status.phase=Running",
  "kubectl get pods -n {ns} -o custom-columns=NAME:.metadata.name,STATUS:.status.phase", "kubectl get pods -n {ns} -o jsonpath='{.items[*].metadata.name}'",
  "kubectl get deploy -n {ns}", "kubectl get deployments.apps -n {ns}", "kubectl get deploy {dep} -n {ns} -o yaml", "kubectl get rs -n {ns}",
  "kubectl get svc -n {ns}", "kubectl get svc,ep -n {ns}", "kubectl get endpoints -n {ns}", "kubectl get endpointslices -n {ns}",
  "kubectl get cm,secret -n {ns}", "kubectl get events -n {ns}", "kubectl get events -n {ns} --sort-by=.lastTimestamp", "kubectl events -n {ns}",
  "kubectl get ns", "kubectl get nodes -o wide", "kubectl get nodes --show-labels", "kubectl get sa,role,rolebinding -n {ns}",
  "kubectl get hpa,quota,pdb,netpol -n {ns}", "kubectl get jobs,cronjobs -n {ns}", "kubectl get ds -A", "kubectl get clusterroles", "kubectl get crb",
  "kubectl describe deploy {dep} -n {ns}", "kubectl describe pods -n {ns}", "kubectl describe pod {pod} -n {ns}", "kubectl describe svc -n {ns}",
  "kubectl describe ns {ns}", "kubectl describe nodes", "kubectl logs {pod} -n {ns}", "kubectl logs {pod} -n {ns} --tail=5", "kubectl logs deploy/{dep} -n {ns} --all-containers",
  "kubectl logs -l app={dep} -n {ns}", "kubectl logs {pod} -n {ns} --previous", "kubectl logs {pod} -n {ns} --timestamps", "kubectl logs {pod} -n {ns} --since=1h",
  "kubectl top pods -n {ns}", "kubectl top nodes", "kubectl top pod {pod} -n {ns} --containers",
  "kubectl rollout status deploy/{dep} -n {ns} --timeout=5s", "kubectl rollout history deploy/{dep} -n {ns}",
  "kubectl auth can-i --list -n {ns}", "kubectl auth whoami", "kubectl auth can-i '*' '*'",
  "kubectl explain pod.spec.containers", "kubectl explain deployment.spec.strategy", "kubectl api-resources", "kubectl api-versions", "kubectl version",
  "kubectl cluster-info", "kubectl config get-contexts", "kubectl config current-context", "kubectl config view --minify",
  "kubectl get pods -n {ns} | grep -v Running", "kubectl get pods -n {ns} --no-headers | awk '{print $1}'", "kubectl get pods -n {ns} | head -3", "kubectl get pods -n {ns} | sort",
  "kubectl get deploy {dep} -n {ns} -o jsonpath='{.spec.template.spec.containers[0].image}'",
  "kubectl get deploy {dep} -n {ns} -o jsonpath='{range .spec.template.spec.containers[*]}{.name}{\"\\n\"}{end}'",
  // cambiar sin romper (dry-run y diff)
  "kubectl scale deploy {dep} --replicas=2 -n {ns} --dry-run=client", "kubectl create deployment zz --image=nginx:1.27-alpine -n {ns} --dry-run=client -o yaml",
  "kubectl create service clusterip zz --tcp=80:80 -n {ns} --dry-run=client -o yaml", "kubectl run zz --image=busybox:1.37 -n {ns} --dry-run=client -o yaml",
  "kubectl annotate deploy {dep} nota=prueba -n {ns} --overwrite", "kubectl label deploy {dep} extra=si -n {ns} --overwrite",
  "kubectl set env deploy/{dep} --list -n {ns}", "kubectl rollout restart deploy/{dep} -n {ns}",
  "kubectl exec {pod} -n {ns} -- env", "kubectl exec {pod} -n {ns} -- ls /", "kubectl exec {pod} -n {ns} -- cat /etc/resolv.conf", "kubectl exec {pod} -n {ns} -- id",
  "kubectl exec {pod} -n {ns} -- ps aux", "kubectl exec {pod} -n {ns} -- df -h", "kubectl exec {pod} -n {ns} -- cat /proc/1/status", "kubectl exec {pod} -n {ns} -- cat /sys/fs/cgroup/memory.max",
  "kubectl exec {pod} -n {ns} -- wget -qO- -T 2 http://localhost", "kubectl exec {pod} -n {ns} -- nslookup kubernetes.default", "kubectl exec {pod} -n {ns} -- sh -c 'echo hola; hostname'",
  "kubectl run tmp-{n} --rm -it --image=busybox:1.37 -n {ns} -- nslookup kubernetes.default", "kubectl run tmp2-{n} --rm -it --image=busybox:1.37 -n {ns} -- wget -qO- -T 2 http://{svc}",
  "kubectl port-forward svc/{svc} 8081:80 -n {ns}", "kubectl port-forward deploy/{dep} 8082:80 -n {ns}",
  "kubectl debug -it {pod} -n {ns} --image=busybox:1.37",
  "aws sts get-caller-identity", "aws eks list-clusters", "aws eks describe-cluster --name eks-juego", "aws eks list-nodegroups --cluster-name eks-juego",
  "aws eks describe-nodegroup --cluster-name eks-juego --nodegroup-name ng-juego --query nodegroup.scalingConfig", "aws ec2 describe-instances --output table",
  "aws eks list-addons --cluster-name eks-juego", "aws eks list-pod-identity-associations --cluster-name eks-juego",
  "kubectl get pods -n {ns} -o wide --watch-only", "kubectl wait --for=condition=Ready pod -l app={dep} -n {ns} --timeout=5s",
  "kubectl get deploy -n {ns} -o yaml | grep image:", "kubectl get secret -n {ns} -o yaml", "kubectl get all -A | wc -l",
  "kubectl get po", "kubectl get pod {pod} -n {ns} -o jsonpath='{.status.phase}'", "kubectl get pods -n {ns} -l 'app in ({dep},otro)'", "kubectl get pods -n {ns} -l app!=x",
  "kubectl get pods -n {ns} --selector app={dep}", "kubectl get pods -n {ns} -L app", "kubectl get deploy -n {ns} -o custom-columns=NAME:.metadata.name,IMG:.spec.template.spec.containers[0].image",
  "kubectl get nodes -o jsonpath='{.items[*].status.allocatable.pods}'", "kubectl get nodes -o jsonpath='{.items[0].metadata.labels}'",
  "kubectl get pv", "kubectl get pvc -n {ns}", "kubectl get storageclass", "kubectl get sc", "kubectl get ingress -n {ns}", "kubectl get ing -A", "kubectl get crd",
  "kubectl get limitrange -n {ns}", "kubectl get leases -n kube-node-lease", "kubectl get priorityclass", "kubectl get componentstatuses", "kubectl get csr", "kubectl get apiservices",
  "kubectl get --raw /healthz", "kubectl get --raw /readyz", "kubectl create token default -n {ns}", "kubectl get secrets -A", "kubectl get cm -n kube-system",
  "kubectl get all -n kube-system", "kubectl get pods -n kube-system -o wide", "kubectl describe ds aws-node -n kube-system", "kubectl logs -n kube-system -l k8s-app=kube-dns --tail=3",
  "kubectl label pod {pod} extra=1 -n {ns} --overwrite", "kubectl annotate pod {pod} nota=1 -n {ns} --overwrite", "kubectl label pod {pod} extra- -n {ns}",
  "kubectl set image deploy/{dep} '*=nginx:1.27-alpine' -n {ns} --dry-run=client", "kubectl rollout undo deploy/{dep} -n {ns} --dry-run=client",
  "kubectl scale deploy {dep} --current-replicas=99 --replicas=3 -n {ns}", "kubectl rollout pause deploy/{dep} -n {ns}", "kubectl rollout resume deploy/{dep} -n {ns}",
  "kubectl get deploy {dep} -n {ns} -o go-template='{{.metadata.name}}'", "kubectl get pods -n {ns} -o yaml | grep -i image", "kubectl get ev -n {ns}",
  "kubectl describe quota -n {ns}", "kubectl describe hpa -n {ns}", "kubectl get svc -n {ns} -o jsonpath='{.items[*].spec.clusterIP}'",
  "kubectl exec -it {pod} -n {ns} -c {dep} -- sh -c 'exit'", "kubectl cp {pod}:/etc/hosts ./hosts -n {ns}", "kubectl attach {pod} -n {ns}", "kubectl proxy",
  "kubectl diff -f -", "kubectl config set-context --current --namespace={ns}", "kubectl config use-context eks-juego", "kubectl config get-clusters",
  "aws eks describe-cluster --name eks-juego --query cluster.status --output text", "aws eks describe-addon --cluster-name eks-juego --addon-name coredns",
  "aws ec2 describe-instances --query 'Reservations[].Instances[].InstanceId' --output text", "aws sts get-caller-identity --output table", "aws iam list-roles --max-items 2",
  "aws eks update-kubeconfig --name eks-juego --region eu-west-1", "aws configure list", "aws --version",];
A.clusterNuevo();
let total = 0;
for (let n = 1; n < A.NIVELES.length; n++){
  A.irA(n); A.avanzarReloj(8); A.reconciliar();
  const ns = Object.keys(A.S.ns).find(z => z === "nivel-" + n) || (n === 3 ? "default" : "default");
  const deps = A.S.objs.filter(o => o.kind === "Deployment" && o.metadata.namespace === ns).map(o => o.metadata.name);
  const dep = deps[0] || "coredns", nsD = deps[0] ? ns : "kube-system";
  const pod = (A.S.pods.find(p => p.ns === nsD && !p.efimero && p.estado === "Running") || A.S.pods.find(p => p.ns === nsD) || {name:"nada"}).name;
  const svc = (A.S.objs.find(o => o.kind === "Service" && o.metadata.namespace === nsD) || {metadata:{name:"kube-dns"}}).metadata.name;
  for (const tpl of PLANTILLAS){
    const c = tpl.replace(/\{ns\}/g, nsD).replace(/\{dep\}/g, dep).replace(/\{pod\}/g, pod).replace(/\{svc\}/g, svc).replace(/\{n\}/g, n);
    let o; total++;
    try { o = x(c); } catch(e){ o = "EXCEPCIÓN: " + e.stack.split("\n").slice(0, 3).join(" | "); }
    while (A.MODO){ try { x("exit"); } catch(e){ break; } }
    EDITOR_PRUEBAS.length = 0;
    if (RARO.test(o)) apunta(tpl, c, o);
  }
}
console.log(`${total} comandos ejecutados en ${A.NIVELES.length - 1} niveles · ${hallazgos.size} plantillas con respuesta rara\n`);
for (const [tpl, h] of hallazgos) console.log(`✗ ×${h.veces}  ${tpl}\n     ej: ${h.ejemplo}\n     → ${h.salida.replace(/\n/g, " ⏎ ").slice(0, 260)}\n`);
console.log(hallazgos.size ? `${hallazgos.size} FALLOS` : "TODO OK");
process.exitCode = hallazgos.size ? 1 : 0;
