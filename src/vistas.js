/* ============================================================================
   vistas.js — objetos Kubernetes completos (para -o yaml/json/jsonpath),
   tablas de `kubectl get` y textos de `kubectl describe`.
   ========================================================================== */
"use strict";

function tabla(filas, sinCabecera){
  if (sinCabecera) filas = filas.slice(1);
  if (!filas.length) return "";
  const w = filas[0].map((_, i) => Math.max(...filas.map(f => String(f[i] === undefined ? "" : f[i]).length)));
  return filas.map(f => f.map((c, i) => i === f.length - 1 ? String(c) : String(c).padEnd(w[i] + 3)).join("").trimEnd()).join("\n");
}
const fechaISO = t => new Date(Date.now() - (ahora() - t) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
const etiquetasTxt = l => Object.entries(l || {}).map(([k, v]) => `${k}=${v}`).join(",") || "<none>";
const selectorTxt = s => { if (!s) return "<none>"; const ml = s.matchLabels !== undefined || s.matchExpressions ? (s.matchLabels || {}) : s; return Object.entries(ml).map(([k, v]) => `${k}=${v}`).join(",") || "<none>"; };
function sinInternas(an){ const r = {}; for (const [k, v] of Object.entries(an || {})) if (!k.startsWith("eks-quest/")) r[k] = v; return r; }
function limpiarMeta(m){ const r = copia(m); if (r.annotations) r.annotations = sinInternas(r.annotations); if (r.annotations && !Object.keys(r.annotations).length) delete r.annotations; if (r.labels && !Object.keys(r.labels).length) delete r.labels; return r; }

/* ---------- objetos completos ---------- */
function rsDeDeployment(d){ return S.rs.filter(r => r.ns === d.metadata.namespace && r.dep === d.metadata.name); }
function podsDeDeployment(d){ const rs = rsDeDeployment(d).map(r => r.name); return S.pods.filter(p => p.ns === d.metadata.namespace && p.owner && p.owner.kind === "ReplicaSet" && rs.includes(p.owner.name) && !p.borrando); }
function estadoDeployment(d){
  const pods = podsDeDeployment(d); const actual = rsDeDeployment(d).find(r => r.hash === d._rsActual);
  const nuevos = actual ? podsDeRS(actual) : [];
  return {replicas:pods.length, updatedReplicas:nuevos.length, readyReplicas:pods.filter(p => p.listo).length, availableReplicas:pods.filter(p => p.listo).length,
          unavailableReplicas:Math.max(0, (d.spec.replicas ?? 1) - pods.filter(p => p.listo).length), actualizadosListos:nuevos.filter(p => p.listo).length};
}
function aObjetoPod(p){
  const n = S.nodes.find(x => x.name === p.node);
  const c = p.spec.containers[0];
  const st = {name:c.name, image:c.image, ready:p.listos ? !!p.listos[0] : !!p.listo, restartCount:p.reinicios || 0, started:p.fase === "Running"};
  if (p.estado === "Running") st.state = {running:{startedAt:fechaISO(p.arranque || p.creado)}};
  else if (p.fase === "Succeeded" || p.fase === "Failed") st.state = {terminated:{exitCode:p.terminado ? p.terminado.codigo : 0, reason:p.estado}};
  else st.state = {waiting:{reason:p.estado === "Pending" ? "ContainerCreating" : /^Init:/.test(p.estado) ? "PodInitializing" : p.estado, message:p.errorConfig || (p.ultimo && p.ultimo.msg) || undefined}};
  if (p.ultimo) st.lastState = {terminated:{exitCode:p.ultimo.codigo, reason:p.ultimo.razon}};
  const owner = p.owner ? [{apiVersion:p.owner.kind === "Job" ? "batch/v1" : "apps/v1", kind:p.owner.kind, name:p.owner.name, controller:true}] : undefined;
  return {apiVersion:"v1", kind:"Pod",
    metadata:limpiarMeta({name:p.name, namespace:p.ns, uid:p.uid, labels:p.labels, annotations:p.annotations, creationTimestamp:fechaISO(p.creado), ownerReferences:owner}),
    spec:Object.assign(copia(p.spec), p.node ? {nodeName:p.node} : {}),
    status:{phase:p.fase, podIP:p.ip || undefined, hostIP:n ? n.ip : undefined, qosClass:qos(p.spec),
      conditions:[{type:"PodScheduled", status:p.node ? "True" : "False", reason:p.node ? undefined : "Unschedulable", message:p.node ? undefined : motivoPendiente(p)}, {type:"Ready", status:p.listo ? "True" : "False"}],
      containerStatuses:p.node ? [st].concat((p.spec.containers || []).slice(1).map((sc, k) => { const l = (p.lados || [])[k]; return {name:sc.name, image:sc.image, ready:!!(p.listos && p.listos[k + 1]), restartCount:(l && l.reinicios) || 0, started:!!(l && l.estado === "Running"), state:l && l.estado === "Running" ? {running:{startedAt:fechaISO(p.arranque || p.creado)}} : {waiting:{reason:l ? "CrashLoopBackOff" : "ContainerCreating"}}}; })) : undefined,
      initContainerStatuses:p.node && (p.spec.initContainers || []).length ? p.spec.initContainers.map((ic, k) => { const hecho = p.initHecho || (p.initIdx || 0) > k; return {name:ic.name, image:ic.image, ready:hecho, restartCount:!hecho && (p.initIdx || 0) === k ? (p.reinicios || 0) : 0, state:hecho ? {terminated:{exitCode:0, reason:"Completed"}} : (p.initIdx || 0) === k && p.esperandoInit ? {running:{}} : {waiting:{reason:"PodInitializing"}}}; }) : undefined}};
}
function aObjetoNodo(n){
  const cond = (tipo, ok, razon, msg) => ({type:tipo, status:ok, reason:razon, message:msg});
  return {apiVersion:"v1", kind:"Node",
    metadata:{name:n.name, uid:n.uid, labels:etiquetasNodo(n), annotations:{"alpha.kubernetes.io/provided-node-ip":n.ip, "node.alpha.kubernetes.io/ttl":"0"}, creationTimestamp:fechaISO(n.creado)},
    spec:Object.assign({providerID:`aws:///${n.az}/${n.id}`}, n.taints.length || n.unsched || !n.ready ? {taints:[...n.taints, ...(n.unsched ? [{key:"node.kubernetes.io/unschedulable", effect:"NoSchedule"}] : []), ...(!n.ready ? [{key:"node.kubernetes.io/unreachable", effect:"NoSchedule"}, {key:"node.kubernetes.io/unreachable", effect:"NoExecute"}] : [])]} : {}, n.unsched ? {unschedulable:true} : {}),
    status:{capacity:{cpu:"2", memory:"3927856Ki", pods:String(n.cap.pods), "ephemeral-storage":"20893676Ki"},
      allocatable:{cpu:`${n.alloc.cpu}m`, memory:"3372848Ki", pods:String(n.alloc.pods), "ephemeral-storage":"18181869946"},
      conditions: n.ready ? [cond("MemoryPressure","False","KubeletHasSufficientMemory","kubelet has sufficient memory available"), cond("DiskPressure","False","KubeletHasNoDiskPressure","kubelet has no disk pressure"), cond("PIDPressure","False","KubeletHasSufficientPID","kubelet has sufficient PID available"), cond("Ready","True","KubeletReady","kubelet is posting ready status")]
        : ["MemoryPressure","DiskPressure","PIDPressure","Ready"].map(t => cond(t,"Unknown","NodeStatusUnknown","Kubelet stopped posting node status.")),
      addresses:[{type:"InternalIP", address:n.ip}, {type:"Hostname", address:n.name}, {type:"InternalDNS", address:n.name}],
      nodeInfo:{kubeletVersion:K8S_VER, osImage:"Amazon Linux 2023.12.20261118", kernelVersion:"6.18.62-127.179.amzn2023.x86_64", containerRuntimeVersion:"containerd://2.3.7+unknown", architecture:"amd64", operatingSystem:"linux"}}};
}
function aObjeto(kind, x){
  if (kind === "Pod") return aObjetoPod(x);
  if (kind === "Node") return aObjetoNodo(x);
  if (kind === "Namespace") return {apiVersion:"v1", kind:"Namespace", metadata:{name:x.name, uid:x.uid, labels:x.labels, creationTimestamp:fechaISO(x.creado)}, spec:{finalizers:["kubernetes"]}, status:{phase:"Active"}};
  if (kind === "ReplicaSet"){ const pods = podsDeRS(x); return {apiVersion:"apps/v1", kind:"ReplicaSet", metadata:{name:x.name, namespace:x.ns, uid:x.uid, labels:Object.assign({}, (x.tpl.metadata || {}).labels, {"pod-template-hash":x.hash}), annotations:Object.assign({"deployment.kubernetes.io/revision":String(x.rev)}, x.causa ? {"kubernetes.io/change-cause":x.causa} : {}), ownerReferences:[{apiVersion:"apps/v1", kind:"Deployment", name:x.dep, controller:true}], creationTimestamp:fechaISO(x.creado)}, spec:{replicas:x.replicas, template:copia(x.tpl)}, status:{replicas:pods.length, readyReplicas:pods.filter(p => p.listo).length}}; }
  if (kind === "ClusterRole" && !x.metadata) return {apiVersion:"rbac.authorization.k8s.io/v1", kind:"ClusterRole", metadata:{name:x.name}, rules:CLUSTERROLES[x.name]};
  const o = copia(x); o.metadata = limpiarMeta(x.metadata);
  if (!o.apiVersion){ const r = recursoPorKind(kind); o.apiVersion = r ? r.api : "v1"; }
  if (kind === "Deployment"){ const e = estadoDeployment(x); o.status = {observedGeneration:1, replicas:e.replicas, updatedReplicas:e.updatedReplicas, readyReplicas:e.readyReplicas || undefined, availableReplicas:e.availableReplicas || undefined, unavailableReplicas:e.unavailableReplicas || undefined}; }
  if (kind === "DaemonSet"){ const pods = S.pods.filter(p => p.owner && p.owner.kind === "DaemonSet" && p.owner.name === x.metadata.name); o.status = {desiredNumberScheduled:S.nodes.length, currentNumberScheduled:pods.length, numberReady:pods.filter(p => p.listo).length}; }
  if (kind === "PodDisruptionBudget"){ const e = estadoPDB(x); o.status = {currentHealthy:e.sanos, desiredHealthy:e.deseados, disruptionsAllowed:e.permitidas, expectedPods:e.total}; }
  if (kind === "ResourceQuota"){ const usados = S.pods.filter(p => p.ns === x.metadata.namespace && !["Succeeded","Failed"].includes(p.fase)).length; o.status = {hard:copia(x.spec.hard), used:Object.fromEntries(Object.keys(x.spec.hard || {}).map(k => [k, k === "pods" ? String(usados) : "0"]))}; }
  return o;
}
function listaObjetos(kind, ns, todos){
  const enNs = o => todos || o.metadata.namespace === ns;
  if (kind === "Pod") return S.pods.filter(p => (todos || p.ns === ns) && !p.efimero);
  if (kind === "Node") return S.nodes;
  if (kind === "Namespace") return Object.keys(S.ns).map(n => Object.assign({name:n}, S.ns[n]));
  if (kind === "ReplicaSet") return S.rs.filter(r => todos || r.ns === ns);
  if (kind === "ClusterRole") return Object.keys(CLUSTERROLES).map(n => ({name:n})).concat(S.objs.filter(o => o.kind === "ClusterRole"));
  if (kind === "ClusterRoleBinding") return S.objs.filter(o => o.kind === "ClusterRoleBinding");
  if (kind === "Endpoints" || kind === "EndpointSlice") return S.objs.filter(o => o.kind === "Service" && enNs(o));
  if (kind === "Event") return null;
  return S.objs.filter(o => o.kind === kind && enNs(o));
}
const nombreDe = (kind, x) => kind === "Pod" ? x.name : kind === "Node" ? x.name : kind === "Namespace" ? x.name : kind === "ReplicaSet" ? x.name : kind === "ClusterRole" && !x.metadata ? x.name : x.metadata.name;
const nsDe = (kind, x) => kind === "Pod" ? x.ns : kind === "ReplicaSet" ? x.ns : (x.metadata || {}).namespace;
const labelsDe = (kind, x) => kind === "Pod" ? x.labels : kind === "Node" ? etiquetasNodo(x) : kind === "Namespace" ? x.labels : kind === "ReplicaSet" ? Object.assign({}, (x.tpl.metadata || {}).labels, {"pod-template-hash":x.hash}) : kind === "ClusterRole" && !x.metadata ? {} : (x.metadata.labels || {});
const tiempoDe = (kind, x) => kind === "Pod" ? x.creado : kind === "Node" ? x.creado : kind === "Namespace" ? x.creado : kind === "ReplicaSet" ? x.creado : kind === "ClusterRole" && !x.metadata ? (S ? S.creado : 0) : ((x.metadata && x.metadata._t) || 0);

/* ---------- filas de `kubectl get` ---------- */
function reiniciosTotal(p){ return (p.reinicios || 0) + (p.lados || []).reduce((s, l) => s + (l.reinicios || 0), 0); }
function reiniciosTxt(p){ if (!p.reinicios && reiniciosTotal(p)) return `${reiniciosTotal(p)} (${Math.max(1, Math.floor((ahora() - p.arranque) % CICLO_CRASH))}s ago)`; return p.reinicios ? `${p.reinicios} (${Math.max(1, Math.floor((ahora() - p.arranque) % CICLO_CRASH))}s ago)` : "0"; }
function puertosTxt(s){ return (s.spec.ports || []).map(p => `${p.port}${p.nodePort && s.spec.type !== "ClusterIP" ? ":" + p.nodePort : ""}/${p.protocol || "TCP"}`).join(",") || "<none>"; }
function externaTxt(s){ if (s.spec.type !== "LoadBalancer") return "<none>"; const i = ((s.status || {}).loadBalancer || {}).ingress; return i && i.length ? i[0].hostname : "<pending>"; }
const FILAS = {
  Pod: {cab:["NAME","READY","STATUS","RESTARTS","AGE"], wide:["IP","NODE","NOMINATED NODE","READINESS GATES"],
        fila:p => [p.name, `${p.listos ? p.listos.filter(Boolean).length : (p.listo ? 1 : 0)}/${(p.spec.containers || []).length || 1}`, p.estado, reiniciosTxt(p), edad(p.creado)], filaW:p => [p.ip || "<none>", p.node || "<none>", "<none>", "<none>"]},
  Node: {cab:["NAME","STATUS","ROLES","AGE","VERSION"], wide:["INTERNAL-IP","EXTERNAL-IP","OS-IMAGE","KERNEL-VERSION","CONTAINER-RUNTIME"],
        fila:n => [n.name, (n.ready ? "Ready" : "NotReady") + (n.unsched ? ",SchedulingDisabled" : ""), "<none>", edad(n.creado), K8S_VER], filaW:n => [n.ip, "3.252." + (hash(n.name) % 250) + "." + (hash(n.id) % 250), "Amazon Linux 2023.12.20261118", "6.18.62-127.179.amzn2023.x86_64", "containerd://2.3.7+unknown"]},
  Namespace: {cab:["NAME","STATUS","AGE"], fila:x => [x.name, "Active", edad(x.creado)]},
  Deployment: {cab:["NAME","READY","UP-TO-DATE","AVAILABLE","AGE"], wide:["CONTAINERS","IMAGES","SELECTOR"],
        fila:d => { const e = estadoDeployment(d); return [d.metadata.name, `${e.readyReplicas}/${d.spec.replicas ?? 1}`, e.updatedReplicas, e.availableReplicas, edad(d.metadata._t)]; },
        filaW:d => [(d.spec.template.spec.containers || []).map(c => c.name).join(","), (d.spec.template.spec.containers || []).map(c => c.image).join(","), selectorTxt(d.spec.selector)]},
  ReplicaSet: {cab:["NAME","DESIRED","CURRENT","READY","AGE"], wide:["CONTAINERS","IMAGES","SELECTOR"],
        fila:r => { const p = podsDeRS(r); return [r.name, r.replicas, p.length, p.filter(x => x.listo).length, edad(r.creado)]; },
        filaW:r => [(r.tpl.spec.containers || []).map(c => c.name).join(","), (r.tpl.spec.containers || []).map(c => c.image).join(","), etiquetasTxt(Object.assign({}, (r.tpl.metadata || {}).labels, {"pod-template-hash":r.hash}))]},
  DaemonSet: {cab:["NAME","DESIRED","CURRENT","READY","UP-TO-DATE","AVAILABLE","NODE SELECTOR","AGE"],
        fila:d => { const p = S.pods.filter(x => x.owner && x.owner.kind === "DaemonSet" && x.owner.name === d.metadata.name); return [d.metadata.name, S.nodes.length, p.length, p.filter(x => x.listo).length, p.length, p.filter(x => x.listo).length, "<none>", edad(d.metadata._t)]; }},
  Service: {cab:["NAME","TYPE","CLUSTER-IP","EXTERNAL-IP","PORT(S)","AGE"], wide:["SELECTOR"],
        fila:s => [s.metadata.name, s.spec.type, s.spec.clusterIP, externaTxt(s), puertosTxt(s), edad(s.metadata._t)], filaW:s => [selectorTxt(s.spec.selector)]},
  Endpoints: {cab:["NAME","ENDPOINTS","AGE"], fila:s => { const e = endpointsDe(s); const tp = (s.spec.ports[0] || {}).targetPort; return [s.metadata.name, s.metadata.name === "kubernetes" ? "10.0.3.12:443,10.0.4.87:443" : e.length ? e.slice(0, 3).map(p => `${p.ip}:${puertoContenedor(p, tp) || tp}`).join(",") + (e.length > 3 ? ` + ${e.length - 3} more...` : "") : "<none>", edad(s.metadata._t)]; }},
  EndpointSlice: {cab:["NAME","ADDRESSTYPE","PORTS","ENDPOINTS","AGE"], fila:s => { const e = endpointsDe(s); const tp = (s.spec.ports[0] || {}).targetPort; return [`${s.metadata.name}-${hash(s.metadata.uid).toString(36).slice(0,5)}`, "IPv4", e.length ? (puertoContenedor(e[0], tp) || tp) : "<unset>", e.length ? e.slice(0,3).map(p => p.ip).join(",") + (e.length > 3 ? ` + ${e.length - 3} more...` : "") : "<unset>", edad(s.metadata._t)]; }},
  ConfigMap: {cab:["NAME","DATA","AGE"], fila:c => [c.metadata.name, Object.keys(c.data || {}).length, edad(c.metadata._t)]},
  Secret: {cab:["NAME","TYPE","DATA","AGE"], fila:s => [s.metadata.name, s.type || "Opaque", Object.keys(s.data || {}).length, edad(s.metadata._t)]},
  HorizontalPodAutoscaler: {cab:["NAME","REFERENCE","TARGETS","MINPODS","MAXPODS","REPLICAS","AGE"],
        fila:h => { const m = metricaHPA(h); const o = objetivoHPA(h); return [h.metadata.name, `Deployment/${(h.spec.scaleTargetRef || {}).name}`, `cpu: ${m.error ? "<unknown>" : m.valor + "%"}/${o}%`, h.spec.minReplicas || 1, h.spec.maxReplicas, ((h.status || {}).currentReplicas) ?? 0, edad(h.metadata._t)]; }},
  Job: {cab:["NAME","STATUS","COMPLETIONS","DURATION","AGE"],
        fila:j => { const st = j.status || {}; const ok = st.succeeded || 0; const fallo = (st.conditions || []).some(c => c.type === "Failed"); return [j.metadata.name, ok >= (j.spec.completions || 1) ? "Complete" : fallo ? "Failed" : "Running", `${ok}/${j.spec.completions || 1}`, ok ? "4s" : edad(j.metadata._t), edad(j.metadata._t)]; }},
  CronJob: {cab:["NAME","SCHEDULE","TIMEZONE","SUSPEND","ACTIVE","LAST SCHEDULE","AGE"], fila:c => [c.metadata.name, c.spec.schedule, c.spec.timeZone || "<none>", String(!!c.spec.suspend), 0, "<none>", edad(c.metadata._t)]},
  ResourceQuota: {cab:["NAME","AGE","REQUEST","LIMIT"], fila:q => { const o = aObjeto("ResourceQuota", q); return [q.metadata.name, edad(q.metadata._t), Object.keys(q.spec.hard || {}).map(k => `${k}: ${o.status.used[k]}/${q.spec.hard[k]}`).join(", "), ""]; }},
  PodDisruptionBudget: {cab:["NAME","MIN AVAILABLE","MAX UNAVAILABLE","ALLOWED DISRUPTIONS","AGE"], fila:p => { const e = estadoPDB(p); return [p.metadata.name, p.spec.minAvailable ?? "N/A", p.spec.maxUnavailable ?? "N/A", e.permitidas, edad(p.metadata._t)]; }},
  NetworkPolicy: {cab:["NAME","POD-SELECTOR","AGE"], fila:n => [n.metadata.name, selectorTxt((n.spec || {}).podSelector) === "<none>" ? "<none>" : selectorTxt(n.spec.podSelector), edad(n.metadata._t)]},
  ServiceAccount: {cab:["NAME","SECRETS","AGE"], fila:s => [s.metadata.name, 0, edad(s.metadata._t)]},
  Role: {cab:["NAME","CREATED AT"], fila:r => [r.metadata.name, r.metadata.creationTimestamp]},
  RoleBinding: {cab:["NAME","ROLE","AGE"], wide:["USERS","GROUPS","SERVICEACCOUNTS"], fila:r => [r.metadata.name, `${(r.roleRef || {}).kind}/${(r.roleRef || {}).name}`, edad(r.metadata._t)],
        filaW:r => ["", "", (r.subjects || []).filter(s => s.kind === "ServiceAccount").map(s => `${s.namespace || r.metadata.namespace}/${s.name}`).join(", ")]},
  ClusterRole: {cab:["NAME","CREATED AT"], fila:c => c.metadata ? [c.metadata.name, c.metadata.creationTimestamp] : [c.name, fechaISO(S.creado)]},
  ClusterRoleBinding: {cab:["NAME","ROLE","AGE"], wide:["USERS","GROUPS","SERVICEACCOUNTS"], fila:r => [r.metadata.name, `ClusterRole/${(r.roleRef || {}).name}`, edad(r.metadata._t)],
        filaW:r => ["", "", (r.subjects || []).filter(s => s.kind === "ServiceAccount").map(s => `${s.namespace}/${s.name}`).join(", ")]},
};

/* ---------- describe ---------- */
function eventosDePod(p){
  const ev = []; const c = p.spec.containers[0]; const t = x => edad(x);
  if (!p.node){ ev.push(["Warning","FailedScheduling",t(p.creado),"default-scheduler",motivoPendiente(p)]); return ev; }
  ev.push(["Normal","Scheduled",t(p.programado || p.creado),"default-scheduler",`Successfully assigned ${p.ns}/${p.name} to ${p.node}`]);
  if (p.razonImagen){ const i = p.razonImagen; const ref = referenciaCompleta(i);
    ev.push(["Normal","Pulling",t(p.creado),"kubelet",`Pulling image "${c.image}"`]);
    ev.push(["Warning","Failed",t(p.creado),"kubelet", i.motivo === "repo" ? `Failed to pull image "${c.image}": failed to pull and unpack image "${ref}": failed to resolve reference "${ref}": pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed` : `Failed to pull image "${c.image}": rpc error: code = NotFound desc = failed to pull and unpack image "${ref}": failed to resolve reference "${ref}": ${ref}: not found`]);
    ev.push(["Warning","Failed",t(p.creado),"kubelet","Error: ErrImagePull"]);
    ev.push(["Normal","BackOff",t(p.creado),"kubelet",`Back-off pulling image "${c.image}"`]);
    ev.push(["Warning","Failed",t(p.creado),"kubelet","Error: ImagePullBackOff"]);
    if (imagenInfo(c.image).ok) {} else return ev;
  }
  if (p.errorMontaje){ ev.push(["Warning","FailedMount",t(p.creado),"kubelet",`MountVolume.SetUp failed for volume "${p.errorMontaje.vol}" : ${p.errorMontaje.msg}`]); return ev; }
  ev.push(["Normal","Pulled",t(p.creado),"kubelet",`Container image "${c.image}" already present on machine`]);
  if (p.errorConfig){ ev.push(["Warning","Failed",t(p.creado),"kubelet",`Error: ${p.errorConfig}`]); return ev; }
  if (p.ultimo && p.ultimo.razon === "StartError"){ ev.push(["Warning","Failed",t(p.arranque),"kubelet",`Error: ${p.proc.errorArranque}`]); ev.push(["Warning","BackOff",t(p.arranque),"kubelet",`Back-off restarting failed container ${c.name} in pod ${p.name}_${p.ns}(${p.uid})`]); return ev; }
  ev.push(["Normal","Created",t(p.arranque || p.creado),"kubelet",`Created container: ${c.name}`]);
  ev.push(["Normal","Started",t(p.arranque || p.creado),"kubelet",`Started container ${c.name}`]);
  if (p.fallaLiveness){ ev.push(["Warning","Unhealthy","5s","kubelet",`Liveness probe failed: ${p.fallaLiveness}`]); ev.push(["Normal","Killing","5s","kubelet",`Container ${c.name} failed liveness probe, will be restarted`]); }
  if (p.fallaReadiness) ev.push(["Warning","Unhealthy","3s","kubelet",`Readiness probe failed: ${p.fallaReadiness}`]);
  if (p.ultimo && p.ultimo.razon !== "StartError" && p.estado !== "Running") ev.push(["Warning","BackOff","4s","kubelet",`Back-off restarting failed container ${c.name} in pod ${p.name}_${p.ns}(${p.uid})`]);
  return ev;
}
function tablaEventos(ev){
  if (!ev.length) return "Events:              <none>";
  return "Events:\n" + tabla([["  Type","Reason","Age","From","Message"],["  ----","------","----","----","-------"], ...ev.map(e => ["  " + e[0], e[1], e[2], e[3], e[4]])]);
}
function recursosTxt(c, sangria){
  const r = (c.resources || {}).requests || {}, l = (c.resources || {}).limits || {}; let s = "";
  if (Object.keys(l).length) s += `\n${sangria}Limits:\n` + Object.entries(l).map(([k, v]) => `${sangria}  ${k}:  ${v}`).join("\n");
  if (Object.keys(r).length) s += `\n${sangria}Requests:\n` + Object.entries(r).map(([k, v]) => `${sangria}  ${k}:  ${v}`).join("\n");
  return s;
}
function sondaTxt(nombre, sd){
  if (!sd) return "";
  const tipo = sd.httpGet ? `http-get http://:${sd.httpGet.port}${sd.httpGet.path || "/"}` : sd.tcpSocket ? `tcp-socket :${sd.tcpSocket.port}` : sd.exec ? `exec [${(sd.exec.command || []).join(" ")}]` : "?";
  return `\n    ${nombre}:${" ".repeat(Math.max(1, 16 - nombre.length - 1))}${tipo} delay=${sd.initialDelaySeconds || 0}s timeout=${sd.timeoutSeconds || 1}s period=${sd.periodSeconds || 10}s #success=1 #failure=${sd.failureThreshold || 3}`;
}
function envTxt(c, ns){
  const e = c.env || []; const ef = c.envFrom || [];
  if (!e.length && !ef.length) return "\n    Environment:    <none>";
  let s = "\n    Environment:";
  for (const x of e){
    if (x.valueFrom && x.valueFrom.configMapKeyRef) s += `\n      ${x.name}:  <set to the key '${x.valueFrom.configMapKeyRef.key}' of config map '${x.valueFrom.configMapKeyRef.name}'>  Optional: ${!!x.valueFrom.configMapKeyRef.optional}`;
    else if (x.valueFrom && x.valueFrom.secretKeyRef) s += `\n      ${x.name}:  <set to the key '${x.valueFrom.secretKeyRef.key}' in secret '${x.valueFrom.secretKeyRef.name}'>  Optional: ${!!x.valueFrom.secretKeyRef.optional}`;
    else s += `\n      ${x.name}:  ${x.value ?? ""}`;
  }
  for (const x of ef) s += `\n    Environment Variables from:\n      ${(x.configMapRef || x.secretRef).name}  ${x.configMapRef ? "ConfigMap" : "Secret"}  Optional: false`;
  return s;
}
function montaToken(p){ return p.tokenMontado !== false; }
function podIdentityDe(p){ return (p.spec.containers || []).some(c => (c.env || []).some(e => e.name === "AWS_CONTAINER_CREDENTIALS_FULL_URI")); }
function initTxt(p){
  const ics = p.spec.initContainers || []; if (!ics.length) return "";
  return "\nInit Containers:" + ics.map((ic, k) => {
    const hecho = p.initHecho || (p.initIdx || 0) > k, actual = !hecho && (p.initIdx || 0) === k;
    const cmd = [...(ic.command || []), ...(ic.args || [])];
    const roto = actual && /CrashLoop|Init:Error/.test(p.estado);
    let st;
    if (hecho) st = "Terminated\n      Reason:       Completed\n      Exit Code:    0";
    else if (roto) st = `Waiting\n      Reason:       CrashLoopBackOff\n    Last State:     Terminated\n      Reason:       ${(p.ultimoInit || {}).razon || "Error"}\n      Exit Code:    ${(p.ultimoInit || {}).codigo ?? 1}`;
    else if (actual && /ImagePull/.test(p.estado)) st = `Waiting\n      Reason:       ${p.estado.replace("Init:", "")}`;
    else if (actual && p.esperandoInit) st = "Running";
    else st = "Waiting\n      Reason:       PodInitializing";
    return `\n  ${ic.name}:\n    Image:          ${ic.image}${cmd.length ? "\n    Command:\n" + cmd.map(a => "      " + a).join("\n") : ""}\n    State:          ${st}\n    Ready:          ${hecho}\n    Restart Count:  ${roto ? p.reinicios : 0}${envTxt(ic, p.ns)}`;
  }).join("");
}
function ladosTxt(p){
  return (p.spec.containers || []).slice(1).map((sc, k) => {
    const l = (p.lados || [])[k]; const cmd = [...(sc.command || []), ...(sc.args || [])];
    const est = !l ? "Waiting\n      Reason:       ContainerCreating" : l.estado === "Running" ? `Running\n      Started:      ${new Date(Date.now() - (ahora() - (p.arranque || p.creado)) * 1000).toUTCString()}` : "Waiting\n      Reason:       CrashLoopBackOff";
    const ult = l && l.ultimo ? `\n    Last State:     Terminated\n      Reason:       ${l.ultimo.razon}${l.ultimo.msg ? "\n      Message:      " + l.ultimo.msg : ""}\n      Exit Code:    ${l.ultimo.codigo}` : "";
    return `  ${sc.name}:\n    Image:          ${sc.image}\n    Port:           ${(sc.ports || []).map(x => `${x.containerPort}/${x.protocol || "TCP"}`).join(", ") || "<none>"}${cmd.length ? "\n    Command:\n" + cmd.map(a => "      " + a).join("\n") : ""}\n    State:          ${est}${ult}\n    Ready:          ${!!(p.listos && p.listos[k + 1])}\n    Restart Count:  ${(l && l.reinicios) || 0}${recursosTxt(sc, "    ")}${sondaTxt("Readiness", sc.readinessProbe)}${envTxt(sc, p.ns)}\n    Mounts:${(sc.volumeMounts || []).map(m => `\n      ${m.mountPath} from ${m.name} (${m.readOnly ? "ro" : "rw"})`).join("") || " <none>"}\n`;
  }).join("");
}
function describir(kind, x){
  if (kind === "Pod"){
    const p = x, c = p.spec.containers[0]; const n = S.nodes.find(z => z.name === p.node);
    const estado = p.estado === "Running" ? `Running\n      Started:      ${new Date(Date.now() - (ahora() - (p.arranque || p.creado)) * 1000).toUTCString()}`
      : p.fase === "Succeeded" || p.fase === "Failed" ? `Terminated\n      Reason:       ${p.estado}\n      Exit Code:    ${p.terminado ? p.terminado.codigo : 0}`
      : p.estado === "Pending" ? "Waiting\n      Reason:       ContainerCreating" : `Waiting\n      Reason:       ${/^Init:/.test(p.estado) ? "PodInitializing" : /OOMKilled|Error|Completed|RunContainerError/.test(p.estado) ? "CrashLoopBackOff" : p.estado}`
        + (p.estado === "CreateContainerConfigError" ? "" : "");
    const ultimo = p.ultimo ? `\n    Last State:     Terminated\n      Reason:       ${p.ultimo.razon}${p.ultimo.msg ? "\n      Message:      " + p.ultimo.msg : ""}\n      Exit Code:    ${p.ultimo.codigo}` : "";
    const puertos = (c.ports || []).map(x => `${x.containerPort}/${x.protocol || "TCP"}`).join(", ") || "<none>";
    const comando = c.command ? `\n    Command:\n${c.command.map(a => "      " + a).join("\n")}` : "";
    const args = c.args ? `\n    Args:\n${c.args.map(a => "      " + a).join("\n")}` : "";
    const vols = (p.spec.volumes || []).map(v => `  ${v.name}:\n    Type:      ${v.configMap ? "ConfigMap (a volume populated by a ConfigMap)" : v.secret ? "Secret" : "EmptyDir"}\n    Name:      ${(v.configMap || {}).name || (v.secret || {}).secretName || ""}`).join("\n");
    const tols = (p.spec.tolerations || []).map(t => t.operator === "Exists" && !t.key ? "op=Exists" : `${t.key}${t.value ? "=" + t.value : ""}:${t.effect || ""}${t.operator === "Exists" ? " op=Exists" : ""}`);
    return `Name:             ${p.name}
Namespace:        ${p.ns}
Priority:         0
Service Account:  ${p.spec.serviceAccountName || "default"}
Node:             ${p.node ? `${p.node}/${n ? n.ip : ""}` : "<none>"}
Labels:           ${Object.entries(p.labels).map(([k, v]) => `${k}=${v}`).join("\n                  ") || "<none>"}
Status:           ${p.fase === "Succeeded" ? "Succeeded" : p.fase === "Failed" ? "Failed" : p.node ? (p.fase === "Running" ? "Running" : "Pending") : "Pending"}
IP:               ${p.ip || ""}
Controlled By:    ${p.owner ? `${p.owner.kind}/${p.owner.name}` : "<none>"}${initTxt(p)}
Containers:
  ${c.name}:
    Image:          ${c.image}
    Port:           ${puertos}${comando}${args}
    State:          ${p.node ? estado : "Waiting\n      Reason:       Pending"}${ultimo}
    Ready:          ${!!p.listo}
    Restart Count:  ${p.reinicios || 0}${recursosTxt(c, "    ")}${sondaTxt("Liveness", c.livenessProbe)}${sondaTxt("Readiness", c.readinessProbe)}${envTxt(c, p.ns)}
    Mounts:${montaToken(p) ? "\n      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access (ro)" : ""}${podIdentityDe(p) ? "\n      /var/run/secrets/pods.eks.amazonaws.com/serviceaccount from eks-pod-identity-token (ro)" : ""}${(c.volumeMounts || []).map(m => `\n      ${m.mountPath} from ${m.name} (${m.readOnly ? "ro" : "rw"})`).join("")}
${ladosTxt(p)}Conditions:
  Type              Status
  PodScheduled      ${p.node ? "True" : "False"}
  Ready             ${p.listo ? "True" : "False"}
Volumes:
${vols ? vols + "\n" : ""}${podIdentityDe(p) ? "  eks-pod-identity-token:\n    Type:                    Projected (a volume that contains injected data from multiple sources)\n    TokenExpirationSeconds:  86400\n" : ""}${montaToken(p) ? "  kube-api-access:\n    Type:                    Projected (token, configmap, downwardAPI)" : "  <none>"}
QoS Class:                   ${qos(p.spec)}
Node-Selectors:              ${etiquetasTxt(p.spec.nodeSelector)}
Tolerations:                 ${tols.length ? tols.join("\n                             ") : "node.kubernetes.io/not-ready:NoExecute op=Exists for 300s\n                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s"}
${tablaEventos(eventosDePod(p))}`;
  }
  if (kind === "Node"){
    const n = x, o = aObjetoNodo(n); const ps = podsEnNodo(n); const u = usoNodo(n);
    const taints = o.spec.taints ? o.spec.taints.map(t => `${t.key}${t.value ? "=" + t.value : ""}:${t.effect}`) : [];
    return `Name:               ${n.name}
Roles:              <none>
Labels:             ${Object.entries(o.metadata.labels).map(([k, v]) => `${k}=${v}`).join("\n                    ")}
CreationTimestamp:  ${new Date(Date.now() - (ahora() - n.creado) * 1000).toUTCString()}
Taints:             ${taints.length ? taints.join("\n                    ") : "<none>"}
Unschedulable:      ${n.unsched}
Conditions:
${tabla([["  Type","Status","Reason","Message"], ...o.status.conditions.map(c => ["  " + c.type, c.status, c.reason, c.message])])}
Addresses:
  InternalIP:   ${n.ip}
  Hostname:     ${n.name}
Capacity:
  cpu:                2
  ephemeral-storage:  20893676Ki
  memory:             3927856Ki
  pods:               ${n.cap.pods}
Allocatable:
  cpu:                ${n.alloc.cpu}m
  ephemeral-storage:  18181869946
  memory:             3372848Ki
  pods:               ${n.alloc.pods}
System Info:
  Kernel Version:             6.18.62-127.179.amzn2023.x86_64
  OS Image:                   Amazon Linux 2023.12.20261118
  Container Runtime Version:  containerd://2.3.7+unknown
  Kubelet Version:            ${K8S_VER}
ProviderID:                   aws:///${n.az}/${n.id}
Non-terminated Pods:          (${ps.length} in total)
${tabla([["  Namespace","Name","CPU Requests","Memory Requests","Age"], ...ps.map(p => { const r = reqPod(p.spec); return ["  " + p.ns, p.name, `${r.cpu}m (${Math.round(r.cpu / n.alloc.cpu * 100)}%)`, `${Math.round(r.mem)}Mi (${Math.round(r.mem / n.alloc.mem * 100)}%)`, edad(p.creado)]; })])}
Allocated resources:
  Resource           Requests
  --------           --------
  cpu                ${u.cpu}m (${Math.round(u.cpu / n.alloc.cpu * 100)}%)
  memory             ${Math.round(u.mem)}Mi (${Math.round(u.mem / n.alloc.mem * 100)}%)
Events:              <none>`;
  }
  const ns = (x.metadata || {}).namespace;
  const cab = (extra) => `Name:         ${nombreDe(kind, x)}\n${ns ? `Namespace:    ${ns}\n` : ""}Labels:       ${etiquetasTxt(labelsDe(kind, x)).split(",").join("\n              ")}\nAnnotations:  ${Object.entries(sinInternas((x.metadata || {}).annotations)).map(([k, v]) => `${k}: ${v}`).join("\n              ") || "<none>"}${extra || ""}`;
  const evs = obj => { const l = S.eventos.filter(e => e.ns === ns && e.objeto === obj); return tablaEventos(l.slice(-8).map(e => [e.tipo, e.motivo, edad(e.ultima) + (e.cuenta > 1 ? ` (x${e.cuenta})` : ""), e.objeto.startsWith("replicaset") ? "replicaset-controller" : e.objeto.startsWith("job") ? "job-controller" : "deployment-controller", e.msg])); };
  if (kind === "Deployment"){
    const d = x, e = estadoDeployment(d); const c = d.spec.template.spec.containers[0];
    const rss = rsDeDeployment(d); const actual = rss.find(r => r.hash === d._rsActual);
    const fallos = actual ? S.eventos.filter(ev => ev.ns === ns && ev.objeto === `replicaset/${actual.name}` && ev.motivo === "FailedCreate") : [];
    const p = {spec:d.spec.template.spec};
    return cab() + `
Selector:               ${selectorTxt(d.spec.selector)}
Replicas:               ${d.spec.replicas ?? 1} desired | ${e.updatedReplicas} updated | ${e.replicas} total | ${e.availableReplicas} available | ${e.unavailableReplicas} unavailable
StrategyType:           RollingUpdate
RollingUpdateStrategy:  25% max unavailable, 25% max surge
Pod Template:
  Labels:  ${etiquetasTxt((d.spec.template.metadata || {}).labels)}
  Containers:
   ${c.name}:
    Image:      ${c.image}
    Port:       ${(c.ports || []).map(x => x.containerPort + "/TCP").join(", ") || "<none>"}${c.command ? "\n    Command:\n" + c.command.map(a => "      " + a).join("\n") : ""}${c.args ? "\n    Args:\n" + c.args.map(a => "      " + a).join("\n") : ""}${recursosTxt(c, "    ")}${sondaTxt("Liveness", c.livenessProbe)}${sondaTxt("Readiness", c.readinessProbe)}${envTxt(c, ns)}
  Node-Selectors:  ${etiquetasTxt(d.spec.template.spec.nodeSelector)}
  Tolerations:     ${(d.spec.template.spec.tolerations || []).map(t => `${t.key || ""}${t.value ? "=" + t.value : ""}:${t.effect || ""}`).join(", ") || "<none>"}
Conditions:
  Type           Status  Reason
  ----           ------  ------
  Available      ${e.availableReplicas >= (d.spec.replicas ?? 1) - Math.floor((d.spec.replicas ?? 1) * 0.25) ? "True    MinimumReplicasAvailable" : "False   MinimumReplicasUnavailable"}
  Progressing    ${e.actualizadosListos >= (d.spec.replicas ?? 1) ? "True    NewReplicaSetAvailable" : "True    ReplicaSetUpdated"}${fallos.length ? "\n  ReplicaFailure True    FailedCreate" : ""}
OldReplicaSets:  ${rss.filter(r => r !== actual && podsDeRS(r).length).map(r => `${r.name} (${podsDeRS(r).length}/${r.replicas} replicas created)`).join(", ") || "<none>"}
NewReplicaSet:   ${actual ? `${actual.name} (${podsDeRS(actual).length}/${actual.replicas} replicas created)` : "<none>"}
${tablaEventos(rss.slice(-3).map(r => ["Normal", "ScalingReplicaSet", edad(r.creado), "deployment-controller", `Scaled up replica set ${r.name} from 0 to ${r.replicas || 1}`]))}`;
  }
  if (kind === "ReplicaSet"){
    const r = x; const pods = podsDeRS(r);
    return `Name:           ${r.name}\nNamespace:      ${r.ns}\nSelector:       ${etiquetasTxt(Object.assign({}, (r.tpl.metadata || {}).labels, {"pod-template-hash":r.hash}))}\nAnnotations:    deployment.kubernetes.io/revision: ${r.rev}${r.causa ? "\n                kubernetes.io/change-cause: " + r.causa : ""}\nControlled By:  Deployment/${r.dep}\nReplicas:       ${pods.length} current / ${r.replicas} desired\nPods Status:    ${pods.filter(p => p.fase === "Running").length} Running / ${pods.filter(p => p.fase === "Pending").length} Waiting / 0 Succeeded / 0 Failed\nPod Template:\n  Containers:\n   ${r.tpl.spec.containers[0].name}:\n    Image:  ${r.tpl.spec.containers[0].image}\n` + (() => { const l = S.eventos.filter(e => e.ns === r.ns && e.objeto === `replicaset/${r.name}`); return tablaEventos(l.slice(-8).map(e => [e.tipo, e.motivo, edad(e.ultima) + (e.cuenta > 1 ? ` (x${e.cuenta})` : ""), "replicaset-controller", e.msg])); })();
  }
  if (kind === "Service"){
    const s = x; const e = endpointsDe(s); const p0 = s.spec.ports[0] || {};
    return cab(`\nSelector:          ${selectorTxt(s.spec.selector)}\nType:              ${s.spec.type}\nIP Family Policy:  SingleStack\nIP:                ${s.spec.clusterIP}\nIPs:               ${s.spec.clusterIP}${s.spec.type === "LoadBalancer" ? `\nLoadBalancer Ingress:     ${externaTxt(s) === "<pending>" ? "" : externaTxt(s)}` : ""}\n` +
      s.spec.ports.map(p => `Port:              ${p.name || "<unset>"}  ${p.port}/${p.protocol}\nTargetPort:        ${p.targetPort}/${p.protocol}${p.nodePort && s.spec.type !== "ClusterIP" ? `\nNodePort:          ${p.name || "<unset>"}  ${p.nodePort}/${p.protocol}` : ""}\nEndpoints:         ${e.length ? e.map(x => `${x.ip}:${puertoContenedor(x, p.targetPort) ?? p.targetPort}`).join(",") : ""}`).join("\n") +
      `\nSession Affinity:  None\n` + (s.spec.type === "LoadBalancer" ? tablaEventos([["Normal","EnsuringLoadBalancer",edad(s.metadata._t),"service-controller","Ensuring load balancer"], ...(externaTxt(s) !== "<pending>" ? [["Normal","EnsuredLoadBalancer",edad(s._lbEn || 0),"service-controller","Ensured load balancer"]] : [])]) : "Events:            <none>"));
  }
  if (kind === "ConfigMap") return cab() + "\n\nData\n====\n" + Object.entries(x.data || {}).map(([k, v]) => `${k}:\n----\n${v}\n`).join("\n") + "\nBinaryData\n====\n\nEvents:  <none>";
  if (kind === "Secret") return cab() + `\n\nType:  ${x.type || "Opaque"}\n\nData\n====\n` + Object.entries(x.data || {}).map(([k, v]) => `${k}:  ${(b64d(v) || "").length} bytes`).join("\n");
  if (kind === "HorizontalPodAutoscaler"){
    const h = x, m = metricaHPA(h);
    return cab(`\nCreationTimestamp:                                     ${h.metadata.creationTimestamp}\nReference:                                             Deployment/${h.spec.scaleTargetRef.name}\nMetrics:                                               ( current / target )\n  resource cpu on pods  (as a percentage of request):  ${m.error ? "<unknown>" : m.valor + "% (" + Math.round(m.valor / 2) + "m)"} / ${objetivoHPA(h)}%\nMin replicas:                                          ${h.spec.minReplicas || 1}\nMax replicas:                                          ${h.spec.maxReplicas}\nDeployment pods:                                       ${(h.status || {}).currentReplicas ?? 0} current / ${(h.status || {}).desiredReplicas ?? 0} desired\nConditions:\n  Type            Status  Reason                   Message\n  ----            ------  ------                   -------\n  AbleToScale     True    SucceededGetScale        the HPA controller was able to get the target's current scale\n  ScalingActive   ${m.error ? "False   FailedGetResourceMetric  the HPA was unable to compute the replica count: " + m.error : "True    ValidMetricFound         the HPA was able to successfully calculate a replica count from cpu resource utilization (percentage of request)"}\n`) + tablaEventos(m.error ? [["Warning","FailedGetResourceMetric","15s","horizontal-pod-autoscaler",m.error]] : []);
  }
  if (kind === "Job"){ const j = x, st = j.status || {}; return cab(`\nParallelism:      1\nCompletions:      ${j.spec.completions || 1}\nBackoff Limit:    ${j.spec.backoffLimit ?? 6}\nPods Statuses:    ${st.active || 0} Active / ${st.succeeded || 0} Succeeded / ${st.failed || 0} Failed\nPod Template:\n  Containers:\n   ${j.spec.template.spec.containers[0].name}:\n    Image:      ${j.spec.template.spec.containers[0].image}\n    Command:\n${(j.spec.template.spec.containers[0].command || []).concat(j.spec.template.spec.containers[0].args || []).map(a => "      " + a).join("\n")}\n`) + evs(`job/${j.metadata.name}`); }
  if (kind === "CronJob") return cab(`\nSchedule:                      ${x.spec.schedule}\nConcurrency Policy:            ${x.spec.concurrencyPolicy || "Allow"}\nSuspend:                       ${!!x.spec.suspend}\nSuccessful Job History Limit:  3\nFailed Job History Limit:      1\nLast Schedule Time:            <unset>\nActive Jobs:                   <none>\nEvents:                        <none>`);
  if (kind === "ResourceQuota"){ const o = aObjeto("ResourceQuota", x); return `Name:       ${x.metadata.name}\nNamespace:  ${ns}\n` + tabla([["Resource","Used","Hard"],["--------","----","----"], ...Object.keys(x.spec.hard || {}).map(k => [k, o.status.used[k], x.spec.hard[k]])]); }
  if (kind === "PodDisruptionBudget"){ const e = estadoPDB(x); return cab(`\nMin available:  ${x.spec.minAvailable ?? "N/A"}\nMax unavailable: ${x.spec.maxUnavailable ?? "N/A"}\nSelector:       ${selectorTxt(x.spec.selector)}\nStatus:\n    Allowed disruptions:  ${e.permitidas}\n    Current:              ${e.sanos}\n    Desired:              ${e.deseados}\n    Total:                ${e.total}\nEvents:                   <none>`); }
  if (kind === "NetworkPolicy"){
    const sp = x.spec || {};
    let s = cab(`\nCreated on:   ${x.metadata.creationTimestamp}\nSpec:\n  PodSelector:     ${selectorTxt(sp.podSelector) === "<none>" ? "<none> (Allowing the specific traffic to all pods in this namespace)" : selectorTxt(sp.podSelector)}`);
    const ing = sp.ingress; const tipos = sp.policyTypes || ["Ingress"];
    if (tipos.includes("Ingress")){
      if (!ing || !ing.length) s += "\n  Allowing ingress traffic:\n    <none> (Selected pods are isolated for ingress connectivity)";
      else s += "\n  Allowing ingress traffic:" + ing.map(r => `\n    To Port: ${(r.ports || []).map(p => p.port + "/" + (p.protocol || "TCP")).join(", ") || "<any> (traffic allowed to all ports)"}\n    From:\n` + ((r.from || []).map(f => f.podSelector ? `      PodSelector: ${selectorTxt(f.podSelector)}` : f.namespaceSelector ? `      NamespaceSelector: ${selectorTxt(f.namespaceSelector)}` : "      <any>").join("\n") || "      <any> (traffic not restricted by source)")).join("\n    ----------");
    }
    s += `\n  Not affecting egress traffic\n  Policy Types: ${tipos.join(", ")}`;
    return s;
  }
  if (kind === "Role" || kind === "ClusterRole"){
    const reglas = kind === "ClusterRole" && !x.metadata ? CLUSTERROLES[x.name] : x.rules || [];
    return `Name:         ${nombreDe(kind, x)}\nLabels:       <none>\nAnnotations:  <none>\nPolicyRule:\n` + tabla([["  Resources","Non-Resource URLs","Resource Names","Verbs"],["  ---------","-----------------","--------------","-----"], ...reglas.map(r => ["  " + (r.resources || []).join(", "), "[]", "[]", `[${(r.verbs || []).join(" ")}]`])]);
  }
  if (kind === "ClusterRoleBinding") return `Name:         ${x.metadata.name}
Labels:       <none>
Annotations:  <none>
Role:
  Kind:  ClusterRole
  Name:  ${(x.roleRef || {}).name}
Subjects:
` + tabla([["  Kind","Name","Namespace"],["  ----","----","---------"], ...(x.subjects || []).map(s => ["  " + s.kind, s.name, s.namespace || ""])]);
  if (kind === "RoleBinding") return cab() + `\nRole:\n  Kind:  ${(x.roleRef || {}).kind}\n  Name:  ${(x.roleRef || {}).name}\nSubjects:\n` + tabla([["  Kind","Name","Namespace"],["  ----","----","---------"], ...(x.subjects || []).map(s => ["  " + s.kind, s.name, s.namespace || ""])]);
  if (kind === "Namespace") return `Name:         ${x.name}\nLabels:       ${Object.entries(x.labels).map(([k, v]) => `${k}=${v}`).join("\n              ")}\nAnnotations:  <none>\nStatus:       Active\n\n` + (objs("ResourceQuota", x.name).length ? "Resource Quotas\n" + objs("ResourceQuota", x.name).map(q => `  Name: ${q.metadata.name}`).join("\n") + "\n\n" : "No resource quota.\n\n") + "No LimitRange resource.";
  if (kind === "ServiceAccount") return cab(`\nImage pull secrets:  <none>\nMountable secrets:   <none>\nTokens:              <none>\nEvents:              <none>`);
  if (kind === "DaemonSet"){ const pods = S.pods.filter(p => p.owner && p.owner.kind === "DaemonSet" && p.owner.name === x.metadata.name); return cab(`\nSelector:       ${selectorTxt(x.spec.selector)}\nNode-Selector:  <none>\nDesired Number of Nodes Scheduled: ${S.nodes.length}\nCurrent Number of Nodes Scheduled: ${pods.length}\nNumber of Nodes Scheduled with Up-to-date Pods: ${pods.length}\nNumber of Nodes Scheduled with Available Pods: ${pods.filter(p => p.listo).length}\nPods Status:  ${pods.filter(p => p.fase === "Running").length} Running / 0 Waiting / 0 Succeeded / 0 Failed\nPod Template:\n  Containers:\n   ${x.spec.template.spec.containers[0].name}:\n    Image:  ${x.spec.template.spec.containers[0].image}\nEvents:  <none>`); }
  return yamlDump(aObjeto(kind, x));
}
