// ¿Tienen las chuletas los comandos para resolver CADA nivel? (los comandos genéricos, no la respuesta concreta)
// Uso: node tests/chuletas.test.js   (lee las CHULETA*.md de la raíz del proyecto o de chuletas/)
const fs = require("fs"), path = require("path");
const raiz = path.join(__dirname, "..");
const dir = fs.existsSync(path.join(raiz, "chuletas")) ? path.join(raiz, "chuletas") : raiz;
const txt = fs.readdirSync(dir).filter(f => /^CHULETAS?.*\.md$/.test(f)).map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
// nivel → expresiones que TIENEN que aparecer en alguna chuleta
const R = {
  1: [/kubectl get (deployments|deploy)\b/, /-n <ns>/],
  2: [/kubectl get pods/],
  3: [/kubectl get svc/],
  4: [/kubectl describe deploy/, /-o wide/],
  5: [/kubectl get svc/, /targetPort/],
  6: [/READY/, /wc -l/],
  7: [/kubectl describe node/, /Allocatable/],
  8: [/topology\.kubernetes\.io\/zone/, /-L /],
  9: [/kubectl create namespace/],
  10: [/kubectl create deployment \S+ --image=\S+ --replicas/, /kubectl expose deployment \S+ --port/],
  11: [/kubectl scale deployment \S+ --replicas/],
  12: [/ -l [\w<]/, /--no-headers/, /wc -l/],
  13: [/kubectl logs (deploy\/|<)/],
  14: [/kubectl set image deployment\//],
  15: [/kubectl set image deployment\//],
  16: [/kubectl create configmap \S+ --from-literal/],
  17: [/kubectl create secret generic \S+ --from-literal/],
  18: [/kubectl set resources deployment \S+ (-n \S+ )?--limits=memory/],
  19: [/kubectl set env deployment\//],
  20: [/kubectl edit deployment/, /--type=json/, /"op":\s*"replace"/, /containers\/0\/command/],
  21: [/--requests=cpu/],
  22: [/--requests=(cpu=[^ ,]+,)?memory=/],
  23: [/kubectl set selector service/],
  24: [/targetPort/, /kubectl (edit|patch) svc/],
  25: [/readinessProbe/],
  26: [/livenessProbe/],
  27: [/kubectl port-forward svc\//, /curl http:\/\/localhost/],
  28: [/<servicio>\.<namespace>|<svc>\.<ns>|<servicio>\.<ns>/],
  29: [/\.svc\.cluster\.local/],
  30: [/--type=LoadBalancer/],
  31: [/kubectl rollout status/],
  32: [/kubectl rollout undo/],
  33: [/kubectl rollout history/, /--to-revision/],
  34: [/kubectl edit (configmap|cm)/, /kubectl rollout restart/],
  35: [/-o jsonpath='\{\.data\./, /base64 -d/],
  36: [/kubectl create job \S+ --image/],
  37: [/kubectl create cronjob \S+ --image=\S+ --schedule/],
  38: [/kubectl get (ds|daemonsets?)\b/, /DESIRED/],
  39: [/QoS/, /Burstable/],
  40: [/kubectl autoscale deployment/],
  41: [/missing request for cpu/],
  42: [/kubectl (edit|patch) (resourcequota|quota)/],
  43: [/aws eks update-nodegroup-config .*--scaling-config/],
  44: [/kubectl taint nodes? \S+ \S+-(\s|$|`)/m, /tolerations/],
  45: [/kubectl label nodes? /],
  46: [/kubectl drain \S+ --ignore-daemonsets --delete-emptydir-data/],
  47: [/aws sts get-caller-identity/, /--query Account/],
  48: [/kubectl create role \S+ --verb=/, /kubectl create rolebinding \S+ --role=/, /--serviceaccount=/],
  49: [/kubectl create rolebinding \S+ --clusterrole=/, /kubectl delete rolebinding/],
  50: [/kind: NetworkPolicy/, /podSelector/, /from:/],
  51: [/allowPrivilegeEscalation: false/, /runAsNonRoot/, /seccompProfile/, /drop: \["ALL"\]/],
  52: [/aws eks describe-cluster .*--query cluster\.version/],
  53: [/kubectl get pods .*-o wide/, /PodDisruptionBudget|PDB/, /disruption budget/],
  54: [/ProviderID/, /aws ec2 terminate-instances/],
  55: [/coredns/, /kubectl scale deployment /, /CoreDNS se arregla como cualquier Deployment|es un Deployment más/],
  56: [/kubectl set image deployment\//, /kubectl set selector service/, /kubectl set env deployment\//],
  57: [/kubectl exec -it \S+ -n \S+ -- sh/, /\bps\b/, /\/proc\/1\/cmdline/],
  58: [/memory\.max/],
  59: [/cpu\.max/],
  60: [/\/proc\/1\/status/, /CapEff/],
  61: [/automountServiceAccountToken/, /kubectl (edit|patch) (serviceaccount|sa) /],
  62: [/kubectl logs \S+ -c /, /Init:0\/1/],
  63: [/aws eks create-pod-identity-association/, /env \| grep AWS_/],
  64: [/kubectl debug -it \S+ .*--target=/],
  65: [/kubectl create clusterrole \S+ --verb=/, /kubectl create clusterrolebinding \S+ --clusterrole=/, /auth can-i .* -A/],
  66: [/readinessProbe\/httpGet\/path/, /kubectl create secret generic/, /kubectl logs \S+ -c /],
};
let faltan = 0;
for (const [n, pats] of Object.entries(R)) {
  const no = pats.filter(p => !p.test(txt));
  if (no.length) { faltan++; console.log(`  ❌ N${n}: falta en las chuletas ${no.map(String).join("  ·  ")}`); }
}
// índice por recurso (CHULETA-COMANDOS): cada tipo de problema dice dónde se crea, se cambia y se mira
const RECURSOS = ["Deployment", "Pod", "Service", "DNS", "ConfigMap / Secret", "Versiones", "Job / CronJob", "Escalado y cuotas",
                  "Nodos", "Permisos", "Seguridad del Pod", "Red entre Pods", "Dentro del contenedor", "AWS"];
for (const r of RECURSOS) if (!txt.includes(`| **${r}**`)) { faltan++; console.log(`  ❌ el índice por recurso no tiene la fila «${r}»`); }
// la tabla de diagnóstico (CHULETA-COMANDOS, sección 7) dice, para cada síntoma, dónde se arregla
const cabDiag = "| STATUS / síntoma | Qué pasa | Qué miro primero | Se arregla en |";
const lineasDiag = [];
{ const l = txt.split("\n"); const i = l.indexOf(cabDiag);
  if (i < 0) { faltan++; console.log("  ❌ la tabla de diagnóstico no tiene la columna «Se arregla en»"); }
  else for (let k = i + 2; k < l.length && l[k].startsWith("|"); k++) lineasDiag.push(l[k]); }
for (const l of lineasDiag) if (l.split("|").length !== 6 || !l.split("|")[4].trim()) { faltan++; console.log(`  ❌ fila de diagnóstico sin «Se arregla en»: ${l.slice(0, 60)}`); }
for (const s of ["`Pending`", "`ErrImagePull`", "`CreateContainerConfigError`", "`CrashLoopBackOff`", "`OOMKilled`", "`StartError`", "`Running` pero `0/1`", "`RESTARTS`", "`Init:0/1`",
                 "Service sin endpoints", "Service con endpoints", "OTRO namespace", "DNS", "`<unknown>`", "`drain`", "`NotReady`", "`Forbidden`", "versión nueva"])
  if (!lineasDiag.some(l => l.split("|")[1].includes(s))) { faltan++; console.log(`  ❌ la tabla de diagnóstico no trata «${s}»`); }
const cubiertos = Object.keys(R).length;
if (cubiertos !== 66) { faltan++; console.log(`  ❌ la tabla cubre ${cubiertos} niveles, no 66`); }
console.log(faltan ? `${faltan} FALLOS` : "TODO OK: los 66 niveles tienen sus comandos en las chuletas");
process.exitCode = faltan ? 1 : 0;
