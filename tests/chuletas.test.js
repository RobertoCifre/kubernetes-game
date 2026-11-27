// ¿Tienen las chuletas los comandos para resolver CADA nivel? (los comandos genéricos, no la respuesta concreta)
// Uso: node tests/chuletas.test.js   (lee las CHULETA*.md de la raíz del proyecto o de chuletas/)
const fs = require("fs"), path = require("path");
const raiz = path.join(__dirname, "..");
const dir = fs.existsSync(path.join(raiz, "chuletas")) ? path.join(raiz, "chuletas") : raiz;
const txt = fs.readdirSync(dir).filter(f => /^CHULETAS?.*\.md$/.test(f)).map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
// nivel → expresiones que TIENEN que aparecer en alguna chuleta
const R = {
  1: [/kubectl describe node/, /Allocatable/],
  2: [/topology\.kubernetes\.io\/zone/, /-L /],
  3: [/kubectl create namespace/],
  4: [/kubectl create deployment \S+ --image=\S+ --replicas/, /kubectl expose deployment \S+ --port/],
  5: [/kubectl scale deployment \S+ --replicas/],
  6: [/ -l [\w<]/, /--no-headers/, /wc -l/],
  7: [/kubectl logs (deploy\/|<)/],
  8: [/kubectl set image deployment\//],
  9: [/kubectl set image deployment\//],
  10: [/kubectl create configmap \S+ --from-literal/],
  11: [/kubectl create secret generic \S+ --from-literal/],
  12: [/kubectl set resources deployment \S+ (-n \S+ )?--limits=memory/],
  13: [/kubectl set env deployment\//],
  14: [/kubectl edit deployment/, /--type=json/, /"op":\s*"replace"/, /containers\/0\/command/],
  15: [/--requests=cpu/],
  16: [/--requests=(cpu=[^ ,]+,)?memory=/],
  17: [/kubectl set selector service/],
  18: [/targetPort/, /kubectl (edit|patch) svc/],
  19: [/readinessProbe/],
  20: [/livenessProbe/],
  21: [/kubectl port-forward svc\//, /curl http:\/\/localhost/],
  22: [/<servicio>\.<namespace>|<svc>\.<ns>|<servicio>\.<ns>/],
  23: [/\.svc\.cluster\.local/],
  24: [/--type=LoadBalancer/],
  25: [/kubectl rollout status/],
  26: [/kubectl rollout undo/],
  27: [/kubectl rollout history/, /--to-revision/],
  28: [/kubectl edit (configmap|cm)/, /kubectl rollout restart/],
  29: [/-o jsonpath='\{\.data\./, /base64 -d/],
  30: [/kubectl create job \S+ --image/],
  31: [/kubectl create cronjob \S+ --image=\S+ --schedule/],
  32: [/kubectl get (ds|daemonsets?)\b/, /DESIRED/],
  33: [/QoS/, /Burstable/],
  34: [/kubectl autoscale deployment/],
  35: [/missing request for cpu/],
  36: [/kubectl (edit|patch) (resourcequota|quota)/],
  37: [/aws eks update-nodegroup-config .*--scaling-config/],
  38: [/kubectl taint nodes? \S+ \S+-(\s|$|`)/m, /tolerations/],
  39: [/kubectl label nodes? /],
  40: [/kubectl drain \S+ --ignore-daemonsets --delete-emptydir-data/],
  41: [/aws sts get-caller-identity/, /--query Account/],
  42: [/kubectl create role \S+ --verb=/, /kubectl create rolebinding \S+ --role=/, /--serviceaccount=/],
  43: [/kubectl create rolebinding \S+ --clusterrole=/, /kubectl delete rolebinding/],
  44: [/kind: NetworkPolicy/, /podSelector/, /from:/],
  45: [/allowPrivilegeEscalation: false/, /runAsNonRoot/, /seccompProfile/, /drop: \["ALL"\]/],
  46: [/aws eks describe-cluster .*--query cluster\.version/],
  47: [/kubectl get pods .*-o wide/, /PodDisruptionBudget|PDB/, /disruption budget/],
  48: [/ProviderID/, /aws ec2 terminate-instances/],
  49: [/coredns/, /kubectl scale deployment /, /CoreDNS se arregla como cualquier Deployment|es un Deployment más/],
  50: [/kubectl set image deployment\//, /kubectl set selector service/, /kubectl set env deployment\//],
  51: [/kubectl exec -it \S+ -n \S+ -- sh/, /\bps\b/, /\/proc\/1\/cmdline/],
  52: [/memory\.max/],
  53: [/cpu\.max/],
  54: [/\/proc\/1\/status/, /CapEff/],
  55: [/automountServiceAccountToken/, /kubectl (edit|patch) (serviceaccount|sa) /],
  56: [/kubectl logs \S+ -c /, /Init:0\/1/],
  57: [/aws eks create-pod-identity-association/, /env \| grep AWS_/],
  58: [/kubectl debug -it \S+ .*--target=/],
  59: [/kubectl create clusterrole \S+ --verb=/, /kubectl create clusterrolebinding \S+ --clusterrole=/, /auth can-i .* -A/],
  60: [/readinessProbe\/httpGet\/path/, /kubectl create secret generic/, /kubectl logs \S+ -c /],
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
if (cubiertos !== 60) { faltan++; console.log(`  ❌ la tabla cubre ${cubiertos} niveles, no 60`); }
console.log(faltan ? `${faltan} FALLOS` : "TODO OK: los 60 niveles tienen sus comandos en las chuletas");
process.exitCode = faltan ? 1 : 0;
