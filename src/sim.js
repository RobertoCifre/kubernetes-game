/* ============================================================================
   sim.js — el cluster simulado: objetos, controladores, scheduler, red,
   ejecución de contenedores. Imita a Kubernetes/EKS lo bastante como para que
   los comandos y los errores sean los reales.
   ========================================================================== */
"use strict";

const T0 = Date.now(); let DESFASE = 0;
const ahora = () => (Date.now() - T0) / 1000 + DESFASE;
function avanzarReloj(seg){ DESFASE += seg; }

const CUENTA = "123456789012", REGION = "eu-west-1", CLUSTER = "eks-juego", NG = "ng-juego";   // cuenta de ejemplo (la que usa la documentación de AWS)
const K8S_MINOR = "1.36", K8S_VER = "v1.36.5-eks-9adbfea", ECR = "602401143452.dkr.ecr.eu-west-1.amazonaws.com";

let S = null;

/* ---------- utilidades ---------- */
function hash(s){ let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const ALF = "bcdfghjklmnpqrstvwxz2456789";
let CONT_ALEA = 0;
function sufijo(n = 5, semilla){
  let h = hash((semilla !== undefined ? semilla : "") + "|" + (CONT_ALEA++) + "|" + Math.random());
  let s = ""; for (let i = 0; i < n; i++){ s += ALF[h % ALF.length]; h = hash(s + h); } return s;
}
function hashPlantilla(tpl){ let h = hash(JSON.stringify(tpl)); let s = ""; for (let i = 0; i < 10; i++){ s += ALF[h % ALF.length]; h = hash(s + h); } return s; }
const copia = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
function uid(){ const h = n => hash(n + Math.random()).toString(16).padStart(8, "0"); return `${h(1)}-${h(2).slice(0,4)}-${h(3).slice(0,4)}-${h(4).slice(0,4)}-${h(5)}${h(6).slice(0,4)}`; }
function b64e(s){ try { return btoa(unescape(encodeURIComponent(s))); } catch(e){ return btoa(s); } }
function b64d(s){ try { return decodeURIComponent(escape(atob(String(s).trim()))); } catch(e){ return null; } }

function cpuM(q){                       // "100m" → 100 ; "1" → 1000 ; 0.5 → 500
  if (q === undefined || q === null || q === "") return 0;
  const s = String(q).trim(); if (/m$/.test(s)) return parseFloat(s);
  const v = parseFloat(s); return isNaN(v) ? NaN : Math.round(v * 1000);
}
function memMi(q){                      // → MiB
  if (q === undefined || q === null || q === "") return 0;
  const s = String(q).trim(); const v = parseFloat(s); if (isNaN(v)) return NaN;
  if (/Gi$/.test(s)) return v * 1024; if (/Mi$/.test(s)) return v; if (/Ki$/.test(s)) return v / 1024;
  if (/G$/.test(s)) return v * 1e9 / 1048576; if (/M$/.test(s)) return v * 1e6 / 1048576; if (/k$/.test(s)) return v * 1e3 / 1048576;
  return v / 1048576;
}
function edad(t){
  const s = Math.max(0, Math.floor(ahora() - t));
  if (s < 120) return s + "s"; if (s < 3600) return Math.floor(s / 60) + "m" + (s < 600 && s % 60 ? (s % 60) + "s" : "");
  return Math.floor(s / 3600) + "h";
}

/* ---------- catálogo de recursos ---------- */
const RECURSOS = {
  pods:                     {kind:"Pod", api:"v1", cortos:["po","pod","pods"]},
  nodes:                    {kind:"Node", api:"v1", cortos:["no","node","nodes"], cluster:true},
  namespaces:               {kind:"Namespace", api:"v1", cortos:["ns","namespace","namespaces"], cluster:true},
  deployments:              {kind:"Deployment", api:"apps/v1", cortos:["deploy","deployment","deployments"]},
  replicasets:              {kind:"ReplicaSet", api:"apps/v1", cortos:["rs","replicaset","replicasets"]},
  daemonsets:               {kind:"DaemonSet", api:"apps/v1", cortos:["ds","daemonset","daemonsets"]},
  services:                 {kind:"Service", api:"v1", cortos:["svc","service","services"]},
  endpoints:                {kind:"Endpoints", api:"v1", cortos:["ep","endpoint","endpoints"]},
  endpointslices:           {kind:"EndpointSlice", api:"discovery.k8s.io/v1", cortos:["endpointslice","endpointslices"]},
  configmaps:               {kind:"ConfigMap", api:"v1", cortos:["cm","configmap","configmaps"]},
  secrets:                  {kind:"Secret", api:"v1", cortos:["secret","secrets"]},
  horizontalpodautoscalers: {kind:"HorizontalPodAutoscaler", api:"autoscaling/v2", cortos:["hpa","horizontalpodautoscaler","horizontalpodautoscalers"]},
  jobs:                     {kind:"Job", api:"batch/v1", cortos:["job","jobs"]},
  cronjobs:                 {kind:"CronJob", api:"batch/v1", cortos:["cj","cronjob","cronjobs"]},
  resourcequotas:           {kind:"ResourceQuota", api:"v1", cortos:["quota","resourcequota","resourcequotas"]},
  poddisruptionbudgets:     {kind:"PodDisruptionBudget", api:"policy/v1", cortos:["pdb","poddisruptionbudget","poddisruptionbudgets"]},
  networkpolicies:          {kind:"NetworkPolicy", api:"networking.k8s.io/v1", cortos:["netpol","networkpolicy","networkpolicies"]},
  serviceaccounts:          {kind:"ServiceAccount", api:"v1", cortos:["sa","serviceaccount","serviceaccounts"]},
  roles:                    {kind:"Role", api:"rbac.authorization.k8s.io/v1", cortos:["role","roles"]},
  rolebindings:             {kind:"RoleBinding", api:"rbac.authorization.k8s.io/v1", cortos:["rolebinding","rolebindings"]},
  clusterroles:             {kind:"ClusterRole", api:"rbac.authorization.k8s.io/v1", cortos:["clusterrole","clusterroles"], cluster:true},
  clusterrolebindings:      {kind:"ClusterRoleBinding", api:"rbac.authorization.k8s.io/v1", cortos:["clusterrolebinding","clusterrolebindings"], cluster:true},
  events:                   {kind:"Event", api:"v1", cortos:["ev","event","events"]},
};
function recurso(tok){
  if (!tok) return null; tok = tok.toLowerCase().split(".")[0];
  for (const [plural, r] of Object.entries(RECURSOS)) if (plural === tok || r.cortos.includes(tok)) return Object.assign({plural}, r);
  return null;
}
const recursoPorKind = kind => { for (const [plural, r] of Object.entries(RECURSOS)) if (r.kind === kind) return Object.assign({plural}, r); return null; };
const KINDS_GUARDADOS = ["Deployment","DaemonSet","Service","ConfigMap","Secret","HorizontalPodAutoscaler","Job","CronJob","ResourceQuota","PodDisruptionBudget","NetworkPolicy","ServiceAccount","Role","RoleBinding","Pod","ClusterRole","ClusterRoleBinding"];

/* ---------- imágenes que "existen" en el registro simulado ---------- */
const REGISTRO = {
  "nginx": /^(1\.2[0-9](\.\d+)?(-alpine(-slim)?|-perl|-bookworm)?|latest|alpine|stable(-alpine)?|mainline(-alpine)?)$/,
  "nginxinc/nginx-unprivileged": /^(1\.2[0-9](\.\d+)?(-alpine)?|latest|alpine|stable(-alpine)?|mainline(-alpine)?)$/,
  "busybox": /^(1\.3[0-7](\.\d+)?(-(musl|glibc|uclibc))?|latest|stable|musl|glibc|uclibc)$/,
  "polinux/stress": /^(latest|1\.0\.4)$/,
  "httpd": /^(2\.4(\.\d+)?(-alpine)?|latest|alpine)$/,
  "redis": /^(7(\.\d+){0,2}(-alpine)?|latest|alpine)$/,
  "alpine": /^(3(\.\d+){0,2}|latest)$/,
  "python": /^(3(\.\d+){0,2}(-alpine|-slim)?|latest|alpine|slim)$/,
  "postgres": /^(1[4-7](\.\d+)?(-alpine)?|latest|alpine)$/,
  "public.ecr.aws/aws-cli/aws-cli": /.*/,
  "amazonlinux": /^(2023|2|latest)$/,
  "registry.k8s.io/pause": /.*/,
};
function imagenInfo(img){
  const s = String(img || "").trim(); if (!s) return {ok:false, motivo:"vacia", repo:"", tag:""};
  let repo = s, tag = "latest";
  const k = s.lastIndexOf(":"); if (k > s.lastIndexOf("/")){ repo = s.slice(0, k); tag = s.slice(k + 1); }
  repo = repo.replace(/^docker\.io\//, "").replace(/^library\//, "");
  if (repo.includes("/eks/") || /^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\//.test(repo)) return {ok:true, repo, tag, sistema:true};
  const re = REGISTRO[repo];
  if (!re) return {ok:false, motivo:"repo", repo, tag};
  if (!re.test(tag)) return {ok:false, motivo:"tag", repo, tag};
  return {ok:true, repo, tag};
}
function referenciaCompleta(i){ return (i.repo.includes("/") && i.repo.split("/")[0].includes(".") ? "" : "docker.io/" + (i.repo.includes("/") ? "" : "library/")) + i.repo + ":" + i.tag; }
function perfil(c){
  const i = imagenInfo(c.image);
  if (i.sistema) return {tipo:"sistema", root:true};
  if (i.repo === "nginx" || i.repo === "httpd") return {tipo:"web", puerto:80, root:true, curl:true};
  if (i.repo === "nginxinc/nginx-unprivileged") return {tipo:"web", puerto:8080, root:false, curl:true};
  if (i.repo === "polinux/stress") return {tipo:"stress", root:true};
  if (["busybox","alpine"].includes(i.repo)) return {tipo:"shell", root:true};
  return {tipo:"generico", root:true};
}

/* ---------- estado inicial ---------- */
let CONT_NODOS = 0;
function nuevoNodo(az){
  CONT_NODOS++;
  const sub = az.endsWith("a") ? 3 : 4;
  const ip = `10.0.${sub}.${(37 + CONT_NODOS * 71) % 230 + 10}`;
  const name = `ip-${ip.replace(/\./g, "-")}.${REGION}.compute.internal`;
  const id = "i-0" + (hash(name + "a" + CONT_NODOS).toString(16) + hash(name + "b").toString(16)).padEnd(16, "0").slice(0, 16);
  return {name, ip, az, id, ready:true, unsched:false, taints:[], extra:{}, alloc:{cpu:1930, mem:3294, pods:17},
          cap:{cpu:2000, mem:3836, pods:17}, creado:ahora(), roto:false, rotoDesde:0, terminando:false, finT:0, uid:uid()};
}
function etiquetasNodo(n){
  return Object.assign({
    "beta.kubernetes.io/arch":"amd64", "beta.kubernetes.io/instance-type":"t3.medium", "beta.kubernetes.io/os":"linux",
    "eks.amazonaws.com/capacityType":"ON_DEMAND", "eks.amazonaws.com/nodegroup":NG,
    "eks.amazonaws.com/nodegroup-image":"ami-0a1b2c3d4e5f60005", "juego":"eks-quest",
    "kubernetes.io/arch":"amd64", "kubernetes.io/hostname":n.name, "kubernetes.io/os":"linux",
    "node.kubernetes.io/instance-type":"t3.medium", "topology.k8s.aws/zone-id":n.az.endsWith("a") ? "euw1-az3" : "euw1-az1",
    "topology.kubernetes.io/region":REGION, "topology.kubernetes.io/zone":n.az }, n.extra);
}

function metaNueva(name, ns, extra){ return Object.assign({name, namespace:ns, uid:uid(), creationTimestamp:new Date(Date.now()).toISOString().replace(/\.\d+Z$/,"Z"), labels:{}, annotations:{}}, extra || {}); }

function clusterNuevo(){
  CONT_NODOS = 0;
  S = { nodes:[], ng:{min:1, max:2, desired:1}, uniendo:[], ns:{}, objs:[], pods:[], rs:[], eventos:[], pf:{}, defNs:null,
        curlLB:{}, contexto:"eks-juego", creado:ahora(), podIdentity:[] };
  S.nodes.push(nuevoNodo("eu-west-1a"));
  for (const n of ["default","kube-system","kube-public","kube-node-lease"]) crearNamespace(n);
  guardarObj({apiVersion:"v1", kind:"Service", metadata:metaNueva("kubernetes","default",{labels:{component:"apiserver",provider:"kubernetes"}}),
    spec:{type:"ClusterIP", clusterIP:"172.20.0.1", ports:[{name:"https", port:443, protocol:"TCP", targetPort:443}]}});
  const sistema = (nombre, imagen, cpu, mem, memLim, extraLabels) => ({
    metadata:{labels:Object.assign({"k8s-app":nombre}, extraLabels || {})},
    spec:{ priorityClassName:"system-node-critical", tolerations:[{operator:"Exists"}],
      containers:[{name:nombre, image:imagen, resources:{requests:Object.assign({cpu}, mem ? {memory:mem} : {}), limits: memLim ? {memory:memLim} : undefined}}] } });
  const ds = (nombre, imagen, cpu) => guardarObj({apiVersion:"apps/v1", kind:"DaemonSet",
    metadata:metaNueva(nombre, "kube-system", {labels:{"k8s-app":nombre}}),
    spec:{selector:{matchLabels:{"k8s-app":nombre}}, template:sistema(nombre, imagen, cpu)}});
  ds("aws-node", `${ECR}/amazon-k8s-cni:v1.23.3-eksbuild.2`, "50m");
  ds("kube-proxy", `${ECR}/eks/kube-proxy:v1.36.0-eksbuild.65`, "100m");
  ds("eks-pod-identity-agent", `${ECR}/eks/eks-pod-identity-agent:v1.5.0-eksbuild.3`, "25m");
  const dep = (nombre, imagen, cpu, mem, memLim, rep) => guardarObj({apiVersion:"apps/v1", kind:"Deployment",
    metadata:metaNueva(nombre, "kube-system", {labels:{"k8s-app":nombre}}),
    spec:{replicas:rep, selector:{matchLabels:{"k8s-app":nombre}}, template:sistema(nombre, imagen, cpu, mem, memLim)}});
  dep("coredns", `${ECR}/eks/coredns:v1.14.7-eksbuild.35`, "100m", "70Mi", "170Mi", 2);
  dep("metrics-server", `${ECR}/eks/metrics-server:v0.9.1-eksbuild.2`, "100m", "200Mi", "400Mi", 2);
  guardarObj({apiVersion:"v1", kind:"Service", metadata:metaNueva("kube-dns","kube-system",{labels:{"k8s-app":"kube-dns"}}),
    spec:{type:"ClusterIP", clusterIP:"172.20.0.10", selector:{"k8s-app":"coredns"}, ports:[{name:"dns", port:53, protocol:"UDP", targetPort:53}]}});
  reconciliar();
}

function crearNamespace(n, labels){
  if (!S.ns[n]) S.ns[n] = {labels:Object.assign({"kubernetes.io/metadata.name":n}, labels || {}), creado:ahora(), uid:uid()};
  if (!obj("ServiceAccount", n, "default")) guardarObj({apiVersion:"v1", kind:"ServiceAccount", metadata:metaNueva("default", n)});
}
function borrarNamespace(n){
  delete S.ns[n];
  S.objs = S.objs.filter(o => o.metadata.namespace !== n);
  S.pods = S.pods.filter(p => p.ns !== n);
  S.rs = S.rs.filter(r => r.ns !== n);
  S.eventos = S.eventos.filter(e => e.ns !== n);
  for (const k of Object.keys(S.pf)) if (S.pf[k].ns === n) delete S.pf[k];
}

/* ---------- objetos guardados ---------- */
function obj(kind, ns, name){ return S.objs.find(o => o.kind === kind && o.metadata.name === name && (ns === null || o.metadata.namespace === ns)); }
function objs(kind, ns){ return S.objs.filter(o => o.kind === kind && (ns === null || ns === undefined || o.metadata.namespace === ns)); }
function guardarObj(o){
  o.metadata = o.metadata || {}; o.metadata.labels = o.metadata.labels || {}; o.metadata.annotations = o.metadata.annotations || {};
  if (!o.metadata.uid) o.metadata.uid = uid();
  if (!o.metadata.creationTimestamp) o.metadata.creationTimestamp = new Date().toISOString().replace(/\.\d+Z$/,"Z");
  if (o.metadata._t === undefined) Object.defineProperty(o.metadata, "_t", {value:ahora(), enumerable:false, writable:true});
  const i = S.objs.findIndex(x => x.kind === o.kind && x.metadata.name === o.metadata.name && x.metadata.namespace === o.metadata.namespace);
  if (i >= 0){ if (o.metadata._t === undefined || o !== S.objs[i]) Object.defineProperty(o.metadata, "_t", {value:S.objs[i].metadata._t, enumerable:false, writable:true}); S.objs[i] = o; }
  else S.objs.push(o);
  if (o.kind === "Service") prepararServicio(o);
  if (o.kind === "Job"){ o.status = o.status || {}; }
  return o;
}
function borrarObjeto(o){
  S.objs = S.objs.filter(x => x !== o);
  if (o.kind === "Deployment"){ const rss = S.rs.filter(r => r.ns === o.metadata.namespace && r.dep === o.metadata.name);
    S.pods = S.pods.filter(p => !(p.owner && p.owner.kind === "ReplicaSet" && rss.some(r => r.name === p.owner.name) && p.ns === o.metadata.namespace));
    S.rs = S.rs.filter(r => !rss.includes(r)); }
  if (o.kind === "Job" || o.kind === "DaemonSet") S.pods = S.pods.filter(p => !(p.owner && p.owner.kind === o.kind && p.owner.name === o.metadata.name && p.ns === o.metadata.namespace));
  if (o.kind === "Pod") S.pods = S.pods.filter(p => !(p.ns === o.metadata.namespace && p.name === o.metadata.name));
}
function ipServicio(ns, name){ const h = hash(ns + "/" + name); return `172.20.${(h % 250) + 1}.${(Math.floor(h / 250) % 250) + 2}`; }
function prepararServicio(s){
  s.spec = s.spec || {}; s.spec.type = s.spec.type || "ClusterIP";
  if (!s.spec.clusterIP) s.spec.clusterIP = ipServicio(s.metadata.namespace, s.metadata.name);
  s.spec.ports = (s.spec.ports || []).map(p => Object.assign({protocol:"TCP"}, p, {targetPort: p.targetPort !== undefined ? p.targetPort : p.port}));
  if (s.spec.type === "NodePort" || s.spec.type === "LoadBalancer") s.spec.ports.forEach((p, k) => { if (!p.nodePort) p.nodePort = 30000 + (hash(s.metadata.name + k) % 2767); });
  if (s.spec.type === "LoadBalancer"){
    s.status = s.status || {loadBalancer:{}};
    if (!s._lbEn) Object.defineProperty(s, "_lbEn", {value:ahora() + 5, enumerable:false, writable:true});
  } else { s.status = {loadBalancer:{}}; }
}

/* ---------- eventos ---------- */
function evento(ns, objeto, tipo, motivo, msg){
  const e = S.eventos.find(x => x.ns === ns && x.objeto === objeto && x.motivo === motivo && x.msg === msg);
  if (e){ e.cuenta++; e.ultima = ahora(); return; }
  S.eventos.push({ns, objeto, tipo, motivo, msg, primera:ahora(), ultima:ahora(), cuenta:1});
  if (S.eventos.length > 400) S.eventos.splice(0, 100);
}

/* ---------- pods ---------- */
function esDS(p){ return p.owner && p.owner.kind === "DaemonSet"; }
function reqPod(spec){
  let cpu = 0, mem = 0;
  for (const c of spec.containers || []){
    const r = (c.resources || {}).requests || {}, l = (c.resources || {}).limits || {};
    cpu += cpuM(r.cpu !== undefined ? r.cpu : l.cpu) || 0;
    mem += memMi(r.memory !== undefined ? r.memory : l.memory) || 0;
  }
  return {cpu, mem};
}
function limMem(c){ const l = ((c.resources || {}).limits || {}).memory; return l === undefined ? null : memMi(l); }
function qos(spec){
  let garant = true, alguno = false;
  for (const c of spec.containers || []){
    const r = (c.resources || {}).requests || {}, l = (c.resources || {}).limits || {};
    if (r.cpu || r.memory || l.cpu || l.memory) alguno = true;
    const rc = r.cpu !== undefined ? r.cpu : l.cpu, rm = r.memory !== undefined ? r.memory : l.memory;
    if (!(l.cpu && l.memory && cpuM(rc) === cpuM(l.cpu) && memMi(rm) === memMi(l.memory))) garant = false;
  }
  return !alguno ? "BestEffort" : garant ? "Guaranteed" : "Burstable";
}
function podsEnNodo(n){ return S.pods.filter(p => p.node === n.name && !p.borrando && !["Succeeded","Failed"].includes(p.fase)); }
function usoNodo(n){
  let cpu = 0, mem = 0;
  for (const p of podsEnNodo(n)){ const r = reqPod(p.spec); cpu += r.cpu; mem += r.mem; }
  return {cpu, mem, pods:podsEnNodo(n).length};
}
function ipPod(n){ const base = n.ip.split(".").slice(0, 3).join("."); for (let k = 0; k < 200; k++){ const ip = `${base}.${100 + ((hash(n.name + k + S.pods.length) + k) % 150)}`; if (!S.pods.some(p => p.ip === ip)) return ip; } return base + ".250"; }

function crearPod(ns, nombre, plantilla, owner){
  const p = {name:nombre, ns, uid:uid(), owner, labels:copia((plantilla.metadata || {}).labels || {}), annotations:copia((plantilla.metadata || {}).annotations || {}),
             spec:copia(plantilla.spec || {}), node:null, ip:null, creado:ahora(), arranque:null, envSnap:null, proc:null,
             estado:"Pending", listo:false, reinicios:0, ultimo:null, fase:"Pending", borrando:false};
  if (!p.spec.restartPolicy) p.spec.restartPolicy = "Always";
  if (!p.spec.serviceAccountName) p.spec.serviceAccountName = "default";
  // el token de la ServiceAccount se decide AL CREAR el Pod (admisión): cambiar la SA después no afecta a los Pods que ya existen
  const saObj = obj("ServiceAccount", ns, p.spec.serviceAccountName);
  p.tokenMontado = p.spec.automountServiceAccountToken === true || (p.spec.automountServiceAccountToken !== false && !(saObj && saObj.automountServiceAccountToken === false));
  // EKS Pod Identity: el webhook inyecta estas variables AL CREAR el Pod si su ServiceAccount tiene asociación
  if ((S.podIdentity || []).some(a => a.ns === ns && a.sa === p.spec.serviceAccountName)){
    for (const c of p.spec.containers || []){
      c.env = (c.env || []).filter(e => !/^AWS_(STS_REGIONAL_ENDPOINTS|DEFAULT_REGION|REGION|CONTAINER_CREDENTIALS_FULL_URI|CONTAINER_AUTHORIZATION_TOKEN_FILE)$/.test(e.name)).concat([
        {name:"AWS_STS_REGIONAL_ENDPOINTS", value:"regional"}, {name:"AWS_DEFAULT_REGION", value:REGION}, {name:"AWS_REGION", value:REGION},
        {name:"AWS_CONTAINER_CREDENTIALS_FULL_URI", value:"http://169.254.170.23/v1/credentials"},
        {name:"AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE", value:"/var/run/secrets/pods.eks.amazonaws.com/serviceaccount/eks-pod-identity-token"}]);
    }
  }
  S.pods.push(p);
  return p;
}

/* admisión: cuotas y Pod Security */
function admitir(ns, plantilla, nombre){
  for (const q of objs("ResourceQuota", ns)){
    const hard = (q.spec || {}).hard || {};
    if (hard.pods !== undefined){
      const usados = S.pods.filter(p => p.ns === ns && !p.borrando && !["Succeeded","Failed"].includes(p.fase)).length;
      if (usados + 1 > parseInt(hard.pods, 10)) return `pods "${nombre}" is forbidden: exceeded quota: ${q.metadata.name}, requested: pods=1, used: pods=${usados}, limited: pods=${hard.pods}`;
    }
  }
  const nivel = (S.ns[ns] && S.ns[ns].labels["pod-security.kubernetes.io/enforce"]) || "";
  if (nivel === "restricted" || nivel === "baseline"){
    const spec = plantilla.spec || {}; const psc = spec.securityContext || {}; const fallos = [];
    for (const c of [...(spec.initContainers || []), ...(spec.containers || [])]){
      const sc = c.securityContext || {};
      if (sc.privileged) fallos.push(`privileged (container "${c.name}" must not set securityContext.privileged=true)`);
      if (nivel === "restricted"){
        if (sc.allowPrivilegeEscalation !== false) fallos.push(`allowPrivilegeEscalation != false (container "${c.name}" must set securityContext.allowPrivilegeEscalation=false)`);
        const drop = ((sc.capabilities || {}).drop || []).map(String);
        if (!drop.includes("ALL")) fallos.push(`unrestricted capabilities (container "${c.name}" must set securityContext.capabilities.drop=["ALL"])`);
      }
    }
    if (nivel === "restricted"){
      const cs = [...(spec.initContainers || []), ...(spec.containers || [])];
      if (!(psc.runAsNonRoot === true || cs.every(c => (c.securityContext || {}).runAsNonRoot === true)))
        fallos.push(`runAsNonRoot != true (pod or container "${(cs[0] || {}).name}" must set securityContext.runAsNonRoot=true)`);
      const tipoSec = x => ((x || {}).seccompProfile || {}).type;
      if (!(["RuntimeDefault","Localhost"].includes(tipoSec(psc)) || cs.every(c => ["RuntimeDefault","Localhost"].includes(tipoSec(c.securityContext)))))
        fallos.push(`seccompProfile (pod or container "${(cs[0] || {}).name}" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")`);
    }
    if (fallos.length) return `pods "${nombre}" is forbidden: violates PodSecurity "${nivel}:latest": ${fallos.join(", ")}`;
  }
  return null;
}

/* ---------- entorno y volúmenes ---------- */
function resolverEnv(p){
  const c = (p.spec.containers || [])[0] || {}; const vars = {};
  for (const ef of c.envFrom || []){
    if (ef.configMapRef){ const cm = obj("ConfigMap", p.ns, ef.configMapRef.name); if (!cm){ if (!ef.configMapRef.optional) return {error:`configmap "${ef.configMapRef.name}" not found`}; continue; } Object.assign(vars, cm.data || {}); }
    if (ef.secretRef){ const s = obj("Secret", p.ns, ef.secretRef.name); if (!s){ if (!ef.secretRef.optional) return {error:`secret "${ef.secretRef.name}" not found`}; continue; } for (const [k, v] of Object.entries(s.data || {})) vars[k] = b64d(v) ?? ""; }
  }
  for (const e of c.env || []){
    if (!e || !e.name) continue;
    if (e.valueFrom){
      const cmk = e.valueFrom.configMapKeyRef, sk = e.valueFrom.secretKeyRef;
      if (cmk){ const cm = obj("ConfigMap", p.ns, cmk.name);
        if (!cm){ if (cmk.optional) continue; return {error:`configmap "${cmk.name}" not found`}; }
        if (!cm.data || !(cmk.key in cm.data)){ if (cmk.optional) continue; return {error:`couldn't find key ${cmk.key} in ConfigMap ${p.ns}/${cmk.name}`}; }
        vars[e.name] = String(cm.data[cmk.key]); }
      else if (sk){ const s = obj("Secret", p.ns, sk.name);
        if (!s){ if (sk.optional) continue; return {error:`secret "${sk.name}" not found`}; }
        if (!s.data || !(sk.key in s.data)){ if (sk.optional) continue; return {error:`couldn't find key ${sk.key} in Secret ${p.ns}/${sk.name}`}; }
        vars[e.name] = b64d(s.data[sk.key]) ?? ""; }
    } else vars[e.name] = e.value === undefined || e.value === null ? "" : String(e.value);
  }
  return {vars};
}
function volumenesFaltan(p){
  for (const v of p.spec.volumes || []){
    if (v.configMap && !obj("ConfigMap", p.ns, v.configMap.name) && !v.configMap.optional) return {vol:v.name, msg:`configmap "${v.configMap.name}" not found`};
    if (v.secret && !obj("Secret", p.ns, v.secret.secretName) && !v.secret.optional) return {vol:v.name, msg:`secret "${v.secret.secretName}" not found`};
  }
  return null;
}
function contenidoWeb(p, ruta){
  const c = p.spec.containers[0];
  const m = (c.volumeMounts || []).find(vm => /^\/usr\/share\/nginx\/html\/?$/.test(vm.mountPath));
  if (m){ const v = (p.spec.volumes || []).find(x => x.name === m.name);
    if (v && v.configMap){ const cm = obj("ConfigMap", p.ns, v.configMap.name); const ficheros = (cm && cm.data) || {};
      const f = ruta === "/" ? "index.html" : ruta.replace(/^\//, ""); return f in ficheros ? {codigo:200, cuerpo:ficheros[f]} : {codigo:404, cuerpo:"<html>404 Not Found</html>"}; } }
  if (ruta === "/" || ruta === "/index.html") return {codigo:200, cuerpo:"<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, nginx is successfully installed and working.</p>\n</body>\n</html>"};
  return {codigo:404, cuerpo:"<html>\n<head><title>404 Not Found</title></head>\n<body>\n<center><h1>404 Not Found</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>"};
}

/* ---------- mini-shell (busybox): scripts y comandos ---------- */
const APPLETS = ["sh","ash","echo","printf","sleep","exit","true","false","test","[","wget","nslookup","cat","env","printenv","hostname","date","ls","ps","whoami","id","pwd","uname","nc","ping","head","tail","grep","wc","export","cd","top","df","free","mkdir","touch","rm","stress"];
function palabras(s, env){
  const r = []; let act = "", q = null, hay = false;
  const exp = t => t.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a, b) => (env[a || b] ?? ""));
  for (let i = 0; i < s.length; i++){
    const c = s[i];
    if (q === "'"){ if (c === "'") q = null; else act += c; continue; }
    if (q === '"'){ if (c === '"') q = null; else if (c === "$"){ const m = s.slice(i).match(/^\$\{(\w+)\}|^\$(\w+)/); if (m){ act += env[m[1] || m[2]] ?? ""; i += m[0].length - 1; } else act += c; } else act += c; continue; }
    if (c === "'" || c === '"'){ q = c; hay = true; continue; }
    if (/\s/.test(c)){ if (act !== "" || hay) r.push(act); act = ""; hay = false; continue; }
    if (c === "$"){ const m = s.slice(i).match(/^\$\{(\w+)\}|^\$(\w+)/); if (m){ act += exp(m[0]); i += m[0].length - 1; hay = true; continue; } }
    act += c;
  }
  if (act !== "" || hay) r.push(act);
  return r;
}
function partirNivelSuperior(s, seps){         // parte por ; \n respetando comillas
  const r = []; let act = "", q = null;
  for (let i = 0; i < s.length; i++){
    const c = s[i];
    if (q){ act += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"'){ q = c; act += c; continue; }
    if (seps.includes(c)){ if (act.trim()) r.push(act.trim()); act = ""; continue; }
    act += c;
  }
  if (act.trim()) r.push(act.trim());
  return r;
}
function partirCadena(s){                      // a && b || c  → [{op:null,cmd:a},{op:"&&",cmd:b},…]
  const r = []; let act = "", q = null, op = null;
  for (let i = 0; i < s.length; i++){
    const c = s[i];
    if (q){ act += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"'){ q = c; act += c; continue; }
    if ((c === "&" && s[i+1] === "&") || (c === "|" && s[i+1] === "|")){ r.push({op, cmd:act.trim()}); op = c + c; act = ""; i++; continue; }
    act += c;
  }
  r.push({op, cmd:act.trim()});
  return r;
}
function analizarScript(texto){
  const crudos = partirNivelSuperior(texto, [";","\n"]);
  const toks = [];
  for (let t of crudos){
    let m;
    while ((m = t.match(/^(then|do|else)\s+(.*)$/s))){ toks.push(m[1]); t = m[2]; }
    toks.push(t);
  }
  let i = 0;
  function seq(fines){
    const nodos = [];
    while (i < toks.length && !fines.includes(toks[i])){
      const t = toks[i];
      if (/^if\s/.test(t)){ const cond = t.slice(3); i++; if (toks[i] !== "then") throw new Error("se esperaba then"); i++;
        const entonces = seq(["else","fi"]); let sino = []; if (toks[i] === "else"){ i++; sino = seq(["fi"]); } if (toks[i] !== "fi") throw new Error("falta fi"); i++;
        nodos.push({si:cond, entonces, sino}); continue; }
      if (/^while\s/.test(t)){ const cond = t.slice(6); i++; if (toks[i] !== "do") throw new Error("se esperaba do"); i++;
        const cuerpo = seq(["done"]); if (toks[i] !== "done") throw new Error("falta done"); i++; nodos.push({mientras:cond, cuerpo}); continue; }
      if (/^until\s/.test(t)){ const cond = t.slice(6); i++; if (toks[i] !== "do") throw new Error("se esperaba do"); i++;
        const cuerpo = seq(["done"]); if (toks[i] !== "done") throw new Error("falta done"); i++; nodos.push({hasta:cond, cuerpo}); continue; }
      nodos.push({cmd:t}); i++;
    }
    return nodos;
  }
  return seq([]);
}
/* ---------- lo que se ve DENTRO de un contenedor: usuario, capabilities, procesos, cgroups, token ---------- */
const BITS_CAP = {CHOWN:0,DAC_OVERRIDE:1,DAC_READ_SEARCH:2,FOWNER:3,FSETID:4,KILL:5,SETGID:6,SETUID:7,SETPCAP:8,LINUX_IMMUTABLE:9,NET_BIND_SERVICE:10,NET_BROADCAST:11,NET_ADMIN:12,NET_RAW:13,IPC_LOCK:14,IPC_OWNER:15,SYS_MODULE:16,SYS_RAWIO:17,SYS_CHROOT:18,SYS_PTRACE:19,SYS_PACCT:20,SYS_ADMIN:21,SYS_BOOT:22,SYS_NICE:23,SYS_RESOURCE:24,SYS_TIME:25,SYS_TTY_CONFIG:26,MKNOD:27,LEASE:28,AUDIT_WRITE:29,AUDIT_CONTROL:30,SETFCAP:31};
const CAPS_DEFECTO = ["CHOWN","DAC_OVERRIDE","FOWNER","FSETID","KILL","SETGID","SETUID","SETPCAP","NET_BIND_SERVICE","NET_RAW","SYS_CHROOT","MKNOD","AUDIT_WRITE","SETFCAP"];   // las de containerd por defecto = 0x00000000a80425fb
function capsDe(c){
  const sc = (c && c.securityContext) || {}; const capc = sc.capabilities || {};
  if (sc.privileged) return 0x1ffffffffff;
  let set = new Set(CAPS_DEFECTO);
  const drop = (capc.drop || []).map(x => String(x).toUpperCase().replace(/^CAP_/, ""));
  if (drop.includes("ALL")) set = new Set(); else drop.forEach(x => set.delete(x));
  for (const x of capc.add || []) set.add(String(x).toUpperCase().replace(/^CAP_/, ""));
  let v = 0; for (const x of set) if (x in BITS_CAP) v += 2 ** BITS_CAP[x];
  return v;
}
const hex16 = v => v.toString(16).padStart(16, "0");
function usuarioDe(p, c){
  const psc = (p && p.spec && p.spec.securityContext) || {}, csc = (c && c.securityContext) || {};
  const u = csc.runAsUser !== undefined ? csc.runAsUser : psc.runAsUser;
  if (u !== undefined && u !== null) return parseInt(u, 10);
  if (c && /pause/.test(c.image || "")) return 65535;
  return perfil(c || {}).root ? 0 : 101;
}
function usuarioCtx(ctx){ return usuarioDe(ctx.pod && !ctx.debug ? ctx.pod : null, ctx.c || (ctx.pod && ctx.pod.spec ? ctx.pod.spec.containers[0] : {image:"busybox"})); }
const nombreUsuario = u => u === 0 ? "root" : u === 101 ? "nginx" : String(u);
function procesoPrincipal(p){
  const c = p.spec.containers[0]; const perf = perfil(c); const cmd = [...(c.command || []), ...(c.args || [])];
  if (perf.tipo === "web" && !cmd.length) return "nginx: master process nginx -g daemon off;";
  if (cmd.length) return cmd.join(" ");
  if (/pause/.test(c.image)) return "/pause";
  if (perf.tipo === "sistema") return "/" + c.name;
  return perf.tipo === "generico" ? "/app" : "sh";
}
function procesosDe(p){
  const c = p.spec.containers[0]; const u = nombreUsuario(usuarioDe(p, c));
  const l = [{pid:1, user:u, cmd:procesoPrincipal(p)}];
  if (perfil(c).tipo === "web" && !(c.command && c.command.length)) l.push({pid:29, user:perfil(c).root ? "nginx" : u, cmd:"nginx: worker process"}, {pid:30, user:perfil(c).root ? "nginx" : u, cmd:"nginx: worker process"});
  return l;
}
function tokenMontado(ctx){
  if (!ctx.pod || !ctx.pod.spec || ctx.debug) return false;
  return ctx.pod.tokenMontado !== false;
}
function ficheroContenedor(ctx, ruta){
  ruta = String(ruta).replace(/\/+$/, "");
  const c = ctx.c || (ctx.pod && ctx.pod.spec ? ctx.pod.spec.containers[0] : {}) || {};
  const lim = ((c.resources || {}).limits) || {}, req = ((c.resources || {}).requests) || {};
  const proc1 = ctx.objetivo || null;   // procesos visibles (mismo contenedor, o debug con --target)
  switch (ruta){
    case "/sys/fs/cgroup/memory.max": { const m = limMem(c); return m === null ? "max" : String(Math.round(m * 1048576)); }
    case "/sys/fs/cgroup/memory.min": return "0";
    case "/sys/fs/cgroup/memory.current": return String(Math.round(((ctx.pod && ctx.pod.proc && ctx.pod.proc.mem) || 2.6) * 1048576));
    case "/sys/fs/cgroup/memory.events": return "low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0";
    case "/sys/fs/cgroup/cpu.max": { const q = lim.cpu !== undefined ? cpuM(lim.cpu) : null; return q === null ? "max 100000" : `${Math.round(q * 100)} 100000`; }
    case "/sys/fs/cgroup/cpu.weight": { const r = cpuM(req.cpu !== undefined ? req.cpu : lim.cpu) || 0; const shares = Math.max(2, Math.floor(r * 1024 / 1000)); return String(Math.floor(1 + ((shares - 2) * 9999) / 262142)); }
    case "/sys/fs/cgroup/cpu.stat": { const vivo = Math.max(1, Math.floor(ahora() - ((ctx.pod && ctx.pod.arranque) || ahora() - 30))); const conLim = lim.cpu !== undefined;
      return `usage_usec ${vivo * 1100}\nuser_usec ${vivo * 700}\nsystem_usec ${vivo * 400}\nnr_periods ${conLim ? vivo * 10 : 0}\nnr_throttled 0\nthrottled_usec 0`; }
    case "/sys/fs/cgroup/pids.max": return "max";
    case "/sys/fs/cgroup/cgroup.controllers": return "cpuset cpu io memory hugetlb pids rdma misc";
    case "/var/run/secrets/kubernetes.io/serviceaccount/token": return tokenMontado(ctx) ? "eyJhbGciOiJSUzI1NiIsImtpZCI6IjdmM2E5In0.eyJhdWQiOlsiaHR0cHM6Ly9rdWJlcm5ldGVzLmRlZmF1bHQuc3ZjIl0sInN1YiI6InN5c3RlbTpzZXJ2aWNlYWNjb3VudDp" + b64e(`${ctx.pod.ns}:${ctx.pod.spec.serviceAccountName || "default"}`).replace(/=/g, "") + "In0.c2ltdWxhZG8" : null;
    case "/var/run/secrets/kubernetes.io/serviceaccount/namespace": return tokenMontado(ctx) ? ctx.pod.ns : null;
    case "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt": return tokenMontado(ctx) ? "-----BEGIN CERTIFICATE-----\nMIIDBTCCAe2gAwIBAgIIZ…(certificado de la CA del cluster)…\n-----END CERTIFICATE-----" : null;
  }
  if (/^\/proc\/(1|self)\/(status|cmdline|environ)$/.test(ruta)){
    const propio = ruta.includes("/self/") || !proc1;
    const p = propio ? null : proc1;
    const cc = p ? p.spec.containers[0] : c;
    const uid = p ? usuarioDe(p, cc) : usuarioCtx(ctx);
    if (ruta.endsWith("cmdline")) return p ? procesoPrincipal(p) : "sh";
    if (ruta.endsWith("environ")){
      if (p && ctx.debug && uid !== usuarioCtx(ctx) && !(capsDe(ctx.c || {}) & 2 ** 19)) return null;
      return Object.entries(p ? (p.envSnap || {}) : (ctx.env || {})).map(([k, v]) => `${k}=${v}`).join("\n");
    }
    const caps = capsDe(cc); const eff = uid === 0 ? caps : 0;
    const scc = cc.securityContext || {}; const psc = (p && p.spec.securityContext) || {};
    const seccomp = ((scc.seccompProfile || psc.seccompProfile || {}).type || "RuntimeDefault") !== "Unconfined";
    return `Name:\t${(p ? procesoPrincipal(p) : "sh").split(/[ :]/)[0].replace(/^\//, "") || "sh"}\nUmask:\t0022\nState:\tS (sleeping)\nTgid:\t${propio ? 41 : 1}\nPid:\t${propio ? 41 : 1}\nPPid:\t0\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nGid:\t${uid}\t${uid}\t${uid}\t${uid}\nThreads:\t1\nCapInh:\t0000000000000000\nCapPrm:\t${hex16(eff)}\nCapEff:\t${hex16(eff)}\nCapBnd:\t${hex16(caps)}\nCapAmb:\t0000000000000000\nNoNewPrivs:\t${scc.allowPrivilegeEscalation === false ? 1 : 0}\nSeccomp:\t${seccomp ? 2 : 0}`;
  }
  if (ruta.startsWith("/proc/1/root/") && proc1){ const sub = ruta.slice(12); if (sub === "/etc/hostname") return proc1.name; return null; }
  return null;
}

class Bloqueo { constructor(){ this.bloqueo = true; } }
class Salida { constructor(c){ this.codigo = c; } }
function comandoSimple(linea, ctx){
  linea = linea.replace(/\s*\d?>\s*\/dev\/null/g, "").replace(/\s*2>&1/g, "").replace(/\s*>&2/g, "").trim();
  if (!linea) return 0;
  const asig = linea.match(/^(\w+)=(.*)$/); if (asig && !linea.includes(" ")){ ctx.env[asig[1]] = palabras(asig[2], ctx.env)[0] || ""; return 0; }
  const w = palabras(linea, ctx.env); if (!w.length) return 0;
  let [prog, ...a] = w;
  if (prog === "export"){ for (const x of a){ const m = x.match(/^(\w+)=(.*)$/); if (m) ctx.env[m[1]] = m[2]; } return 0; }
  const disponible = ctx.perfil.tipo === "shell" || ctx.perfil.tipo === "web" || ctx.perfil.tipo === "stress";
  if (prog === "curl" && !(ctx.perfil.curl)){ ctx.out(`sh: curl: not found`); return 127; }
  if (prog === "bash" && ctx.perfil.tipo !== "generico"){ ctx.out(`sh: bash: not found`); return 127; }
  if (!disponible || (!APPLETS.includes(prog) && prog !== "curl" && !prog.startsWith("/"))){ ctx.out(`sh: ${prog}: not found`); return 127; }
  prog = prog.replace(/^\/bin\//, "").replace(/^\/usr\/bin\//, "");
  switch (prog){
    case "echo": { let n = false; if (a[0] === "-n"){ n = true; a = a.slice(1); } if (a[0] === "-e") a = a.slice(1); ctx.out(a.join(" ")); return 0; }
    case "printf": ctx.out((a[0] || "").replace(/\\n$/, "").replace(/%s/g, () => a.shift() && (a[0] || ""))); return 0;
    case "sleep": { const n = a[0] === "infinity" ? Infinity : parseFloat(a[0] || "0"); if (n >= 20) throw new Bloqueo(); ctx.durmio = (ctx.durmio || 0) + (n || 0); return 0; }
    case "exit": throw new Salida(parseInt(a[0] || "0", 10) || 0);
    case "true": return 0; case "false": return 1;
    case "test": case "[": { const args = prog === "[" ? a.slice(0, a[a.length - 1] === "]" ? -1 : a.length) : a; return evaluarTest(args) ? 0 : 1; }
    case "env": case "printenv": { if (prog === "printenv" && a[0]){ if (a[0] in ctx.env){ ctx.out(ctx.env[a[0]]); return 0; } return 1; }
      for (const [k, v] of Object.entries(ctx.env)) ctx.out(`${k}=${v}`); return 0; }
    case "hostname": ctx.out(ctx.hostname || "pod"); return 0;
    case "date": ctx.out(new Date().toUTCString().replace("GMT", "UTC")); return 0;
    case "whoami": { const u = usuarioCtx(ctx); ctx.out(u === 0 ? "root" : u === 101 ? "nginx" : `whoami: unknown uid ${u}`); return u === 0 || u === 101 ? 0 : 1; }
    case "id": { const u = usuarioCtx(ctx); const n = u === 0 ? "root" : u === 101 ? "nginx" : null; ctx.out(n ? `uid=${u}(${n}) gid=${u}(${n}) groups=${u}(${n})` : `uid=${u} gid=${u} groups=${u}`); return 0; }
    case "pwd": ctx.out("/"); return 0;
    case "uname": ctx.out(a.includes("-r") ? "6.18.62-127.179.amzn2023.x86_64" : "Linux"); return 0;
    case "ls": {
      const ruta = (a.filter(x => !x.startsWith("-"))[0] || "/").replace(/\/$/, "") || "/";
      if (ruta.includes("nginx/html")) { ctx.out("50x.html\nindex.html"); return 0; }
      if (ruta === "/var/run/secrets/kubernetes.io/serviceaccount"){ if (!tokenMontado(ctx)){ ctx.out(`ls: ${ruta}: No such file or directory`); return 1; } ctx.out("ca.crt\nnamespace\ntoken"); return 0; }
      if (ruta === "/sys/fs/cgroup"){ ctx.out("cgroup.controllers  cgroup.procs  cpu.max  cpu.stat  cpu.weight  memory.current  memory.events  memory.max  memory.min  pids.max"); return 0; }
      if (ruta === "/" ) { ctx.out("bin    dev    etc    home   lib    proc   root   run    sys    tmp    usr    var"); return 0; }
      ctx.out(`ls: ${ruta}: No such file or directory`); return 1; }
    case "ps": {
      const filas = (ctx.objetivo ? procesosDe(ctx.objetivo) : []).concat([{pid:ctx.objetivo ? 41 : 1, user:nombreUsuario(usuarioCtx(ctx)), cmd:"sh"}, {pid:ctx.objetivo ? 48 : 7, user:nombreUsuario(usuarioCtx(ctx)), cmd:"ps"}]);
      ctx.out("PID   USER     TIME  COMMAND\n" + filas.map(f => `${String(f.pid).padStart(5)} ${String(f.user).padEnd(8)}  0:00 ${f.cmd}`).join("\n")); return 0; }
    case "cat": {
      if (a[0] === "/etc/resolv.conf"){ ctx.out(`search ${ctx.ns}.svc.cluster.local svc.cluster.local cluster.local ${REGION}.compute.internal\nnameserver 172.20.0.10\noptions ndots:5`); return 0; }
      if (a[0] === "/etc/hostname"){ ctx.out(ctx.hostname || "pod"); return 0; }
      if (a[0] && a[0].startsWith("/usr/share/nginx/html") && ctx.pod){ const r = contenidoWeb(ctx.pod, a[0].replace("/usr/share/nginx/html", "") || "/"); if (r.codigo === 200){ ctx.out(r.cuerpo); return 0; } }
      const f = a[0] ? ficheroContenedor(ctx, a[0]) : null;
      if (f !== null){ ctx.out(f); return 0; }
      ctx.out(`cat: can't open '${a[0] || ""}': No such file or directory`); return 1; }
    case "nslookup": {
      const nombre = a.filter(x => !x.startsWith("-"))[0]; if (!nombre){ ctx.out("BusyBox v1.37.0 multi-call binary.\n\nUsage: nslookup [-type=QUERY_TYPE] [-debug] HOST [DNS_SERVER]"); return 1; }
      const r = resolver(nombre, ctx.ns);
      if (r.error === "timeout"){ ctx.out(";; connection timed out; no servers could be reached"); return 1; }
      if (r.error){ ctx.out(`Server:\t\t172.20.0.10\nAddress:\t172.20.0.10:53\n\n** server can't find ${nombre}: NXDOMAIN`); return 1; }
      ctx.out(`Server:\t\t172.20.0.10\nAddress:\t172.20.0.10:53\n\n${r.externo ? "Non-authoritative answer:\n" : ""}Name:\t${r.fqdn}\nAddress: ${r.ip}`); return 0; }
    case "wget": case "curl": {
      const url = a.filter(x => !x.startsWith("-") && !/^\d+$/.test(x))[0];
      if (!url){ ctx.out(prog === "wget" ? "BusyBox v1.37.0 multi-call binary.\n\nUsage: wget [-cqS] [-O FILE] [-T SEC] URL..." : "curl: try 'curl --help' for more information"); return 1; }
      const r = peticionHTTP(ctx.pod, ctx.ns, url);
      const silencioso = a.some(x => /^-q/.test(x) || x === "-qO-") || prog === "curl";
      if (r.ok){ if (a.some(x => /O-|^-O$/.test(x)) || prog === "curl") ctx.out(r.cuerpo); else if (!silencioso) ctx.out(`Connecting to ${r.host} (${r.ip}:${r.puerto})\nsaving to 'index.html'\n'index.html' saved`); return 0; }
      if (prog === "curl"){ ctx.out(r.curl); return r.codigoCurl || 7; }
      ctx.out(r.wget); return 1; }
    case "stress": ctx.out("stress: info: [1] dispatching hogs: 0 cpu, 0 io, 1 vm, 0 hdd"); throw new Bloqueo();
    default: return 0;
  }
}
function evaluarTest(a){
  if (!a.length) return false;
  if (a[0] === "!") return !evaluarTest(a.slice(1));
  if (a.length === 2 && a[0] === "-z") return a[1] === "";
  if (a.length === 2 && a[0] === "-n") return a[1] !== "";
  if (a.length === 2 && (a[0] === "-f" || a[0] === "-e" || a[0] === "-d")) return a[1] === "/etc/resolv.conf" || a[1] === "/tmp";
  if (a.length === 1) return a[0] !== "";
  if (a.length === 3){ const [x, op, y] = a;
    if (op === "=" || op === "==") return x === y; if (op === "!=") return x !== y;
    const nx = parseFloat(x), ny = parseFloat(y);
    if (op === "-eq") return nx === ny; if (op === "-ne") return nx !== ny; if (op === "-gt") return nx > ny; if (op === "-lt") return nx < ny; if (op === "-ge") return nx >= ny; if (op === "-le") return nx <= ny; }
  return false;
}
function ejecutarNodos(nodos, ctx){
  let codigo = 0;
  for (const n of nodos){
    if (n.cmd !== undefined){
      for (const parte of partirCadena(n.cmd)){
        if (parte.op === "&&" && codigo !== 0) continue;
        if (parte.op === "||" && codigo === 0) continue;
        codigo = comandoSimple(parte.cmd, ctx);
      }
    } else if (n.si !== undefined){
      const sub = Object.assign({}, ctx, {out:() => {}});
      let c = 0; for (const parte of partirCadena(n.si)){ if (parte.op === "&&" && c !== 0) continue; if (parte.op === "||" && c === 0) continue; c = comandoSimple(parte.cmd, sub); }
      codigo = ejecutarNodos(c === 0 ? n.entonces : n.sino, ctx);
    } else if (n.hasta !== undefined){
      const antes = ctx.lineas.length; ctx.durmio = 0;
      let c = 0; for (const parte of partirCadena(n.hasta)){ if (parte.op === "&&" && c !== 0) continue; if (parte.op === "||" && c === 0) continue; c = comandoSimple(parte.cmd, ctx); }
      if (c === 0){ codigo = 0; continue; }                     // la condición ya se cumple: el bucle termina
      try { ejecutarNodos(n.cuerpo, ctx); } catch(e){ if (!(e instanceof Bloqueo)) throw e; }
      ctx.bucle = {lineas:ctx.lineas.slice(antes), periodo:Math.max(1, ctx.durmio || 1)};
      throw new Bloqueo();                                     // sigue esperando
    } else if (n.mientras !== undefined){
      const antes = ctx.lineas.length; ctx.durmio = 0;
      try { ejecutarNodos(n.cuerpo, ctx); } catch(e){ if (!(e instanceof Bloqueo)) throw e; }
      ctx.bucle = {lineas:ctx.lineas.slice(antes), periodo:Math.max(1, ctx.durmio || 1)};
      throw new Bloqueo();
    }
  }
  return codigo;
}
/* ejecuta un comando (array) como proceso principal o con exec. Devuelve {fin, codigo, lineas, bucle, errorArranque} */
function ejecutarProceso(cmd, env, pod, ns, perf, contenedor){
  const ctx = {env:Object.assign({}, env), lineas:[], ns, pod, perfil:perf, hostname:pod ? pod.name : "pod", cmdPrincipal:cmd.join(" "), bucle:null,
               c:contenedor || (pod && pod.spec ? pod.spec.containers[0] : null), objetivo:pod && pod.spec && !pod.efimero && !contenedor ? pod : null};
  ctx.out = t => { for (const l of String(t).split("\n")) ctx.lineas.push(l); };
  const prog = (cmd[0] || "").replace(/^\/bin\//, "").replace(/^\/usr\/bin\//, "");
  const hayShell = perf.tipo === "shell" || perf.tipo === "web" || perf.tipo === "stress";
  if (!hayShell || (!APPLETS.includes(prog) && prog !== "curl")){
    if (perf.tipo === "generico" && prog) return {fin:"corriendo", codigo:0, lineas:[]};
    return {fin:"starterror", codigo:128, lineas:[], errorArranque:`failed to create containerd task: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "${cmd[0]}": executable file not found in $PATH: unknown`};
  }
  if (prog === "curl" && !perf.curl) return {fin:"starterror", codigo:128, lineas:[], errorArranque:`exec: "curl": executable file not found in $PATH: unknown`};
  try {
    let codigo;
    if ((prog === "sh" || prog === "ash") && cmd[1] === "-c") codigo = ejecutarNodos(analizarScript(cmd.slice(2).join(" ")), ctx);
    else if (prog === "sh" || prog === "ash") codigo = 0;
    else codigo = comandoSimple(cmd.map(x => /\s/.test(x) ? `"${x}"` : x).join(" "), ctx);
    return {fin:"sale", codigo, lineas:ctx.lineas};
  } catch(e){
    if (e instanceof Bloqueo) return {fin:"corriendo", codigo:0, lineas:ctx.lineas, bucle:ctx.bucle};
    if (e instanceof Salida) return {fin:"sale", codigo:e.codigo, lineas:ctx.lineas};
    return {fin:"sale", codigo:2, lineas:ctx.lineas.concat([`sh: syntax error: ${e.message}`])};
  }
}
function logsNginx(){
  return ["/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration",
          "/docker-entrypoint.sh: Launching /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh",
          "/docker-entrypoint.sh: Configuration complete; ready for start up",
          `${new Date().toISOString().slice(0,19).replace("T"," ").replace(/-/g,"/")} [notice] 1#1: nginx/1.27.5`,
          `${new Date().toISOString().slice(0,19).replace("T"," ").replace(/-/g,"/")} [notice] 1#1: start worker processes`];
}
function arrancarContenedor(p){
  const c = p.spec.containers[0]; const perf = perfil(c);
  const cmd = [...(c.command || []), ...(c.args || [])];
  if (perf.tipo === "sistema") return {fin:"corriendo", lineas:[], escucha:null};
  if (perf.tipo === "web" && !(c.command && c.command.length) && !(c.args && c.args.length)) return {fin:"corriendo", lineas:logsNginx(), escucha:perf.puerto};
  if (perf.tipo === "stress"){
    const arg = (c.args || c.command || []).join(" "); const m = arg.match(/--vm-bytes\s+(\d+)([MmGgKk]?)/);
    let mb = m ? parseFloat(m[1]) * (/[Gg]/.test(m[2]) ? 1024 : /[Kk]/.test(m[2]) ? 1/1024 : 1) : 256;
    return {fin:"corriendo", lineas:["stress: info: [1] dispatching hogs: 0 cpu, 0 io, 1 vm, 0 hdd"], mem:mb * 1e6 / 1048576 + 1.5};
  }
  if (!cmd.length){
    if (perf.tipo === "generico") return {fin:"corriendo", lineas:[]};
    return {fin:"sale", codigo:0, lineas:[]};
  }
  const r = ejecutarProceso(cmd, p.envSnap || {}, p, p.ns, perf);
  if (perf.tipo === "web" && r.fin === "corriendo" && cmd.join(" ").includes("nginx")) r.escucha = perf.puerto;
  return r;
}

/* ---------- red: DNS, Services, NetworkPolicy ---------- */
function corednsListos(){ return S.pods.filter(p => p.ns === "kube-system" && p.labels["k8s-app"] === "coredns" && p.listo).length; }
function resolver(nombre, nsOrigen){
  if (corednsListos() === 0) return {error:"timeout"};
  nombre = String(nombre).replace(/\.$/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(nombre)) return {ip:nombre, fqdn:nombre, svc:S.objs.find(o => o.kind === "Service" && o.spec.clusterIP === nombre)};
  if (/\.(com|es|org|net|io|dev|aws)$/.test(nombre) && !nombre.includes(".svc")) return {ip:`142.250.${hash(nombre) % 200}.${hash(nombre + 1) % 200}`, fqdn:nombre, externo:true};
  let base = nombre;
  if (base.endsWith(".svc.cluster.local")) base = base.slice(0, -18); else if (base.endsWith(".svc")) base = base.slice(0, -4);
  const partes = base.split("."); let svcN, nsN;
  if (partes.length === 1){ svcN = partes[0]; nsN = nsOrigen; } else if (partes.length === 2){ [svcN, nsN] = partes; } else return {error:"nx"};
  const s = obj("Service", nsN, svcN); if (!s) return {error:"nx"};
  return {ip:s.spec.clusterIP, svc:s, fqdn:`${svcN}.${nsN}.svc.cluster.local`};
}
function selecciona(sel, labels){
  if (!sel) return true;
  const ml = sel.matchLabels !== undefined || sel.matchExpressions !== undefined ? (sel.matchLabels || {}) : sel;
  for (const [k, v] of Object.entries(ml || {})) if (labels[k] !== String(v)) return false;
  for (const e of sel.matchExpressions || []){
    const v = labels[e.key];
    if (e.operator === "In" && !(e.values || []).includes(v)) return false;
    if (e.operator === "NotIn" && (e.values || []).includes(v)) return false;
    if (e.operator === "Exists" && v === undefined) return false;
    if (e.operator === "DoesNotExist" && v !== undefined) return false;
  }
  return true;
}
function endpointsDe(s){
  if (!s.spec.selector || !Object.keys(s.spec.selector).length) return [];
  return S.pods.filter(p => p.ns === s.metadata.namespace && p.listo && !p.borrando && p.ip && selecciona(s.spec.selector, p.labels));
}
function puertoContenedor(p, tp){
  if (tp === undefined || tp === null) return null;
  if (/^\d+$/.test(String(tp))) return parseInt(tp, 10);
  for (const c of p.spec.containers || []) for (const port of c.ports || []) if (port.name === tp) return port.containerPort;
  return null;
}
function permiteRed(origen, destino){
  const pols = objs("NetworkPolicy", destino.ns).filter(np => {
    const tipos = (np.spec || {}).policyTypes || ["Ingress"];
    return tipos.includes("Ingress") && selecciona((np.spec || {}).podSelector || {}, destino.labels);
  });
  if (!pols.length) return true;
  for (const np of pols) for (const regla of np.spec.ingress || []){
    const desde = regla.from;
    if (!desde || !desde.length) return true;
    for (const f of desde){
      if (!origen) continue;
      if (f.namespaceSelector){
        const nsLab = (S.ns[origen.ns] || {labels:{}}).labels;
        if (selecciona(f.namespaceSelector, nsLab) && (!f.podSelector || selecciona(f.podSelector, origen.labels))) return true;
      } else if (f.podSelector){
        if (origen.ns === destino.ns && selecciona(f.podSelector, origen.labels)) return true;
      }
    }
  }
  return false;
}
function analizarURL(url){
  const m = String(url).match(/^(?:(https?):\/\/)?([^\/:]+)(?::(\d+))?(\/.*)?$/);
  if (!m) return null; return {esquema:m[1] || "http", host:m[2], puerto:m[3] ? parseInt(m[3], 10) : (m[1] === "https" ? 443 : 80), ruta:m[4] || "/"};
}
/* petición HTTP desde un Pod (o desde el "exterior" si origen es null) */
function peticionHTTP(origen, nsOrigen, url, opciones){
  opciones = opciones || {};
  const u = analizarURL(url);
  const malo = (wget, curl, codigoCurl) => ({ok:false, wget, curl, codigoCurl});
  if (!u) return malo(`wget: bad address '${url}'`, `curl: (3) URL rejected: Malformed input to a URL function`, 3);
  if (/\.elb\.amazonaws\.com$/.test(u.host)){
    const s = S.objs.find(o => o.kind === "Service" && o.status && o.status.loadBalancer && (o.status.loadBalancer.ingress || []).some(i => i.hostname === u.host));
    if (!s) return malo(`wget: bad address '${u.host}'`, `curl: (6) Could not resolve host: ${u.host}`, 6);
    const p = s.spec.ports.find(x => x.port === u.puerto); if (!p) return malo("wget: download timed out", `curl: (28) Failed to connect to ${u.host} port ${u.puerto} after 3001 ms: Timeout was reached`, 28);
    return entregar(null, s, p, u, true);
  }
  const r = resolver(u.host, nsOrigen);
  if (r.error) return malo(`wget: bad address '${u.host}'`, `curl: (6) Could not resolve host: ${u.host}`, 6);
  if (r.externo) return {ok:true, cuerpo:"<!doctype html><html>… (web externa) …</html>", host:u.host, ip:r.ip, puerto:u.puerto};
  if (!r.svc) return malo(`wget: can't connect to remote host (${r.ip}): Connection refused`, `curl: (7) Failed to connect to ${u.host} port ${u.puerto}: Connection refused`, 7);
  const sp = r.svc.spec.ports.find(x => x.port === u.puerto);
  if (!sp) return malo("wget: download timed out", `curl: (28) Failed to connect to ${u.host} port ${u.puerto} after 3002 ms: Timeout was reached`, 28);
  return entregar(origen, r.svc, sp, Object.assign(u, {ip:r.ip}), false);
}
function entregar(origen, s, sp, u, desdeFuera){
  const eps = endpointsDe(s);
  const ip = u.ip || s.spec.clusterIP;
  if (!eps.length) return {ok:false, wget:`wget: can't connect to remote host (${ip}): Connection refused`, curl:`curl: (7) Failed to connect to ${u.host} port ${u.puerto} after 1 ms: Couldn't connect to server`, codigoCurl:7};
  const destino = eps[0];
  if (!desdeFuera && !permiteRed(origen, destino)) return {ok:false, wget:"wget: download timed out", curl:`curl: (28) Failed to connect to ${u.host} port ${u.puerto} after 3001 ms: Timeout was reached`, codigoCurl:28};
  const tp = puertoContenedor(destino, sp.targetPort);
  if (!destino.proc || destino.proc.escucha !== tp) return {ok:false, wget:`wget: can't connect to remote host (${ip}): Connection refused`, curl:`curl: (7) Failed to connect to ${u.host} port ${u.puerto} after 0 ms: Couldn't connect to server`, codigoCurl:7};
  const r = contenidoWeb(destino, u.ruta);
  if (r.codigo !== 200) return {ok:false, wget:`wget: server returned error: HTTP/1.1 ${r.codigo} Not Found`, curl:r.cuerpo, codigoCurl:0, cuerpo:r.cuerpo};
  return {ok:true, cuerpo:r.cuerpo, host:u.host, ip, puerto:u.puerto, pod:destino};
}

/* ---------- sondas ---------- */
function probarSonda(p, sonda){
  const c = p.spec.containers[0]; const proc = p.proc || {};
  if (sonda.httpGet){
    const puerto = puertoContenedor(p, sonda.httpGet.port); const ruta = sonda.httpGet.path || "/";
    if (proc.escucha !== puerto) return {ok:false, msg:`Get "http://${p.ip}:${sonda.httpGet.port}${ruta}": dial tcp ${p.ip}:${sonda.httpGet.port}: connect: connection refused`};
    const r = contenidoWeb(p, ruta); if (r.codigo >= 200 && r.codigo < 400) return {ok:true};
    return {ok:false, msg:`HTTP probe failed with statuscode: ${r.codigo}`};
  }
  if (sonda.tcpSocket){
    const puerto = puertoContenedor(p, sonda.tcpSocket.port);
    return proc.escucha === puerto ? {ok:true} : {ok:false, msg:`dial tcp ${p.ip}:${sonda.tcpSocket.port}: connect: connection refused`};
  }
  if (sonda.exec){
    const r = ejecutarProceso(sonda.exec.command || [], p.envSnap || {}, p, p.ns, perfil(c));
    if (r.fin === "starterror") return {ok:false, msg:r.errorArranque};
    return r.codigo === 0 ? {ok:true} : {ok:false, msg:r.lineas.join("\n") || `command ${JSON.stringify(sonda.exec.command)} exited with ${r.codigo}`};
  }
  return {ok:true};
}

/* ---------- evaluación de un Pod ---------- */
const CICLO_CRASH = 12;
function evaluarPod(p){
  if (p.borrando) return;
  const n = S.nodes.find(x => x.name === p.node);
  if (!p.node || !n){ p.estado = "Pending"; p.fase = "Pending"; p.listo = false; return; }
  if (!n.ready){ return; }                                   // nodo caído: se queda con el último estado conocido
  if (["Succeeded","Failed"].includes(p.fase)) return;
  const c = p.spec.containers[0];
  const img = imagenInfo(c.image);
  if (!img.ok){ const t = ahora() - p.creado; p.estado = (t % 20) < 4 ? "ErrImagePull" : "ImagePullBackOff"; p.fase = "Pending"; p.listo = false; p.razonImagen = img; return; }
  const vol = volumenesFaltan(p);
  if (vol){ p.estado = "ContainerCreating"; p.fase = "Pending"; p.listo = false; p.errorMontaje = vol; return; }
  p.errorMontaje = null;
  // init containers: se ejecutan EN ORDEN y cada uno debe terminar con éxito antes del siguiente
  const inits = p.spec.initContainers || [];
  if (inits.length && !p.initHecho){
    p.ip = p.ip || ipPod(n); p.initLogs = p.initLogs || {};
    for (let k = p.initIdx || 0; k < inits.length; k++){
      const ic = inits[k];
      const ii = imagenInfo(ic.image);
      if (!ii.ok){ const t = ahora() - p.creado; p.estado = (t % 20) < 4 ? "Init:ErrImagePull" : "Init:ImagePullBackOff"; p.fase = "Pending"; p.listo = false; p.razonImagen = ii; return; }
      const isc = ic.securityContext || {}, ipsc = p.spec.securityContext || {};
      if ((isc.runAsNonRoot ?? ipsc.runAsNonRoot) === true && perfil(ic).root && !((isc.runAsUser ?? ipsc.runAsUser) > 0)){
        p.estado = "Init:CreateContainerConfigError"; p.fase = "Pending"; p.listo = false;
        p.errorConfig = `container has runAsNonRoot and image will run as root (pod: "${p.name}_${p.ns}(${p.uid})", container: ${ic.name})`; return;
      }
      const envI = {}; for (const e of ic.env || []) if (e && e.name && "value" in e) envI[e.name] = String(e.value);
      const r = ejecutarProceso([...(ic.command || []), ...(ic.args || [])], envI, p, p.ns, perfil(ic), ic);
      const veces = r.bucle ? Math.min(30, 1 + Math.floor((ahora() - p.creado) / r.bucle.periodo)) : 1;
      p.initLogs[ic.name] = r.bucle ? [].concat(...Array(veces).fill(r.lineas)) : r.lineas;
      if (r.fin === "sale" && r.codigo === 0){ p.initIdx = k + 1; continue; }
      if (r.fin === "corriendo"){ p.estado = `Init:${k}/${inits.length}`; p.fase = "Pending"; p.listo = false; p.esperandoInit = ic.name; return; }
      const t = ahora() - p.creado; p.reinicios = 1 + Math.floor(t / CICLO_CRASH);
      p.ultimoInit = {nombre:ic.name, razon:r.fin === "starterror" ? "StartError" : "Error", codigo:r.codigo, msg:r.errorArranque};
      p.estado = (t % CICLO_CRASH) < 2 ? "Init:Error" : "Init:CrashLoopBackOff"; p.fase = "Pending"; p.listo = false; return;
    }
    p.initHecho = true; p.esperandoInit = null; p.reinicios = 0;
  }
  const env = resolverEnv(p);
  if (env.error){ p.estado = "CreateContainerConfigError"; p.fase = "Pending"; p.listo = false; p.errorConfig = env.error; p.arranque = null; return; }
  const psc = p.spec.securityContext || {}, csc = c.securityContext || {};
  const runAsNonRoot = csc.runAsNonRoot !== undefined ? csc.runAsNonRoot : psc.runAsNonRoot;
  const runAsUser = csc.runAsUser !== undefined ? csc.runAsUser : psc.runAsUser;
  if (runAsNonRoot === true && perfil(c).root && !(runAsUser > 0)){
    p.estado = "CreateContainerConfigError"; p.fase = "Pending"; p.listo = false;
    p.errorConfig = `container has runAsNonRoot and image will run as root (pod: "${p.name}_${p.ns}(${p.uid})", container: ${c.name})`; return;
  }
  p.errorConfig = null;
  if (p.arranque === null){ p.arranque = ahora(); p.envSnap = env.vars; p.proc = arrancarContenedor(p); p.ip = p.ip || ipPod(n); }
  const proc = p.proc; const vivo = ahora() - p.arranque;
  const mem = proc.mem || 0, lim = limMem(c);
  let muere = null;
  if (proc.fin === "starterror") muere = {razon:"StartError", codigo:128, estadoCorto:"RunContainerError", msg:proc.errorArranque};
  else if (lim !== null && mem > lim) muere = {razon:"OOMKilled", codigo:137, estadoCorto:"OOMKilled"};
  else if (proc.fin === "sale"){
    if (p.spec.restartPolicy === "Never" || p.spec.restartPolicy === "OnFailure" && proc.codigo === 0){
      p.fase = proc.codigo === 0 ? "Succeeded" : "Failed"; p.estado = proc.codigo === 0 ? "Completed" : "Error"; p.listo = false;
      p.terminado = {razon:proc.codigo === 0 ? "Completed" : "Error", codigo:proc.codigo, fin:ahora()}; return;
    }
    muere = {razon:proc.codigo === 0 ? "Completed" : "Error", codigo:proc.codigo, estadoCorto:proc.codigo === 0 ? "Completed" : "Error"};
  }
  if (muere){
    p.reinicios = 1 + Math.floor(vivo / CICLO_CRASH); p.ultimo = muere;
    p.estado = (vivo % CICLO_CRASH) < 2 ? muere.estadoCorto : "CrashLoopBackOff"; p.fase = "Running"; p.listo = false;
    return;
  }
  p.fase = "Running"; p.estado = "Running";
  // liveness
  const lv = c.livenessProbe;
  let enReinicio = false;
  if (lv){
    const r = probarSonda(p, lv);
    p.fallaLiveness = r.ok ? null : r.msg;
    if (!r.ok){
      const ciclo = (lv.initialDelaySeconds || 0) + (lv.periodSeconds || 10) * (lv.failureThreshold || 3);
      p.reinicios = Math.floor(vivo / Math.max(ciclo, 5)); if (p.reinicios > 0) p.ultimo = {razon:"Completed", codigo:0, estadoCorto:"Running"};
      enReinicio = (vivo % Math.max(ciclo, 5)) < (lv.initialDelaySeconds || 2);
    }
  } else p.fallaLiveness = null;
  const rd = c.readinessProbe;
  if (rd){ const r = probarSonda(p, rd); p.fallaReadiness = r.ok ? null : r.msg; p.listo = r.ok && !enReinicio; }
  else { p.fallaReadiness = null; p.listo = !enReinicio; }
}

/* ---------- scheduler ---------- */
function tolera(tols, taint){
  for (const t of tols || []){
    if (t.operator === "Exists" && !t.key) return true;
    if (t.key !== taint.key) continue;
    if (t.effect && t.effect !== taint.effect) continue;
    if (t.operator === "Exists") return true;
    if ((t.value || "") === (taint.value || "")) return true;
  }
  return false;
}
function encaja(p, n){
  if (!n.ready) return {k:"notready"};
  if (n.terminando) return {k:"notready"};
  if (n.unsched && !esDS(p)) return {k:"unsched"};
  for (const t of n.taints) if ((t.effect === "NoSchedule" || t.effect === "NoExecute") && !tolera(p.spec.tolerations, t)) return {k:"taint", t};
  const et = etiquetasNodo(n);
  for (const [k, v] of Object.entries(p.spec.nodeSelector || {})) if (et[k] !== String(v)) return {k:"selector"};
  const u = usoNodo(n), r = reqPod(p.spec);
  if (u.pods + 1 > n.alloc.pods) return {k:"pods"};
  if (u.cpu + r.cpu > n.alloc.cpu) return {k:"cpu"};
  if (u.mem + r.mem > n.alloc.mem) return {k:"mem"};
  return null;
}
function motivoPendiente(p){
  const total = S.nodes.length; if (!total) return "no nodes available to schedule pods";
  const cuenta = {}; let tTxt = "";
  for (const n of S.nodes){ const r = encaja(p, n); if (!r) continue; cuenta[r.k] = (cuenta[r.k] || 0) + 1; if (r.t) tTxt = `{${r.t.key}: ${r.t.value || ""}}`; }
  const partes = [];
  if (cuenta.cpu) partes.push(`${cuenta.cpu} Insufficient cpu`);
  if (cuenta.mem) partes.push(`${cuenta.mem} Insufficient memory`);
  if (cuenta.pods) partes.push(`${cuenta.pods} Too many pods`);
  if (cuenta.taint) partes.push(`${cuenta.taint} node(s) had untolerated taint ${tTxt}`);
  if (cuenta.selector) partes.push(`${cuenta.selector} node(s) didn't match Pod's node affinity/selector`);
  if (cuenta.unsched) partes.push(`${cuenta.unsched} node(s) were unschedulable`);
  if (cuenta.notready) partes.push(`${cuenta.notready} node(s) had untolerated taint {node.kubernetes.io/unreachable: }`);
  const pre = (cuenta.cpu || cuenta.mem || cuenta.pods) ? `preemption: 0/${total} nodes are available: ${(cuenta.cpu || 0) + (cuenta.mem || 0) + (cuenta.pods || 0)} No preemption victims found for incoming pod${(cuenta.taint||0)+(cuenta.selector||0)+(cuenta.unsched||0)+(cuenta.notready||0) ? `, ${(cuenta.taint||0)+(cuenta.selector||0)+(cuenta.unsched||0)+(cuenta.notready||0)} Preemption is not helpful for scheduling` : ""}.`
    : `preemption: 0/${total} nodes are available: ${total} Preemption is not helpful for scheduling.`;
  return `0/${total} nodes are available: ${partes.join(", ")}. ${pre}`;
}
function planificar(){
  let cambio = false;
  for (const p of S.pods){
    if (p.node || p.borrando || esDS(p)) continue;
    for (const n of S.nodes){ if (!encaja(p, n)){ p.node = n.name; p.ip = ipPod(n); p.programado = ahora(); cambio = true; break; } }
  }
  return cambio;
}

/* ---------- controladores ---------- */
function podsDeRS(r){ return S.pods.filter(p => p.ns === r.ns && p.owner && p.owner.kind === "ReplicaSet" && p.owner.name === r.name && !p.borrando); }
function ctrlDeployment(d){
  const ns = d.metadata.namespace, nombre = d.metadata.name;
  const tpl = d.spec.template || {}; const h = hashPlantilla(tpl);
  const lista = S.rs.filter(r => r.ns === ns && r.dep === nombre);
  const maxRev = Math.max(0, ...lista.map(r => r.rev));
  let nuevo = lista.find(r => r.hash === h);
  const causa = (d.metadata.annotations || {})["kubernetes.io/change-cause"] || null;
  if (!nuevo){
    nuevo = {name:`${nombre}-${h}`, ns, dep:nombre, hash:h, rev:maxRev + 1, tpl:copia(tpl), causa, creado:ahora(), replicas:0, uid:uid()};
    S.rs.push(nuevo);
  } else if (d._rsActual !== h){ nuevo.rev = maxRev + (nuevo.rev === maxRev ? 0 : 1); if (causa) nuevo.causa = causa; }
  Object.defineProperty(d, "_rsActual", {value:h, enumerable:false, writable:true, configurable:true});
  d.metadata.annotations = d.metadata.annotations || {};
  d.metadata.annotations["deployment.kubernetes.io/revision"] = String(nuevo.rev);
  const R = d.spec.replicas === undefined ? 1 : d.spec.replicas;
  const viejos = lista.filter(r => r !== nuevo);
  const listosNuevo = podsDeRS(nuevo).filter(p => p.listo).length;
  const totalViejos = viejos.reduce((a, r) => a + podsDeRS(r).length, 0);
  const surge = Math.max(1, Math.ceil(R * 0.25)), maxUnav = Math.floor(R * 0.25);
  if (d.spec.paused) return;
  nuevo.replicas = totalViejos === 0 ? R : Math.min(R, Math.max(podsDeRS(nuevo).length, listosNuevo + surge));
  let mantener = listosNuevo >= R ? 0 : Math.max(0, R - maxUnav - listosNuevo);
  viejos.sort((a, b) => b.rev - a.rev);
  for (const r of viejos){ const n = Math.min(podsDeRS(r).length, mantener); r.replicas = n; mantener -= n; }
  // historial: revisionHistoryLimit
  const limite = d.spec.revisionHistoryLimit === undefined ? 10 : d.spec.revisionHistoryLimit;
  const vacios = viejos.filter(r => r.replicas === 0 && podsDeRS(r).length === 0).sort((a, b) => a.rev - b.rev);
  while (vacios.length > limite){ const r = vacios.shift(); S.rs = S.rs.filter(x => x !== r); }
}
function ctrlReplicaSet(r){
  const pods = podsDeRS(r);
  let cambio = false;
  if (pods.length < r.replicas){
    for (let k = pods.length; k < r.replicas; k++){
      const nombre = `${r.name}-${sufijo(5)}`;
      const err = admitir(r.ns, r.tpl, nombre);
      if (err){ evento(r.ns, `replicaset/${r.name}`, "Warning", "FailedCreate", `Error creating: ${err}`); break; }
      const p = crearPod(r.ns, nombre, r.tpl, {kind:"ReplicaSet", name:r.name});
      p.labels["pod-template-hash"] = r.hash; cambio = true;
      evento(r.ns, `replicaset/${r.name}`, "Normal", "SuccessfulCreate", `Created pod: ${nombre}`);
    }
  } else if (pods.length > r.replicas){
    const orden = pods.slice().sort((a, b) => (!!a.node - !!b.node) || (a.listo - b.listo) || (b.creado - a.creado));
    for (const p of orden.slice(0, pods.length - r.replicas)){ S.pods = S.pods.filter(x => x !== p); evento(r.ns, `replicaset/${r.name}`, "Normal", "SuccessfulDelete", `Deleted pod: ${p.name}`); cambio = true; }
  }
  return cambio;
}
function ctrlDaemonSet(ds){
  const ns = ds.metadata.namespace; let cambio = false;
  for (const n of S.nodes){
    if (n.terminando) continue;
    if (!S.pods.some(p => p.owner && p.owner.kind === "DaemonSet" && p.owner.name === ds.metadata.name && p.node === n.name)){
      const p = crearPod(ns, `${ds.metadata.name}-${sufijo(5)}`, ds.spec.template, {kind:"DaemonSet", name:ds.metadata.name});
      p.node = n.name; p.ip = n.ip; cambio = true;
    }
  }
  S.pods = S.pods.filter(p => !(p.owner && p.owner.kind === "DaemonSet" && !S.nodes.some(n => n.name === p.node)));
  return cambio;
}
function ctrlJob(j){
  const ns = j.metadata.namespace; j.status = j.status || {};
  const pods = S.pods.filter(p => p.ns === ns && p.owner && p.owner.kind === "Job" && p.owner.name === j.metadata.name);
  const ok = pods.filter(p => p.fase === "Succeeded").length, ko = pods.filter(p => p.fase === "Failed").length;
  const activos = pods.filter(p => !["Succeeded","Failed"].includes(p.fase)).length;
  const completions = j.spec.completions || 1, backoff = j.spec.backoffLimit === undefined ? 6 : j.spec.backoffLimit;
  j.status.succeeded = ok || undefined; j.status.failed = ko || undefined; j.status.active = activos || undefined;
  if (ok >= completions){ j.status.completionTime = j.status.completionTime || new Date().toISOString().replace(/\.\d+Z$/,"Z"); j.status.conditions = [{type:"Complete", status:"True"}]; return false; }
  if (ko > backoff){ j.status.conditions = [{type:"Failed", status:"True", reason:"BackoffLimitExceeded"}]; return false; }
  if (activos === 0){
    const ultimo = pods.length ? Math.max(...pods.map(p => p.creado)) : -1e9;
    if (ahora() - ultimo < (pods.length ? 8 : 0)) return false;
    const tpl = copia(j.spec.template); tpl.metadata = tpl.metadata || {}; tpl.metadata.labels = Object.assign({}, tpl.metadata.labels, {"batch.kubernetes.io/job-name":j.metadata.name, "job-name":j.metadata.name});
    const nombre = `${j.metadata.name}-${sufijo(5)}`;
    const err = admitir(ns, tpl, nombre); if (err){ evento(ns, `job/${j.metadata.name}`, "Warning", "FailedCreate", `Error creating: ${err}`); return false; }
    crearPod(ns, nombre, tpl, {kind:"Job", name:j.metadata.name});
    evento(ns, `job/${j.metadata.name}`, "Normal", "SuccessfulCreate", `Created pod: ${nombre}`);
    return true;
  }
  return false;
}
function ctrlPodsSueltos(){
  for (const o of objs("Pod")){
    if (!S.pods.some(p => p.ns === o.metadata.namespace && p.name === o.metadata.name)){
      const err = admitir(o.metadata.namespace, o, o.metadata.name);
      if (err){ evento(o.metadata.namespace, `pod/${o.metadata.name}`, "Warning", "FailedCreate", err); borrarObjeto(o); continue; }
      crearPod(o.metadata.namespace, o.metadata.name, {metadata:o.metadata, spec:o.spec}, null);
    }
  }
}
function metricaHPA(h){
  const ref = (h.spec.scaleTargetRef || {}); const d = obj("Deployment", h.metadata.namespace, ref.name);
  if (!d) return {error:`deployments/scale.apps "${ref.name}" not found`};
  const metrics = S.pods.some(p => p.ns === "kube-system" && p.labels["k8s-app"] === "metrics-server" && p.listo);
  if (!metrics) return {error:"unable to get metrics for resource cpu: unable to fetch metrics from resource metrics API: the server is currently unable to handle the request (get pods.metrics.k8s.io)"};
  const sinReq = (d.spec.template.spec.containers || []).find(c => !(((c.resources || {}).requests || {}).cpu) && !(((c.resources || {}).limits || {}).cpu));
  if (sinReq) return {error:`failed to get cpu utilization: missing request for cpu in container ${sinReq.name} of Pod ${(S.pods.find(p => p.ns === d.metadata.namespace && p.owner && p.owner.kind === "ReplicaSet" && p.owner.name.startsWith(d.metadata.name + "-")) || {name:"?"}).name}`};
  const pods = S.pods.filter(p => p.ns === d.metadata.namespace && p.owner && p.owner.kind === "ReplicaSet" && p.owner.name.startsWith(d.metadata.name + "-") && p.fase === "Running");
  if (!pods.length) return {error:"did not receive metrics for targeted pods (pods might be unready)"};
  return {valor:2 + hash(h.metadata.name + d.metadata.name) % 6, d};
}
function objetivoHPA(h){
  const m = (h.spec.metrics || []).find(x => x.type === "Resource" && x.resource && x.resource.name === "cpu");
  if (m && m.resource.target) return m.resource.target.averageUtilization;
  return h.spec.targetCPUUtilizationPercentage;
}
function ctrlHPA(h){
  const ref = h.spec.scaleTargetRef || {}; const d = obj("Deployment", h.metadata.namespace, ref.name); if (!d) return;
  const min = h.spec.minReplicas || 1, max = h.spec.maxReplicas || 1;
  const m = metricaHPA(h); const obj_ = objetivoHPA(h);
  let deseado = d.spec.replicas === undefined ? 1 : d.spec.replicas;
  if (!m.error && obj_) deseado = Math.ceil(deseado * m.valor / obj_);
  deseado = Math.max(min, Math.min(max, deseado));
  if (d.spec.replicas !== deseado){ d.spec.replicas = deseado; }
  h.status = {currentReplicas:d.spec.replicas, desiredReplicas:deseado,
    currentMetrics: m.error ? [] : [{type:"Resource", resource:{name:"cpu", current:{averageUtilization:m.valor, averageValue:`${Math.max(1, Math.round(m.valor * 0.5))}m`}}}]};
}

/* ---------- nodos y node group ---------- */
function ctrlNodos(){
  let cambio = false;
  // nodos que terminan
  for (const n of S.nodes.filter(n => n.terminando && ahora() >= n.finT)){
    S.nodes = S.nodes.filter(x => x !== n);
    S.pods = S.pods.filter(p => p.node !== n.name || !esDS(p));
    for (const p of S.pods) if (p.node === n.name){ S.pods = S.pods.filter(x => x !== p); }
    cambio = true;
  }
  // nodos que llegan
  for (const u of S.uniendo.filter(u => ahora() >= u.t)){ S.uniendo = S.uniendo.filter(x => x !== u); S.nodes.push(nuevoNodo(u.az)); cambio = true; }
  // nodos rotos: tras 20 s se desalojan sus Pods (no DaemonSet)
  for (const n of S.nodes.filter(n => n.roto && ahora() - n.rotoDesde > 20)){
    for (const p of S.pods.filter(p => p.node === n.name && !esDS(p))){ S.pods = S.pods.filter(x => x !== p); cambio = true; }
  }
  // el ASG mantiene desiredSize
  const vivos = S.nodes.filter(n => !n.terminando).length + S.uniendo.length;
  if (vivos < S.ng.desired){
    for (let k = vivos; k < S.ng.desired; k++){ const azs = S.nodes.concat(S.uniendo).map(x => x.az); const az = azs.filter(z => z === "eu-west-1a").length <= azs.filter(z => z === "eu-west-1b").length ? "eu-west-1a" : "eu-west-1b"; S.uniendo.push({az, t:ahora() + 8}); }
    cambio = true;
  } else if (vivos > S.ng.desired){
    let sobran = vivos - S.ng.desired;
    while (sobran > 0 && S.uniendo.length){ S.uniendo.pop(); sobran--; }
    const candidatos = S.nodes.filter(n => !n.terminando).sort((a, b) => (b.unsched - a.unsched) || (b.creado - a.creado));
    for (const n of candidatos.slice(0, sobran)){ n.terminando = true; n.finT = ahora() + 4; n.unsched = true; }
    cambio = true;
  }
  return cambio;
}

/* ---------- bucle de reconciliación ---------- */
function firma(){ return S.pods.map(p => p.name + (p.node || "-") + (p.listo ? 1 : 0) + p.estado).join(",") + "|" + S.rs.map(r => r.name + r.replicas + "r" + r.rev).join(",") + "|" + S.nodes.length; }
function reconciliar(){
  if (!S) return;
  for (let vuelta = 0; vuelta < 12; vuelta++){
    const antes = firma();
    ctrlNodos();
    for (const ds of objs("DaemonSet")) ctrlDaemonSet(ds);
    for (const h of objs("HorizontalPodAutoscaler")) ctrlHPA(h);
    for (const d of objs("Deployment")) ctrlDeployment(d);
    // RS huérfanos
    S.rs = S.rs.filter(r => { if (!obj("Deployment", r.ns, r.dep)){ S.pods = S.pods.filter(p => !(p.owner && p.owner.kind === "ReplicaSet" && p.owner.name === r.name && p.ns === r.ns)); return false; } return true; });
    for (const r of S.rs) ctrlReplicaSet(r);
    for (const j of objs("Job")) ctrlJob(j);
    ctrlPodsSueltos();
    // Pods de dueños que ya no existen
    S.pods = S.pods.filter(p => !p.owner || (p.owner.kind === "ReplicaSet" ? S.rs.some(r => r.name === p.owner.name && r.ns === p.ns) : p.owner.kind === "Job" ? !!obj("Job", p.ns, p.owner.name) : p.owner.kind === "DaemonSet" ? !!obj("DaemonSet", p.ns, p.owner.name) : true));
    S.pods = S.pods.filter(p => p.owner || p.huerfano || objs("Pod").some(o => o.metadata.namespace === p.ns && o.metadata.name === p.name) || p.efimero);
    planificar();
    for (const p of S.pods) evaluarPod(p);
    // LoadBalancers
    for (const s of objs("Service")) if (s.spec.type === "LoadBalancer" && s._lbEn && ahora() >= s._lbEn && !((s.status.loadBalancer || {}).ingress || []).length)
      s.status.loadBalancer = {ingress:[{hostname:`a${hash(s.metadata.uid).toString(16)}${hash(s.metadata.name).toString(16).slice(0,8)}-${(hash(s.metadata.namespace) % 900000000) + 100000000}.${REGION}.elb.amazonaws.com`}]};
    if (firma() === antes) break;
  }
}

/* ---------- RBAC ---------- */
const VERBOS_TODOS = ["get","list","watch","create","update","patch","delete","deletecollection"];
const CLUSTERROLES = {
  "cluster-admin": [{apiGroups:["*"], resources:["*"], verbs:["*"]}],
  "admin": [{apiGroups:["*"], resources:["*"], verbs:["*"]}],
  "edit": [{apiGroups:["*"], resources:["pods","deployments","replicasets","services","configmaps","secrets","jobs","cronjobs","horizontalpodautoscalers","persistentvolumeclaims","serviceaccounts","pods/log","pods/exec","pods/portforward","endpoints","networkpolicies","poddisruptionbudgets","daemonsets","statefulsets","events"], verbs:VERBOS_TODOS}],
  "view": [{apiGroups:["*"], resources:["pods","deployments","replicasets","services","configmaps","jobs","cronjobs","horizontalpodautoscalers","persistentvolumeclaims","serviceaccounts","pods/log","endpoints","networkpolicies","poddisruptionbudgets","daemonsets","statefulsets","events","resourcequotas","limitranges","namespaces"], verbs:["get","list","watch"]}],
};
function normRecurso(r){ const x = recurso(r.split("/")[0]); return x ? x.plural + (r.includes("/") ? "/" + r.split("/")[1] : "") : r; }
function reglasCumplen(reglas, verbo, rec){
  for (const r of reglas || []){
    const recs = (r.resources || []).map(x => x === "*" ? "*" : normRecurso(x)); const verbs = r.verbs || [];
    if ((recs.includes("*") || recs.includes(rec)) && (verbs.includes("*") || verbs.includes(verbo))) return true;
  }
  return false;
}
function puede(sujeto, verbo, rec, ns){
  if (!sujeto) return true;                                   // tú: administrador del cluster (access entry)
  rec = normRecurso(rec);
  const m = sujeto.match(/^system:serviceaccount:([^:]+):(.+)$/); if (!m) return false;
  const [, saNs, saN] = m;
  const esElSA = (subs, nsDef) => (subs || []).some(s => s.kind === "ServiceAccount" && s.name === saN && (s.namespace || nsDef) === saNs);
  const reglasDe = (ref, nsRol) => ref.kind === "ClusterRole" ? (CLUSTERROLES[ref.name] || (S.objs.find(o => o.kind === "ClusterRole" && o.metadata.name === ref.name) || {}).rules) : (obj("Role", nsRol, ref.name) || {}).rules;
  // ClusterRoleBinding: vale en TODOS los namespaces
  for (const crb of S.objs.filter(o => o.kind === "ClusterRoleBinding"))
    if (esElSA(crb.subjects, undefined) && reglasCumplen(reglasDe(crb.roleRef || {}, null), verbo, rec)) return true;
  if (ns === null) return false;                              // «en todos los namespaces»: un RoleBinding no basta
  for (const rb of objs("RoleBinding", ns)){
    if (!esElSA(rb.subjects, rb.metadata.namespace)) continue;
    if (reglasCumplen(reglasDe(rb.roleRef || {}, ns), verbo, rec)) return true;
  }
  return false;
}

/* ---------- PDB ---------- */
function estadoPDB(pdb){
  const ns = pdb.metadata.namespace; const sel = (pdb.spec || {}).selector || {};
  const pods = S.pods.filter(p => p.ns === ns && !p.borrando && selecciona(sel, p.labels) && !["Succeeded","Failed"].includes(p.fase));
  const sanos = pods.filter(p => p.listo).length;
  let deseados;
  if (pdb.spec.minAvailable !== undefined){ const v = String(pdb.spec.minAvailable); deseados = v.endsWith("%") ? Math.ceil(pods.length * parseInt(v, 10) / 100) : parseInt(v, 10); }
  else if (pdb.spec.maxUnavailable !== undefined){ const v = String(pdb.spec.maxUnavailable); const mu = v.endsWith("%") ? Math.floor(pods.length * parseInt(v, 10) / 100) : parseInt(v, 10); deseados = pods.length - mu; }
  else deseados = pods.length;
  return {sanos, deseados, permitidas:Math.max(0, sanos - deseados), total:pods.length};
}
