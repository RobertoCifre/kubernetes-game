/* ============================================================================
   comandos.js — la terminal: kubectl, aws, tuberías (| grep, | base64 -d…),
   shells dentro de Pods y nodos, y los comandos del juego.
   ========================================================================== */
"use strict";

let CAPTURA = null;                       // si no es null, la salida normal se guarda aquí (tuberías)
let MODO = null;                          // shell interactiva: {tipo:"pod"|"nodo", …}
function out(t, cls){
  if (t === undefined || t === null) return;
  if (CAPTURA && cls !== "c-err" && cls !== "c-am" && cls !== "c-dim") { CAPTURA.push(String(t)); return; }
  pintarSalida(String(t), cls);
}
const err = m => out(m, "c-err");
const aviso = m => out(m, "c-am");
const nota = m => out(m, "c-dim");

/* ---------- troceado de la línea ---------- */
function trocear(s){
  const r = []; let act = "", q = null, hay = false;
  for (let i = 0; i < s.length; i++){
    const c = s[i];
    if (q){ if (c === q){ q = null; continue; } if (c === "\\" && q === '"' && s[i+1] === '"'){ act += '"'; i++; continue; } act += c; continue; }
    if (c === "'" || c === '"'){ q = c; hay = true; continue; }
    if (/\s/.test(c)){ if (act !== "" || hay) r.push(act); act = ""; hay = false; continue; }
    act += c;
  }
  if (q) throw new Error("comillas sin cerrar");
  if (act !== "" || hay) r.push(act);
  return r;
}
function partirFuera(s, sep){            // parte por un separador fuera de comillas
  const r = []; let act = "", q = null;
  for (let i = 0; i < s.length; i++){
    const c = s[i];
    if (q){ act += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"'){ q = c; act += c; continue; }
    if (s.startsWith(sep, i) && !(sep === "|" && (s[i+1] === "|" || s[i-1] === "|"))){ r.push(act); act = ""; i += sep.length - 1; continue; }
    act += c;
  }
  r.push(act); return r.map(x => x.trim());
}

/* ---------- flags ---------- */
const BOOL_LARGOS = ["prefix","all-containers","all-namespaces","show-labels","no-headers","overwrite","ignore-daemonsets","delete-emptydir-data","force","rm","wait","watch","previous","follow","all","list","record","stdin","tty","current","approve","client","short","raw","help","quiet","disable-eviction","dry-run-server","recursive","timestamps","show-kind","local"];
const VALOR_CORTOS = ["n","o","l","L","c","f","p","s","e"];
function flags(args, verbo){
  const f = {}, pos = []; let tras = [];
  const poner = (k, v) => { if (k in f && ["from-literal","env","labels","L","hard"].includes(k)) f[k] = [].concat(f[k], v); else f[k] = v; };
  for (let i = 0; i < args.length; i++){
    const x = args[i];
    if (x === "--"){ tras = args.slice(i + 1); break; }
    if (x.startsWith("--") && x.length > 2){
      const m = x.slice(2).match(/^([^=]+)(?:=(.*))?$/s); const k = m[1];
      if (m[2] !== undefined) poner(k, m[2]);
      else if (BOOL_LARGOS.includes(k) || !(i + 1 < args.length) || (args[i+1].startsWith("-") && !/^-\d/.test(args[i+1]))) poner(k, true);
      else poner(k, args[++i]);
      continue;
    }
    if (/^-[a-zA-Z]$/.test(x)){
      const k = x[1];
      const valor = VALOR_CORTOS.includes(k) && !(k === "p" && verbo === "logs") && !(k === "f" && verbo === "logs") && !(k === "i" || k === "t");
      if (valor && i + 1 < args.length) poner(k, args[++i]); else poner(k, true);
      continue;
    }
    if (/^-[a-zA-Z]{2,}$/.test(x) && !/^-\d/.test(x)){ for (const k of x.slice(1)) f[k] = true; continue; }
    if (/^-[a-zA-Z]=/.test(x)){ poner(x[1], x.slice(3)); continue; }
    pos.push(x);
  }
  if (f.namespace !== undefined) f.n = f.namespace;
  if (f["all-namespaces"]) f.A = true;
  if (f.output !== undefined) f.o = f.output;
  if (f.selector !== undefined) f.l = f.selector;
  if (f.filename !== undefined) f.f = f.filename;
  if (f.container !== undefined) f.c = f.container;
  if (f.patch !== undefined) f.p = f.patch;
  if (f["label-columns"] !== undefined) f.L = f["label-columns"];
  return {f, pos, tras};
}
function nsDeFlags(f){ return typeof f.n === "string" ? f.n : (S.defNs || "default"); }
function compruebaNs(ns){ if (!S.ns[ns]){ err(`Error from server (NotFound): namespaces "${ns}" not found`); return false; } return true; }
function tipoNombre(pos){   // "deploy/web" | "deploy web" → {r, nombre, resto}
  if (!pos.length) return {r:null};
  if (pos[0].includes("/")){ const [t, n] = pos[0].split("/"); return {r:recurso(t), tok:t, nombre:n, resto:pos.slice(1)}; }
  return {r:recurso(pos[0]), tok:pos[0], nombre:pos[1], resto:pos.slice(2)};
}
function noExiste(r, nombre){ const grupo = r.api.includes("/") ? "." + r.api.split("/")[0] : ""; err(`Error from server (NotFound): ${r.plural}${grupo} "${nombre}" not found`); }
function pistaNs(ns){ if (ns === "default" && JUEGO.nivelNs()) nota(`   (¿te falta -n ${JUEGO.nivelNs()}? Sin -n, kubectl mira en «default».)`); }
function selectorLabels(expr){
  const partes = String(expr).split(",").map(x => x.trim()).filter(Boolean);
  return labels => partes.every(p => {
    let m;
    if ((m = p.match(/^([^!=]+)!=(.*)$/))) return labels[m[1]] !== m[2];
    if ((m = p.match(/^([^=]+)==?(.*)$/))) return labels[m[1]] === m[2];
    if ((m = p.match(/^!(.+)$/))) return !(m[1] in labels);
    return p in labels;
  });
}

/* ---------- entrada principal ---------- */
function ejecutarLinea(linea){
  linea = linea.trim(); if (!linea) return;
  if (MODO) return lineaEnShell(linea);
  let codigo = 0;
  const grupos = partirFuera(linea, ";");
  for (const g of grupos){
    const encadenados = partirFuera(g, "&&");
    for (const e of encadenados){ if (!e) continue; codigo = ejecutarTuberia(e); if (codigo !== 0) break; if (MODO) break; }
  }
  reconciliar();
}
function ejecutarTuberia(texto){
  const etapas = partirFuera(texto, "|");
  if (etapas.length === 1) return ejecutarComando(etapas[0]);
  CAPTURA = [];
  let codigo = 0;
  try { codigo = ejecutarComando(etapas[0]); } catch(e){ CAPTURA = null; throw e; }
  let lineas = CAPTURA.join("\n").split("\n"); if (lineas.length === 1 && lineas[0] === "") lineas = [];
  CAPTURA = null;
  for (const etapa of etapas.slice(1)){
    const r = filtro(etapa, lineas);
    if (r === null) return 1;
    lineas = r;
  }
  if (lineas.length) out(lineas.join("\n"));
  return codigo;
}
function filtro(etapa, lineas){
  let a; try { a = trocear(etapa); } catch(e){ err(e.message); return null; }
  const [prog, ...args] = a;
  switch (prog){
    case "grep": {
      let inv = false, ic = false, cuenta = false, ext = false; const resto = [];
      for (const x of args){ if (/^-[ivcE]+$/.test(x)){ inv = inv || x.includes("v"); ic = ic || x.includes("i"); cuenta = cuenta || x.includes("c"); ext = ext || x.includes("E"); } else resto.push(x); }
      const patron = resto[0]; if (patron === undefined){ err("Usage: grep [OPTION]... PATTERNS [FILE]..."); return null; }
      let re; try { re = new RegExp(ext ? patron : patron.replace(/[.*+?^${}()|[\]\\]/g, m => m === "." || m === "*" || m === "^" || m === "$" ? m : "\\" + m), ic ? "i" : ""); } catch(e){ re = new RegExp(patron.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), ic ? "i" : ""); }
      const r = lineas.filter(l => re.test(l) !== inv);
      return cuenta ? [String(r.length)] : r;
    }
    case "wc": if (args.includes("-l")) return [String(lineas.length)]; return [`${lineas.length} ${lineas.join(" ").split(/\s+/).filter(Boolean).length} ${lineas.join("\n").length}`];
    case "head": { const n = args[0] === "-n" ? parseInt(args[1], 10) : args[0] && /^-\d+$/.test(args[0]) ? -parseInt(args[0], 10) : 10; return lineas.slice(0, n); }
    case "tail": { const n = args[0] === "-n" ? parseInt(args[1], 10) : args[0] && /^-\d+$/.test(args[0]) ? -parseInt(args[0], 10) : 10; return lineas.slice(-n); }
    case "sort": { const r = lineas.slice().sort(); return args.includes("-r") ? r.reverse() : r; }
    case "uniq": { const r = []; for (const l of lineas) if (r[r.length - 1] !== l) r.push(l); return args.includes("-c") ? r.map(l => `      ${lineas.filter(x => x === l).length} ${l}`) : r; }
    case "base64": {
      const texto = lineas.join("\n");
      if (args.includes("-d") || args.includes("--decode")){ const r = b64d(texto); if (r === null){ err("base64: invalid input"); return null; } return r.split("\n"); }
      return [b64e(texto + (lineas.length ? "\n" : ""))];
    }
    case "awk": {
      const m = (args[0] || "").match(/\{\s*print\s+([^}]*)\}/);
      if (!m){ err("(simulador) awk: solo se admite '{print $N}'"); return null; }
      const campos = m[1].split(",").map(x => x.trim());
      return lineas.map(l => { const c = l.trim().split(/\s+/); return campos.map(x => x === "$0" ? l : /^\$\d+$/.test(x) ? (c[parseInt(x.slice(1), 10) - 1] || "") : x.replace(/"/g, "")).join(" "); });
    }
    case "cut": { const d = (args.find(x => x.startsWith("-d")) || "-d\t").slice(2) || "\t"; const fi = parseInt((args.find(x => x.startsWith("-f")) || "-f1").slice(2), 10); return lineas.map(l => l.split(d)[fi - 1] || ""); }
    case "jq": { err("(simulador) jq no está disponible: usa kubectl -o jsonpath='{…}'"); return null; }
    case "less": case "more": case "cat": return lineas;
    default: err(`${prog}: command not found (en las tuberías del simulador: grep, wc -l, head, tail, sort, uniq, base64, awk, cut)`); return null;
  }
}
const ERRATAS = ["ectl","kubctl","kubeclt","kubect","kubetcl","kuectl","kuberctl","kubecl","kubecttl","kctl","kubectrl","kubeclt","kubeectl","kubelctl","kubect1","kubeclt"];
const VERBOS = ["get","describe","logs","create","expose","set","scale","autoscale","cordon","uncordon","drain","delete","top","apply","edit","patch","label","taint","rollout","exec","run","explain","port-forward","config","auth","api-resources","events"];
/* ---------- atajos: los alias habituales (plugin kubectl de oh-my-zsh / kubectl-aliases) + kubens/kubectx + alias propios ---------- */
const ATAJOS = {
  k:"kubectl",
  kg:"kubectl get", kgp:"kubectl get pods", kgpa:"kubectl get pods --all-namespaces", kgpw:"kubectl get pods -o wide", kgpwide:"kubectl get pods -o wide", kgpl:"kubectl get pods -l",
  kgd:"kubectl get deployment", kgs:"kubectl get svc", kgn:"kubectl get nodes", kgno:"kubectl get nodes", kga:"kubectl get all", kgaa:"kubectl get all --all-namespaces",
  kgns:"kubectl get namespaces", kgcm:"kubectl get configmaps", kgsec:"kubectl get secret", kgrs:"kubectl get rs", kgj:"kubectl get jobs", kgcj:"kubectl get cronjob",
  kgds:"kubectl get daemonset", kgsa:"kubectl get serviceaccounts", kgev:"kubectl get events --sort-by=.lastTimestamp", kge:"kubectl get events --sort-by=.lastTimestamp",
  kd:"kubectl describe", kdp:"kubectl describe pods", kdd:"kubectl describe deployment", kds:"kubectl describe svc", kdn:"kubectl describe node", kdno:"kubectl describe node",
  kl:"kubectl logs", klf:"kubectl logs -f", klp:"kubectl logs --previous",
  kex:"kubectl exec -it", keti:"kubectl exec -t -i",
  ka:"kubectl apply", kaf:"kubectl apply -f", kak:"kubectl apply -k", kc:"kubectl create", ke:"kubectl edit", ked:"kubectl edit deployment", kes:"kubectl edit svc",
  kdel:"kubectl delete", krm:"kubectl delete", kdelp:"kubectl delete pods", kdeld:"kubectl delete deployment", kdels:"kubectl delete svc", kdelf:"kubectl delete -f",
  ksd:"kubectl scale deployment", kpf:"kubectl port-forward",
  krsd:"kubectl rollout status deployment", krh:"kubectl rollout history", kru:"kubectl rollout undo", krrd:"kubectl rollout restart deployment",
  kccc:"kubectl config current-context", kcgc:"kubectl config get-contexts", kcuc:"kubectl config use-context", kcn:"kubectl config set-context --current --namespace",
  kt:"kubectl top", ktp:"kubectl top pods", ktn:"kubectl top nodes",
};
const ALIAS_PROPIOS = {};
function expandirAtajo(a){
  for (let vueltas = 0; vueltas < 5; vueltas++){
    const def = ALIAS_PROPIOS[a[0]] || ATAJOS[a[0]];
    if (!def || def === a[0]) return a;
    let nuevo; try { nuevo = trocear(def); } catch(e){ return a; }
    // «kcn nivel-3» → --namespace=nivel-3 (el último flag del alias recibe el primer argumento)
    if (/--namespace$/.test(def) && a[1]) a = [...nuevo.slice(0, -1), "--namespace=" + a[1], ...a.slice(2)];
    else a = [...nuevo, ...a.slice(1)];
    if (a[0] === "kubectl") return a;
  }
  return a;
}
function cmdAlias(a){
  const resto = a.slice(1).join(" ");
  if (!resto){
    const propios = Object.entries(ALIAS_PROPIOS).map(([k, v]) => `alias ${k}='${v}'`);
    out(propios.concat(Object.entries(ATAJOS).map(([k, v]) => `alias ${k}='${v}'`)).join("\n"));
    nota("(los de abajo vienen de serie; crea los tuyos con: alias kk='kubectl get pods' · quítalos con: unalias kk)");
    return 0;
  }
  const m = resto.match(/^([\w.-]+)=(['"]?)(.*)\2$/);
  if (!m){ const def = ALIAS_PROPIOS[resto] || ATAJOS[resto]; if (def){ out(`alias ${resto}='${def}'`); return 0; } err(`alias: ${resto}: not found`); return 1; }
  if (["alias","unalias","help","pista","solucion","responder","nivel","siguiente","mapa"].includes(m[1])){ err(`(simulador) «${m[1]}» es un comando del juego: elige otro nombre`); return 1; }
  ALIAS_PROPIOS[m[1]] = m[3]; nota(`(alias «${m[1]}» guardado para esta sesión)`); return 0;
}
function cmdUnalias(a){ const n = a[1]; if (!n){ err("unalias: usage: unalias name"); return 1; } if (n in ALIAS_PROPIOS){ delete ALIAS_PROPIOS[n]; return 0; } if (n in ATAJOS){ nota(`(«${n}» es un atajo de serie del simulador: no se puede quitar)`); return 0; } err(`unalias: ${n}: not found`); return 1; }
function cmdKubens(a){
  const ns = a[1];
  if (!ns){ out(Object.keys(S.ns).sort().map(n => n === (S.defNs || "default") ? n + "   ← activo" : n).join("\n")); return 0; }
  if (ns === "-"){ err("(simulador) «kubens -» no está: di el namespace"); return 1; }
  if (!S.ns[ns]){ err(`error: no namespace exists with name "${ns}".`); return 1; }
  S.defNs = ns === "default" ? null : ns;
  out(`✔ Active namespace is "${ns}"`);
  nota(`(desde ahora, los comandos sin -n van a «${ns}». Es lo mismo que: kubectl config set-context --current --namespace=${ns})`);
  return 0;
}
function cmdKubectx(a){ if (!a[1]){ out("eks-juego"); return 0; } if (a[1] !== "eks-juego"){ err(`error: no context exists with the name: "${a[1]}"`); return 1; } out('✔ Switched to context "eks-juego".'); return 0; }

function ejecutarComando(texto){
  let a; try { a = trocear(texto); } catch(e){ err(e.message); return 1; }
  if (!a.length) return 0;
  // here-string: echo X | base64 -d  ya va por tubería; base64 -d <<< X
  const hs = texto.match(/^base64\s+(-d|--decode)?\s*<<<\s*(.*)$/);
  if (hs){ const v = trocear(hs[2]).join(" "); if (hs[1]){ const r = b64d(v); if (r === null){ err("base64: invalid input"); return 1; } out(r); } else out(b64e(v + "\n")); return 0; }
  let c = a[0];
  if (/^\d+$/.test(c) && JUEGO.esPregunta()){ return JUEGO.comando("responder", [c]) ? 0 : 1; }
  if (JUEGO.comando(c, a.slice(1))) return 0;
  if (c !== "kubectl" && (ALIAS_PROPIOS[c] || ATAJOS[c])){ a = expandirAtajo(a); c = a[0]; }
  if (ERRATAS.includes(c)){ aviso(`💡 Querías decir «kubectl». Lo ejecuto así (truco: «k» también vale).`); c = "kubectl"; a[0] = c; }
  if (VERBOS.includes(c)){ aviso(`💡 En Kubernetes todo empieza por «kubectl». Lo ejecuto como: kubectl ${a.join(" ")}`); a = ["kubectl", ...a]; c = "kubectl"; }
  switch (c){
    case "kubectl": return kubectl(a.slice(1)) || 0;
    case "aws": return aws(a.slice(1)) || 0;
    case "curl": case "wget": return curlLocal(c, a.slice(1));
    case "echo": out(a.slice(1).filter(x => x !== "-n" && x !== "-e").join(" ")); return 0;
    case "base64": err("base64: lee de una tubería: echo <texto> | base64 -d"); return 1;
    case "sleep": { const n = Math.min(parseFloat(a[1] || "1") || 1, 900); avanzarReloj(n); reconciliar(); nota(`(simulador: el reloj del cluster avanza ${n} s)`); return 0; }
    case "date": out(new Date().toString()); return 0;
    case "export": nota("(variable guardada solo para esta sesión simulada)"); return 0;
    case "alias": return cmdAlias(a);
    case "unalias": return cmdUnalias(a);
    case "kubens": case "kns": return cmdKubens(a);
    case "kubectx": case "kctx": return cmdKubectx(a);
    case "source": case ".": nota("(simulador) no hace falta: el entorno ya está cargado (perfil «laboratorio», región eu-west-1)."); return 0;
    case "watch": nota("(simulador) «watch» no está: ejecuta el comando otra vez, o usa «sleep 10» para hacer avanzar el reloj."); return 0;
    case "ls": case "cd": case "pwd": case "cat": case "vi": case "vim": case "nano": case "rm": case "mkdir": case "touch":
      aviso(`«${c}» es de tu Linux, no del cluster. Aquí trabajas con kubectl y aws. Para ver qué hay: kubectl get all -n ${JUEGO.nivelNs() || "default"}`); return 1;
    case "nslookup": case "ping": case "dig": case "ssh":
      aviso(`Desde tu PC no llegas a la red interna del cluster. Pruébalo desde DENTRO:\n  kubectl run prueba --rm -it --image=busybox:1.37 -n ${JUEGO.nivelNs() || "default"} -- ${c === "ssh" ? "sh" : "nslookup <servicio>"}${c === "ssh" ? "\n  (o entra en un nodo con: aws ssm start-session --target <i-…>)" : ""}`); return 1;
    case "helm": case "eksctl": case "terraform": case "docker":
      aviso(`«${c}» no está en este simulador (en tu PC real sí). Aquí: kubectl y aws.`); return 1;
    default:
      err(`${c}: command not found`); nota("Escribe «help» para ver lo que puedes usar."); return 127;
  }
}

/* ============================== kubectl ============================== */
function kubectl(a){
  if (!a.length){ out("kubectl controls the Kubernetes cluster manager.\n\n Find more information at: https://kubernetes.io/docs/reference/kubectl/\n\n(en el juego: escribe «help»)"); return 0; }
  const verbo = a[0];
  const {f, pos, tras} = flags(a.slice(1), verbo);
  if (f.help || f.h){ return ayudaVerbo(verbo); }
  const ns = nsDeFlags(f);
  const MUTANTES = ["create","expose","run","set","scale","autoscale","apply","replace","patch","label","annotate","taint","cordon","uncordon","drain","delete","rollout"];
  if (f["dry-run"] !== undefined && f["dry-run"] !== "none" && f["dry-run"] !== false && MUTANTES.includes(verbo)) return enSeco(a, f);
  switch (verbo){
    case "version": out(f.client ? "Client Version: v1.36.1\nKustomize Version: v5.8.1" : `Client Version: v1.36.1\nKustomize Version: v5.8.1\nServer Version: ${K8S_VER}`); return 0;
    case "cluster-info": out(`Kubernetes control plane is running at https://0A1B2C3D4E5F60718293A4B5C6D7E8F9.yl4.${REGION}.eks.amazonaws.com\nCoreDNS is running at https://0A1B2C3D4E5F60718293A4B5C6D7E8F9.yl4.${REGION}.eks.amazonaws.com/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy\n\nTo further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.`); return 0;
    case "get": return kGet(pos, f, ns);
    case "describe": return kDescribe(pos, f, ns);
    case "logs": return kLogs(pos, f, ns);
    case "events": return kEventos(f, ns);
    case "create": return kCreate(pos, f, ns, tras);
    case "expose": return kExpose(pos, f, ns);
    case "run": return kRun(pos, f, ns, tras);
    case "set": return kSet(pos, f, ns);
    case "scale": return kScale(pos, f, ns);
    case "autoscale": return kAutoscale(pos, f, ns);
    case "rollout": return kRollout(pos, f, ns);
    case "edit": return kEdit(pos, f, ns);
    case "apply": return kApply(pos, f, ns, false);
    case "replace": return kApply(pos, f, ns, false);
    case "patch": return kPatch(pos, f, ns);
    case "label": return kLabel(pos, f, ns);
    case "annotate": return kAnnotate(pos, f, ns);
    case "taint": return kTaint(pos, f);
    case "cordon": case "uncordon": return kCordon(verbo, pos);
    case "drain": return kDrain(pos, f);
    case "delete": return kDelete(pos, f, ns);
    case "exec": return kExec(pos, f, ns, tras);
    case "port-forward": return kPortForward(pos, f, ns);
    case "top": return kTop(pos, f, ns);
    case "explain": return kExplain(pos);
    case "api-resources": out(tabla([["NAME","SHORTNAMES","APIVERSION","NAMESPACED","KIND"], ...Object.entries(RECURSOS).map(([p, r]) => [p, r.cortos.filter(x => x.length < p.length - 1 && x !== p.slice(0, -1)).join(",") || "", r.api, String(!r.cluster), r.kind])])); return 0;
    case "config": return kConfig(pos, f);
    case "auth": return kAuth(pos, f, ns);
    case "wait": return kWait(pos, f, ns);
    case "api-versions": out(["admissionregistration.k8s.io/v1","apiextensions.k8s.io/v1","apps/v1","authentication.k8s.io/v1","authorization.k8s.io/v1","autoscaling/v1","autoscaling/v2","batch/v1","certificates.k8s.io/v1","coordination.k8s.io/v1","discovery.k8s.io/v1","events.k8s.io/v1","flowcontrol.apiserver.k8s.io/v1","networking.k8s.io/v1","node.k8s.io/v1","policy/v1","rbac.authorization.k8s.io/v1","scheduling.k8s.io/v1","storage.k8s.io/v1","v1","vpcresources.k8s.aws/v1beta1"].join("\n")); return 0;
    case "wait-viejo": aviso("(simulador) «kubectl wait» no está. Usa «kubectl rollout status» o «kubectl get … -w» (aquí: vuelve a mirar o «sleep 10»)."); return 1;
    case "debug": return kDebug(pos, f, ns, tras);
    case "proxy": return kProxy(f);
    case "attach": return kAttach(pos, f, ns);
    case "cp": return kCp(pos, f, ns);
    case "diff": return kDiff(pos, f, ns);
    case "kustomize": case "certificate": case "plugin": case "completion":
      aviso(`(simulador) «kubectl ${verbo}» no está disponible aquí. En tu cluster real sí.`); return 1;
    default: err(`error: unknown command "${verbo}" for "kubectl"\n\nDid you mean this?\n\t${VERBOS.find(v => v.startsWith(verbo.slice(0, 2))) || "get"}`); return 1;
  }
}
/* --dry-run: se ejecuta sobre una COPIA del cluster, se enseña lo que habría pasado y se descarta */
function clonarEstado(o, vistos = new Map()){
  if (o === null || typeof o !== "object") return o;
  if (vistos.has(o)) return vistos.get(o);
  const c = Array.isArray(o) ? [] : Object.create(Object.getPrototypeOf(o));
  vistos.set(o, c);
  for (const k of Reflect.ownKeys(o)){
    if (Array.isArray(o) && k === "length") continue;
    const d = Object.getOwnPropertyDescriptor(o, k);
    if ("value" in d) d.value = clonarEstado(d.value, vistos);
    Object.defineProperty(c, k, d);
  }
  return c;
}
const VERBOS_HECHO = /\b(created|configured|patched|scaled|labeled|annotated|deleted|tainted|untainted|cordoned|uncordoned|drained|autoscaled|exposed|restarted|rolled back|unchanged|image updated|env updated|resource requirements updated|selector updated|evicted)\b(?!.*\(dry run\))/;
function enSeco(a, f){
  const formato = f.o || f.output;
  const limpio = [];                                     // los mismos argumentos, sin --dry-run ni -o
  for (let i = 0; i < a.length; i++){
    const x = a[i];
    if (/^--dry-run(=.*)?$/.test(x)) continue;
    if (x === "-o" || x === "--output"){ i++; continue; }
    if (/^-o\S+$/.test(x) || /^--output=/.test(x)) continue;
    limpio.push(x);
  }
  const real = S, modoReal = MODO;
  const clave = o => `${o.kind}/${o.metadata.namespace || ""}/${o.metadata.name}`;
  const antes = new Map(real.objs.map(o => [clave(o), JSON.stringify(o)]));
  const podsAntes = new Set(real.pods.map(p => p.ns + "/" + p.name));
  const ant = CAPTURA; const salida = []; CAPTURA = salida;
  let codigo = 1, copiaS = null;
  try { S = clonarEstado(real); codigo = kubectl(limpio); }
  finally { CAPTURA = ant; copiaS = S; S = real; MODO = modoReal; }
  if (codigo !== 0) return codigo;                       // los errores ya salieron por pantalla
  const marca = t => t.split("\n").map(z => z.replace(VERBOS_HECHO, "$1 (dry run)")).join("\n");
  if (formato === "yaml" || formato === "json"){
    const cambiados = copiaS.objs.filter(o => antes.get(clave(o)) !== JSON.stringify(o));
    const podsNuevos = copiaS.pods.filter(p => !podsAntes.has(p.ns + "/" + p.name) && !p.efimero && !cambiados.some(o => o.kind === "Pod" && o.metadata.name === p.name));
    const lista = cambiados.map(o => o.kind === "Pod" ? copia(o) : aObjeto(o.kind, o)).concat(podsNuevos.map(p => aObjetoPod(p)));
    for (const o of lista){ delete o.status; if (o.metadata) delete o.metadata.uid; }
    if (!lista.length){ for (const l of salida) out(marca(l)); return 0; }
    const uno = lista.length === 1 ? lista[0] : {apiVersion:"v1", kind:"List", items:lista};
    out(formato === "json" ? JSON.stringify(uno, null, 2) : yamlDump(uno).replace(/\n$/, ""));
    return 0;
  }
  for (const l of salida) out(marca(l));
  return 0;
}
function ayudaVerbo(v){
  const A = {
    get:"Display one or many resources.\n\nExamples:\n  kubectl get pods -n <ns>\n  kubectl get pods -A -o wide\n  kubectl get deploy web -n <ns> -o yaml\n  kubectl get pods -l app=web --show-labels\n  kubectl get nodes -L topology.kubernetes.io/zone\n  kubectl get pod <pod> -o jsonpath='{.status.podIP}'",
    describe:"Show details of a specific resource or group of resources.\n\nExamples:\n  kubectl describe pod <pod> -n <ns>\n  kubectl describe node <nodo>\n  kubectl describe deploy <nombre> -n <ns>",
    create:"Create a resource from a file or from stdin.\n\nAvailable Commands:\n  configmap       Create a config map from a local file, directory or literal value\n  cronjob         Create a cron job with the specified name\n  deployment      Create a deployment with the specified name\n  job             Create a job with the specified name\n  namespace       Create a namespace with the specified name\n  role            Create a role with single rule\n  rolebinding     Create a role binding for a particular role or cluster role\n  secret          Create a secret\n  serviceaccount  Create a service account with the specified name\n  quota           Create a quota with the specified name\n\nExamples:\n  kubectl create deployment web --image=nginx:1.27-alpine --replicas=3 -n <ns>\n  kubectl create configmap cfg --from-literal=CLAVE=valor -n <ns>\n  kubectl create secret generic s --from-literal=password=x -n <ns>\n  kubectl create job j --image=busybox:1.37 -n <ns> -- echo hola\n  kubectl create cronjob c --image=busybox:1.37 --schedule=\"*/5 * * * *\" -n <ns> -- echo hola\n  kubectl create role r --verb=get,list --resource=pods -n <ns>\n  kubectl create rolebinding rb --role=r --serviceaccount=<ns>:<sa> -n <ns>",
    expose:"Expose a resource as a new Kubernetes service.\n\nExamples:\n  kubectl expose deployment web --port=80 -n <ns>\n  kubectl expose deployment web --port=80 --target-port=8080 -n <ns>\n  kubectl expose deployment web --type=LoadBalancer --port=80 -n <ns>",
    set:"Configure application resources.\n\nAvailable Commands:\n  env         Update environment variables on a pod template\n  image       Update the image of a pod template\n  resources   Update resource requests/limits on objects with pod templates\n  selector    Set the selector on a resource\n\nExamples:\n  kubectl set image deployment/web nginx=nginx:1.28-alpine -n <ns>\n  kubectl set env deployment/web MODO=normal -n <ns>\n  kubectl set env deployment/web --list -n <ns>\n  kubectl set resources deployment web --limits=memory=256Mi --requests=cpu=100m -n <ns>\n  kubectl set selector service web app=web -n <ns>",
    scale:"Set a new size for a deployment.\n\nExamples:\n  kubectl scale deployment web --replicas=5 -n <ns>",
    autoscale:"Creates an autoscaler.\n\nExamples:\n  kubectl autoscale deployment web --min=1 --max=4 --cpu-percent=50 -n <ns>\n  kubectl autoscale deployment web --min=1 --max=4 --cpu=50% -n <ns>",
    rollout:"Manage the rollout of a resource.\n\nAvailable Commands:\n  history     View rollout history\n  restart     Restart a resource\n  status      Show the status of the rollout\n  undo        Undo a previous rollout\n\nExamples:\n  kubectl rollout status deployment/web -n <ns>\n  kubectl rollout history deployment/web -n <ns>\n  kubectl rollout undo deployment/web -n <ns>\n  kubectl rollout undo deployment/web --to-revision=2 -n <ns>\n  kubectl rollout restart deployment/web -n <ns>",
    logs:"Print the logs for a container in a pod.\n\nExamples:\n  kubectl logs <pod> -n <ns>\n  kubectl logs <pod> -n <ns> --previous\n  kubectl logs deploy/<nombre> -n <ns>\n  kubectl logs job/<nombre> -n <ns>",
    exec:"Execute a command in a container.\n\nExamples:\n  kubectl exec <pod> -n <ns> -- env\n  kubectl exec -it <pod> -n <ns> -- sh\n  kubectl exec deploy/<nombre> -n <ns> -- cat /etc/resolv.conf",
    run:"Create and run a particular image in a pod.\n\nExamples:\n  kubectl run prueba --rm -it --image=busybox:1.37 -n <ns> -- nslookup <svc>\n  kubectl run prueba --rm -it --image=busybox:1.37 -n <ns> -- wget -qO- -T 3 http://<svc>\n  kubectl run prueba --rm -it --image=busybox:1.37 -n <ns>      (shell interactiva)",
    drain:"Drain node in preparation for maintenance.\n\nExamples:\n  kubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data",
    taint:"Update the taints on one or more nodes.\n\nExamples:\n  kubectl taint nodes <nodo> clave=valor:NoSchedule\n  kubectl taint nodes <nodo> clave-\n  kubectl taint nodes --all clave-",
    label:"Update the labels on a resource.\n\nExamples:\n  kubectl label node <nodo> disco=ssd\n  kubectl label node <nodo> disco-\n  kubectl label pod <pod> tier=frontend --overwrite -n <ns>",
    edit:"Edit a resource on the server.\n\nExamples:\n  kubectl edit deployment <nombre> -n <ns>\n  kubectl edit svc <nombre> -n <ns>\n  kubectl edit configmap <nombre> -n <ns>\n  kubectl edit resourcequota <nombre> -n <ns>",
    apply:"Apply a configuration to a resource by file name or stdin.\n\nExamples:\n  kubectl apply -f -        (en el juego abre un editor para escribir el YAML)",
    patch:"Update fields of a resource using strategic merge patch, a JSON merge patch, or a JSON patch.\n\nExamples:\n  kubectl patch deployment web -n <ns> -p '{\"spec\":{\"replicas\":3}}'\n  kubectl patch svc web -n <ns> -p '{\"spec\":{\"ports\":[{\"port\":80,\"targetPort\":80}]}}'\n  kubectl patch deployment web -n <ns> --type=json -p '[{\"op\":\"replace\",\"path\":\"/spec/replicas\",\"value\":2}]'",
    "port-forward":"Forward one or more local ports to a pod.\n\nExamples:\n  kubectl port-forward svc/web 8080:80 -n <ns>\n  kubectl port-forward pod/<pod> 8080:80 -n <ns>",
    auth:"Inspect authorization.\n\nExamples:\n  kubectl auth can-i list pods -n <ns>\n  kubectl auth can-i delete pods -n <ns> --as=system:serviceaccount:<ns>:<sa>\n  kubectl auth can-i --list -n <ns> --as=system:serviceaccount:<ns>:<sa>\n  kubectl auth whoami",
    delete:"Delete resources by file names, stdin, resources and names, or by resources and label selector.\n\nExamples:\n  kubectl delete pod <pod> -n <ns>\n  kubectl delete deployment <nombre> -n <ns>\n  kubectl delete pods -l app=web -n <ns>",
  };
  out(A[v] || `(simulador) ayuda de «${v}»: mira «help» del juego.`); return 0;
}

/* ---------- get ---------- */
function kGet(pos, f, ns){
  if (f.raw) return getRaw(f.raw === true ? pos[0] : f.raw);
  if (!pos.length){ err("You must specify the type of resource to get. Use \"kubectl api-resources\" for a complete list of supported resources."); return 1; }
  const tipos = pos[0].includes("/") ? [pos[0]] : pos[0].split(",");
  if (tipos.length > 1 || pos[0] === "all"){
    const lista = pos[0] === "all" ? ["pods","services","daemonsets","deployments","replicasets","jobs","cronjobs","horizontalpodautoscalers"] : tipos;
    let alguno = false;
    for (const t of lista){
      const r = recurso(t); if (!r){ if (OTROS_RECURSOS.some(x => x.p === t || x.a.includes(t))) continue; err(`error: the server doesn't have a resource type "${t}"`); return 1; }
      const items = filtrar(r, listaObjetos(r.kind, ns, f.A), f); if (!items.length) continue;
      if (alguno) out("");
      alguno = true; pintarTabla(r, items, f, true);
    }
    if (!alguno){ out(f.A ? "No resources found" : `No resources found in ${ns} namespace.`); pistaNs(ns); }
    return 0;
  }
  const {r, tok, nombre: n1, resto} = tipoNombre(pos);
  if (!r){ const v = otroRecurso(tok, f, ns); if (v !== null) return v; err(`error: the server doesn't have a resource type "${tok}"`); return 1; }
  if (r.kind === "Event") return kEventos(f, ns);
  if (!r.cluster && !f.A && !compruebaNs(ns)) return 1;
  let items = listaObjetos(r.kind, ns, f.A || r.cluster);
  const nombres = [n1, ...(resto || [])].filter(Boolean);
  if (nombres.length){
    const enc = []; for (const n of nombres){ const x = items.find(i => nombreDe(r.kind, i) === n || (r.kind === "EndpointSlice" && i.metadata.name === n)); if (!x){ noExiste(r, n); if (!enc.length) pistaNs(ns); } else enc.push(x); }
    if (!enc.length) return 1; items = enc;
  }
  items = filtrar(r, items, f);
  if (f.o && /^(yaml|json|jsonpath|name|custom-columns)/.test(f.o)) return salidaFormateada(r, items, f, nombres.length === 1);
  if (!items.length){ out(f.A || r.cluster ? "No resources found" : `No resources found in ${ns} namespace.`); pistaNs(ns); return 0; }
  if (r.kind === "Endpoints") aviso("Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice");
  pintarTabla(r, items, f, false);
  if (f.w || f.watch) nota("(simulador: en el kubectl real «-w» se queda mirando cambios hasta Ctrl+C. Aquí: vuelve a lanzarlo, o «sleep 10» para hacer pasar el tiempo.)");
  return 0;
}
function filtrar(r, items, f){
  let res = items;
  if (f.l) { const sel = selectorLabels(f.l); res = res.filter(x => sel(labelsDe(r.kind, x))); }
  if (f["field-selector"]){
    for (const cond of String(f["field-selector"]).split(",")){
      const m = cond.match(/^([\w.]+)(!=|==|=)(.*)$/); if (!m) continue;
      const val = x => m[1] === "spec.nodeName" ? x.node : m[1] === "status.phase" ? x.fase : m[1] === "metadata.name" ? nombreDe(r.kind, x) : m[1] === "metadata.namespace" ? nsDe(r.kind, x) : undefined;
      res = res.filter(x => m[2] === "!=" ? val(x) !== m[3] : val(x) === m[3]);
    }
  }
  return res;
}
function pintarTabla(r, items, f, conTipo){
  const def = FILAS[r.kind]; if (!def){ out(items.map(x => nombreDe(r.kind, x)).join("\n")); return; }
  const wide = f.o === "wide";
  const cabL = [].concat(f.L || []).flatMap(x => String(x).split(",")).filter(Boolean);
  const nsCol = (f.A && !r.cluster);
  const cab = [...(nsCol ? ["NAMESPACE"] : []), ...def.cab, ...(wide && def.wide ? def.wide : []), ...cabL.map(l => l.split("/").pop().toUpperCase()), ...(f["show-labels"] ? ["LABELS"] : [])];
  const filas = items.sort((a, b) => (nsCol ? String(nsDe(r.kind, a)).localeCompare(nsDe(r.kind, b)) : 0) || String(nombreDe(r.kind, a)).localeCompare(nombreDe(r.kind, b))).map(x => {
    const fila = def.fila(x);
    if (conTipo) fila[0] = `${r.kind === "Service" ? "service" : r.plural.replace(/s$/, "").replace(/ie$/, "y")}${r.api.includes("/") ? "." + r.api.split("/")[0] : ""}/${fila[0]}`;
    return [...(nsCol ? [nsDe(r.kind, x)] : []), ...fila, ...(wide && def.filaW ? def.filaW(x) : []), ...cabL.map(l => labelsDe(r.kind, x)[l] || ""), ...(f["show-labels"] ? [etiquetasTxt(labelsDe(r.kind, x))] : [])];
  });
  out(tabla([cab, ...filas], f["no-headers"]));
}
function salidaFormateada(r, items, f, unico){
  items = items.slice().sort((a, b) => String(nsDe(r.kind, a) || "").localeCompare(String(nsDe(r.kind, b) || "")) || String(nombreDe(r.kind, a)).localeCompare(String(nombreDe(r.kind, b))));   // la API devuelve las listas ordenadas por namespace/nombre
  const objsK = items.map(x => r.kind === "Endpoints" ? endpointsObj(x) : r.kind === "EndpointSlice" ? endpointsObj(x) : aObjeto(r.kind, x));
  const o = String(f.o);
  if (o === "name"){ out(items.map(x => `${r.plural.replace(/s$/, "")}${r.api.includes("/") ? "." + r.api.split("/")[0] : ""}/${nombreDe(r.kind, x)}`).join("\n")); return 0; }
  const doc = unico ? objsK[0] : {apiVersion:"v1", kind:"List", items:objsK, metadata:{resourceVersion:""}};
  if (o === "yaml"){ out(yamlDump(doc)); return 0; }
  if (o === "json"){ out(JSON.stringify(doc, null, 4)); return 0; }
  if (o.startsWith("jsonpath")){
    const exp = o.replace(/^jsonpath(-as-json)?=?/, "");
    if (!exp){ err("error: template format specified but no template given"); return 1; }
    try { out(jsonpath(doc, exp)); } catch(e){ err(`error: error parsing jsonpath ${exp}, ${e.message}`); return 1; }
    return 0;
  }
  if (o.startsWith("custom-columns=")){
    const cols = o.slice(15).split(",").map(c => c.split(":"));
    out(tabla([cols.map(c => c[0]), ...objsK.map(ob => cols.map(c => { const v = jpEval(ob, c[1] || ""); return v.length ? v.map(jpFormatear).join(",") : "<none>"; }))]));
    return 0;
  }
  err(`error: unable to match a printer suitable for the output format "${o}", allowed formats are: custom-columns,go-template,json,jsonpath,name,wide,yaml`); return 1;
}
function endpointsObj(s){ const e = endpointsDe(s); const tp = (s.spec.ports[0] || {}).targetPort; return {apiVersion:"v1", kind:"Endpoints", metadata:{name:s.metadata.name, namespace:s.metadata.namespace}, subsets: e.length ? [{addresses:e.map(p => ({ip:p.ip, nodeName:p.node, targetRef:{kind:"Pod", name:p.name}})), ports:[{port:puertoContenedor(e[0], tp) || tp, protocol:"TCP"}]}] : undefined}; }

/* ---------- describe ---------- */
function kDescribe(pos, f, ns){
  const {r, tok, nombre, resto} = tipoNombre(pos);
  if (!r){ err(`error: the server doesn't have a resource type "${tok || ""}"`); return 1; }
  if (!r.cluster && !compruebaNs(ns)) return 1;
  let items = listaObjetos(r.kind, ns, r.cluster) || [];
  if (nombre){
    let x = items.find(i => nombreDe(r.kind, i) === nombre);
    if (!x) x = items.find(i => String(nombreDe(r.kind, i)).startsWith(nombre));      // kubectl describe busca por prefijo
    if (!x){ noExiste(r, nombre); pistaNs(ns); return 1; }
    items = [x];
  } else if (f.l){ items = filtrar(r, items, f); }
  if (!items.length){ out(`No resources found in ${ns} namespace.`); pistaNs(ns); return 0; }
  out(items.map(x => describir(r.kind, x)).join("\n\n\n"));
  return 0;
}

/* ---------- logs y eventos ---------- */
function podObjetivo(ref, ns, soloCorriendo){
  if (!ref) return null;
  const m = ref.match(/^(deploy|deployment|deployments|job|jobs|rs|replicaset|ds|daemonset|pod|pods|po)\/(.+)$/);
  if (m){
    const t = m[1], n = m[2];
    if (/^po/.test(t)) return S.pods.find(p => p.ns === ns && p.name === n);
    const cand = S.pods.filter(p => p.ns === ns && p.owner && (
      /^deploy/.test(t) ? p.owner.kind === "ReplicaSet" && p.owner.name.startsWith(n + "-") && S.rs.some(r => r.name === p.owner.name && r.dep === n) :
      /^job/.test(t) ? p.owner.kind === "Job" && p.owner.name === n : /^(rs|replicaset)/.test(t) ? p.owner.name === n : p.owner.kind === "DaemonSet" && p.owner.name === n));
    if (!cand.length) return {noPods:true, t, n};
    return (soloCorriendo ? cand.find(p => p.estado === "Running") : null) || cand.sort((a, b) => b.creado - a.creado)[0];
  }
  return S.pods.find(p => p.ns === ns && p.name === ref && !p.efimero);
}
function lineasLog(p){
  const pr = p.proc || {}; let l = (pr.lineas || []).slice();
  if (pr.bucle && pr.bucle.lineas.length){ const veces = Math.min(60, Math.floor((ahora() - p.arranque) / pr.bucle.periodo)); for (let k = 0; k < veces; k++) l = l.concat(pr.bucle.lineas); }
  return l;
}
function kLogs(pos, f, ns){
  if (!compruebaNs(ns)) return 1;
  if (!pos[0] && (f.l || f.selector)) return logsPorSelector(f, ns);
  const p = podObjetivo(pos[0], ns);
  if (!pos[0]){ err("error: expected 'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]'."); return 1; }
  if (!p){ err(`Error from server (NotFound): pods "${pos[0]}" not found`); pistaNs(ns); return 1; }
  if (p.noPods){ err(`error: no se encuentran Pods de ${p.t}/${p.n} en ${ns}`); return 1; }
  const c = p.spec.containers[0];
  const ic = f.c && (p.spec.initContainers || []).find(x => x.name === f.c);
  if (ic){ const l = (p.initLogs || {})[ic.name]; if (!l){ err(`Error from server (BadRequest): container "${ic.name}" in pod "${p.name}" is waiting to start: PodInitializing`); return 1; } if (l.length) out(l.join("\n")); return 0; }
  if (f.c && f.c !== c.name){ err(`error: container ${f.c} is not valid for pod ${p.name}`); nota(`   (contenedores: ${[...(p.spec.initContainers || []).map(x => x.name + " [init]"), c.name].join(", ")})`); return 1; }
  if (!f.c && /^Init:/.test(p.estado)){ err(`Error from server (BadRequest): container "${c.name}" in pod "${p.name}" is waiting to start: PodInitializing`); nota(`   (está en ${p.estado}: mira los logs del init container con  -c ${(p.spec.initContainers || [])[0].name})`); return 1; }
  const previo = f.previous || f.p;
  if (previo){
    if (!p.ultimo){ err(`Error from server (BadRequest): previous terminated container "${c.name}" in pod "${p.name}" not found`); return 1; }
    out(lineasLog(p).join("\n")); return 0;
  }
  if (!p.node || p.estado === "Pending" || p.estado === "ContainerCreating"){ err(`Error from server (BadRequest): container "${c.name}" in pod "${p.name}" is waiting to start: ContainerCreating`); return 1; }
  if (/ImagePull|ErrImage/.test(p.estado)){ err(`Error from server (BadRequest): container "${c.name}" in pod "${p.name}" is waiting to start: trying and failing to pull image`); return 1; }
  if (p.estado === "CreateContainerConfigError"){ err(`Error from server (BadRequest): container "${c.name}" in pod "${p.name}" is waiting to start: CreateContainerConfigError`); return 1; }
  let l = lineasLog(p);
  if (f.tail !== undefined) l = l.slice(-parseInt(f.tail, 10));
  if (l.length) out(l.join("\n"));
  if (f.f || f.follow) nota("(simulador: «-f» seguiría mostrando líneas nuevas hasta Ctrl+C)");
  return 0;
}
function kEventos(f, ns){
  if (!f.A && !compruebaNs(ns)) return 1;
  const filas = [];
  for (const e of S.eventos) if (f.A || e.ns === ns) filas.push({t:e.ultima, ns:e.ns, fila:[edad(e.ultima), e.tipo, e.motivo, e.objeto, e.msg]});
  for (const p of S.pods) if ((f.A || p.ns === ns) && p.ns !== "kube-system" && !p.efimero)
    for (const ev of eventosDePod(p)) filas.push({t:p.creado, ns:p.ns, fila:[ev[2], ev[0], ev[1], `pod/${p.name}`, ev[4]]});
  if (!filas.length){ out(`No events found in ${ns} namespace.`); return 0; }
  filas.sort((a, b) => a.t - b.t);
  out(tabla([[...(f.A ? ["NAMESPACE"] : []), "LAST SEEN","TYPE","REASON","OBJECT","MESSAGE"], ...filas.map(x => [...(f.A ? [x.ns] : []), ...x.fila])]));
  return 0;
}

/* ---------- create / expose / run ---------- */
function nombreContenedor(img){ const r = imagenInfo(img).repo || String(img); return r.split("/").pop().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "") || "app"; }
function plantillaBasica(nombre, imagen, cmd, extras){
  const c = {name:nombreContenedor(imagen), image:imagen};
  if (cmd && cmd.length) c.command = cmd;
  return Object.assign({metadata:{labels:{app:nombre}}, spec:{containers:[c]}}, extras || {});
}
function kCreate(pos, f, ns, tras){
  if (f.f) return kApply(pos, f, ns, true);
  const sub = pos[0], nombre = pos[1];
  if (sub === "service" || sub === "svc") return crearService(pos, f, ns);
  if (sub === "token") return crearToken(nombre, f, ns);
  const listaEsp = ["deployment","deploy","configmap","cm","secret","namespace","ns","job","cronjob","cj","serviceaccount","sa","role","rolebinding","clusterrole","clusterrolebinding","quota","resourcequota","service","svc","poddisruptionbudget","pdb"];
  if (!sub || !listaEsp.includes(sub)){ err(`error: must specify one of -f and -k\n\n(o un subcomando: ${listaEsp.filter((_, i) => i % 2 === 0).join(", ")})`); return 1; }
  if (sub === "namespace" || sub === "ns"){
    if (!nombre){ err("error: exactly one NAME is required, got 0"); return 1; }
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(nombre)){ err(`The Namespace "${nombre}" is invalid: metadata.name: Invalid value: "${nombre}": a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-'`); return 1; }
    if (S.ns[nombre]){ err(`Error from server (AlreadyExists): namespaces "${nombre}" already exists`); return 1; }
    crearNamespace(nombre); out(`namespace/${nombre} created`); return 0;
  }
  if (!compruebaNs(ns)) return 1;
  if (!nombre){ err("error: exactly one NAME is required, got 0"); return 1; }
  if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(nombre)){ err(`error: invalid name "${nombre}": must be lowercase alphanumeric characters, '-' or '.'`); return 1; }
  const existe = (kind, txt) => { if (obj(kind, ns, nombre)){ err(`error: failed to create ${txt}: ${recursoPorKind(kind).plural}${recursoPorKind(kind).api.includes("/") ? "." + recursoPorKind(kind).api.split("/")[0] : ""} "${nombre}" already exists`); return true; } return false; };
  const meta = (labels) => metaNueva(nombre, ns, {labels:labels || {}});
  switch (sub){
    case "deployment": case "deploy": {
      if (!f.image){ err("error: required flag(s) \"image\" not set"); return 1; }
      if (existe("Deployment", "deployment")) return 1;
      const tpl = plantillaBasica(nombre, f.image, tras);
      if (f.port) tpl.spec.containers[0].ports = [{containerPort:parseInt(f.port, 10)}];
      guardarObj({apiVersion:"apps/v1", kind:"Deployment", metadata:meta({app:nombre}), spec:{replicas:parseInt(f.replicas || "1", 10), selector:{matchLabels:{app:nombre}}, template:tpl}});
      out(`deployment.apps/${nombre} created`); return 0;
    }
    case "configmap": case "cm": {
      if (existe("ConfigMap", "configmap")) return 1;
      const data = {};
      for (const l of [].concat(f["from-literal"] || [])){ const m = String(l).match(/^([^=]+)=(.*)$/s); if (!m){ err(`error: invalid literal source ${l}, expected key=value`); return 1; } data[m[1]] = m[2]; }
      if (f["from-file"]){ aviso("(simulador) --from-file no está: usa --from-literal=CLAVE=valor"); return 1; }
      guardarObj({apiVersion:"v1", kind:"ConfigMap", metadata:meta(), data}); out(`configmap/${nombre} created`); return 0;
    }
    case "secret": {
      const tipo = pos[1], nom = pos[2];
      if (tipo !== "generic"){ err(tipo ? `(simulador) solo «kubectl create secret generic …»` : "error: Please specify the type of secret: generic | docker-registry | tls"); return 1; }
      if (!nom){ err("error: exactly one NAME is required, got 0"); return 1; }
      if (obj("Secret", ns, nom)){ err(`error: failed to create secret secrets "${nom}" already exists`); return 1; }
      const data = {};
      for (const l of [].concat(f["from-literal"] || [])){ const m = String(l).match(/^([^=]+)=(.*)$/s); if (!m){ err(`error: invalid literal source ${l}, expected key=value`); return 1; } data[m[1]] = b64e(m[2]); }
      guardarObj({apiVersion:"v1", kind:"Secret", type:"Opaque", metadata:metaNueva(nom, ns), data}); out(`secret/${nom} created`); return 0;
    }
    case "job": {
      if (!f.image && !f.from){ err("error: required flag(s) \"image\" not set"); return 1; }
      if (existe("Job", "job")) return 1;
      let tpl;
      if (f.from){ const m = String(f.from).match(/^(cronjob|cj)\/(.+)$/); const cj = m && obj("CronJob", ns, m[2]); if (!cj){ err(`error: from must be an existing cronjob: ${f.from}`); return 1; } tpl = copia(cj.spec.jobTemplate.spec.template); }
      else { tpl = {metadata:{}, spec:{restartPolicy:"Never", containers:[{name:nombre, image:f.image}]}}; if (tras.length) tpl.spec.containers[0].command = tras; }
      guardarObj({apiVersion:"batch/v1", kind:"Job", metadata:meta(), spec:{backoffLimit:6, completions:1, template:tpl}, status:{}});
      out(`job.batch/${nombre} created`); return 0;
    }
    case "cronjob": case "cj": {
      if (!f.image){ err("error: required flag(s) \"image\" not set"); return 1; }
      if (!f.schedule || f.schedule === true){ err("error: required flag(s) \"schedule\" not set"); return 1; }
      if (!cronValido(f.schedule)){ err(`The CronJob "${nombre}" is invalid: spec.schedule: Invalid value: "${f.schedule}": expected exactly 5 fields, found ${String(f.schedule).trim().split(/\s+/).length}: [${f.schedule}]`); return 1; }
      if (existe("CronJob", "cronjob")) return 1;
      const c = {name:nombre, image:f.image}; if (tras.length) c.command = tras;
      guardarObj({apiVersion:"batch/v1", kind:"CronJob", metadata:meta(), spec:{schedule:String(f.schedule), jobTemplate:{spec:{template:{metadata:{}, spec:{restartPolicy:"OnFailure", containers:[c]}}}}}});
      out(`cronjob.batch/${nombre} created`); return 0;
    }
    case "serviceaccount": case "sa":
      if (existe("ServiceAccount", "serviceaccount")) return 1;
      guardarObj({apiVersion:"v1", kind:"ServiceAccount", metadata:meta()}); out(`serviceaccount/${nombre} created`); return 0;
    case "role": {
      if (!f.verb || !f.resource){ err(`error: ${!f.verb ? "at least one verb must be specified" : "at least one resource must be specified"}`); return 1; }
      if (existe("Role", "role")) return 1;
      const verbs = String(f.verb).split(","), res = String(f.resource).split(",").map(x => { const r = recurso(x.split("/")[0]); return r ? r.plural + (x.includes("/") ? "/" + x.split("/")[1] : "") : x; });
      const malos = verbs.filter(v => !["get","list","watch","create","update","patch","delete","deletecollection","*"].includes(v));
      if (malos.length){ err(`error: invalid verb: '${malos[0]}'`); return 1; }
      const grupos = {}; for (const r of res){ const rr = recurso(r.split("/")[0]); const g = rr && rr.api.includes("/") ? rr.api.split("/")[0] : ""; (grupos[g] = grupos[g] || []).push(r); }
      guardarObj({apiVersion:"rbac.authorization.k8s.io/v1", kind:"Role", metadata:meta(), rules:Object.entries(grupos).map(([g, rs]) => ({apiGroups:[g], resources:rs, verbs}))});
      out(`role.rbac.authorization.k8s.io/${nombre} created`); return 0;
    }
    case "rolebinding": {
      if (!f.role && !f.clusterrole){ err("error: exactly one of clusterrole or role must be specified"); return 1; }
      if (f.role && f.clusterrole){ err("error: exactly one of clusterrole or role must be specified"); return 1; }
      if (existe("RoleBinding", "rolebinding")) return 1;
      const subjects = [];
      for (const sa of [].concat(f.serviceaccount || [])){ const m = String(sa).match(/^([^:]+):(.+)$/); if (!m){ err(`error: serviceaccount must be <namespace>:<name>`); return 1; } subjects.push({kind:"ServiceAccount", name:m[2], namespace:m[1]}); }
      for (const u of [].concat(f.user || [])) subjects.push({apiGroup:"rbac.authorization.k8s.io", kind:"User", name:String(u)});
      guardarObj({apiVersion:"rbac.authorization.k8s.io/v1", kind:"RoleBinding", metadata:meta(), roleRef:{apiGroup:"rbac.authorization.k8s.io", kind:f.role ? "Role" : "ClusterRole", name:String(f.role || f.clusterrole)}, subjects});
      out(`rolebinding.rbac.authorization.k8s.io/${nombre} created`); return 0;
    }
    case "quota": case "resourcequota": {
      if (existe("ResourceQuota", "quota")) return 1;
      const hard = {}; for (const h of String(f.hard || "").split(",").filter(Boolean)){ const [k, v] = h.split("="); hard[k] = v; }
      guardarObj({apiVersion:"v1", kind:"ResourceQuota", metadata:meta(), spec:{hard}}); out(`resourcequota/${nombre} created`); return 0;
    }
    case "poddisruptionbudget": case "pdb": {
      if (existe("PodDisruptionBudget", "poddisruptionbudget")) return 1;
      if (!f.selector && !f.l){ err("error: a selector must be specified"); return 1; }
      const ml = {}; for (const p of String(f.selector || f.l).split(",")){ const [k, v] = p.split("="); ml[k] = v; }
      const spec = {selector:{matchLabels:ml}}; if (f["min-available"] !== undefined) spec.minAvailable = /%$/.test(f["min-available"]) ? f["min-available"] : parseInt(f["min-available"], 10); if (f["max-unavailable"] !== undefined) spec.maxUnavailable = /%$/.test(f["max-unavailable"]) ? f["max-unavailable"] : parseInt(f["max-unavailable"], 10);
      guardarObj({apiVersion:"policy/v1", kind:"PodDisruptionBudget", metadata:meta(), spec}); out(`poddisruptionbudget.policy/${nombre} created`); return 0;
    }
    case "service": case "svc": aviso("(simulador) usa «kubectl expose deployment <nombre> --port=…» o «kubectl apply -f -»"); return 1;
    case "clusterrole": {
      if (!f.verb || !f.resource){ err(`error: ${!f.verb ? "at least one verb must be specified" : "at least one resource must be specified"}`); return 1; }
      if (CLUSTERROLES[nombre] || S.objs.some(o => o.kind === "ClusterRole" && o.metadata.name === nombre)){ err(`error: failed to create clusterrole: clusterroles.rbac.authorization.k8s.io "${nombre}" already exists`); return 1; }
      const verbs = String(f.verb).split(","), res = String(f.resource).split(",").map(x => { const r = recurso(x.split("/")[0]); return r ? r.plural + (x.includes("/") ? "/" + x.split("/")[1] : "") : x; });
      const malos = verbs.filter(v => !["get","list","watch","create","update","patch","delete","deletecollection","*"].includes(v)); if (malos.length){ err(`error: invalid verb: '${malos[0]}'`); return 1; }
      guardarObj({apiVersion:"rbac.authorization.k8s.io/v1", kind:"ClusterRole", metadata:{name:nombre}, rules:[{apiGroups:[""], resources:res, verbs}]});
      out(`clusterrole.rbac.authorization.k8s.io/${nombre} created`); return 0;
    }
    case "clusterrolebinding": {
      if (!f.clusterrole){ err("error: required flag(s) \"clusterrole\" not set"); return 1; }
      if (S.objs.some(o => o.kind === "ClusterRoleBinding" && o.metadata.name === nombre)){ err(`error: failed to create clusterrolebinding: clusterrolebindings.rbac.authorization.k8s.io "${nombre}" already exists`); return 1; }
      const subjects = [];
      for (const sa of [].concat(f.serviceaccount || [])){ const m = String(sa).match(/^([^:]+):(.+)$/); if (!m){ err("error: serviceaccount must be <namespace>:<name>"); return 1; } subjects.push({kind:"ServiceAccount", name:m[2], namespace:m[1]}); }
      guardarObj({apiVersion:"rbac.authorization.k8s.io/v1", kind:"ClusterRoleBinding", metadata:{name:nombre}, roleRef:{apiGroup:"rbac.authorization.k8s.io", kind:"ClusterRole", name:String(f.clusterrole)}, subjects});
      out(`clusterrolebinding.rbac.authorization.k8s.io/${nombre} created`); return 0;
    }
  }
  return 1;
}
function cronValido(s){ const p = String(s).trim().split(/\s+/); if (p.length !== 5) return false; return p.every(x => /^(\*|\d+|\d+-\d+|\*\/\d+|\d+(,\d+)+|[A-Za-z]{3})$/.test(x)); }
function kExpose(pos, f, ns){
  if (!compruebaNs(ns)) return 1;
  const {r, nombre} = tipoNombre(pos);
  if (!r || !nombre){ err("error: You must provide the resource to expose: kubectl expose deployment <nombre> --port=80"); return 1; }
  if (!["Deployment","Pod","Service"].includes(r.kind)){ err(`error: cannot expose a ${r.kind}`); return 1; }
  let sel;
  if (r.kind === "Deployment"){ const d = obj("Deployment", ns, nombre); if (!d){ noExiste(r, nombre); pistaNs(ns); return 1; } sel = copia(d.spec.selector.matchLabels); }
  else if (r.kind === "Pod"){ const p = S.pods.find(x => x.ns === ns && x.name === nombre); if (!p){ noExiste(r, nombre); return 1; } sel = copia(p.labels); delete sel["pod-template-hash"]; }
  else { const s = obj("Service", ns, nombre); if (!s){ noExiste(r, nombre); return 1; } sel = copia(s.spec.selector); }
  const sname = f.name || nombre;
  if (obj("Service", ns, sname)){ err(`Error from server (AlreadyExists): services "${sname}" already exists`); return 1; }
  if (!f.port){
    const d = r.kind === "Deployment" ? obj("Deployment", ns, nombre) : null;
    const cp = d && ((d.spec.template.spec.containers[0].ports || [])[0] || {}).containerPort;
    if (!cp){ err("error: couldn't find port via --port flag or introspection\nSee 'kubectl expose -h' for help and examples"); return 1; }
    f.port = cp;
  }
  const tipo = f.type || "ClusterIP";
  if (!["ClusterIP","NodePort","LoadBalancer"].includes(tipo)){ err(`error: invalid service type "${tipo}"`); return 1; }
  const tp = f["target-port"] !== undefined ? (/^\d+$/.test(f["target-port"]) ? parseInt(f["target-port"], 10) : f["target-port"]) : parseInt(f.port, 10);
  guardarObj({apiVersion:"v1", kind:"Service", metadata:metaNueva(sname, ns, {labels:{app:nombre}}), spec:{type:tipo, selector:sel, ports:[{port:parseInt(f.port, 10), protocol:"TCP", targetPort:tp}]}});
  out(`service/${sname} exposed`);
  if (tipo === "LoadBalancer") nota("(en AWS esto crea un balanceador real: unos 0,03 $/h mientras exista)");
  return 0;
}
function kRun(pos, f, ns, tras){
  const nombre = pos[0];
  if (!nombre){ err("error: NAME is required for run"); return 1; }
  if (!f.image){ err("error: required flag(s) \"image\" not set"); return 1; }
  if (!compruebaNs(ns)) return 1;
  const labels = {run:nombre}; for (const l of [].concat(f.labels || []).flatMap(x => String(x).split(","))){ const [k, v] = l.split("="); if (k) labels[k] = v; }
  const env = {}; for (const e of [].concat(f.env || [])){ const m = String(e).match(/^([^=]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
  const c = {name:nombre, image:f.image}; if (tras.length){ if (f.command) c.command = tras; else c.args = tras; }
  if (Object.keys(env).length) c.env = Object.entries(env).map(([k, v]) => ({name:k, value:v}));
  const plantilla = {metadata:{labels}, spec:{containers:[c], restartPolicy:f.restart || "Always"}};
  const errAd = admitir(ns, plantilla, nombre);
  if (errAd){ err(`Error from server (Forbidden): ${errAd}`); return 1; }
  if (f.rm || (f.i && f.t)){
    if (S.pods.some(p => p.ns === ns && p.name === nombre)){ err(`Error from server (AlreadyExists): pods "${nombre}" already exists`); return 1; }
    const inf = imagenInfo(f.image);
    if (!inf.ok){ err(`pod ${ns}/${nombre} terminated (ImagePullBackOff)\nerror: timed out waiting for the condition`); nota("(la imagen no existe: revisa nombre y tag)"); return 1; }
    const pod = {name:nombre, ns, labels, spec:copia(plantilla.spec), envSnap:env, efimero:true, proc:null, ip:"10.0.3.250"};
    const perf = perfil(c);
    const cmd = [...(c.command || []), ...(c.args || [])];
    if (!cmd.length || (cmd.length === 1 && ["sh","/bin/sh","ash"].includes(cmd[0]))){
      if (perf.tipo === "generico"){ aviso("(simulador) esa imagen no tiene shell: usa busybox:1.37"); return 1; }
      out("If you don't see a command prompt, try pressing enter.");
      MODO = {tipo:"pod", pod, ns, perf, efimero:f.rm, prompt:"/ # "}; JUEGO.cambioPrompt(); return 0;
    }
    if (perf.tipo === "generico" && !imagenInfo(f.image).sistema){ aviso("(simulador) para pruebas usa busybox:1.37"); }
    const r = ejecutarProceso(cmd, env, pod, ns, perf);
    if (r.fin === "starterror"){ err(`pod ${ns}/${nombre} terminated (StartError)\n${r.errorArranque}`); return 1; }
    if (r.lineas.length) out(r.lineas.join("\n"));
    if (r.fin === "corriendo") nota("(simulador: el comando se quedaría corriendo; en tu terminal real, Ctrl+C)");
    if (f.rm) out(`pod "${nombre}" deleted from ${ns} namespace`);
    if (r.fin === "sale" && r.codigo !== 0) err(`pod ${ns}/${nombre} terminated (Error)`);
    return r.codigo || 0;
  }
  if (obj("Pod", ns, nombre) || S.pods.some(p => p.ns === ns && p.name === nombre)){ err(`Error from server (AlreadyExists): pods "${nombre}" already exists`); return 1; }
  guardarObj({apiVersion:"v1", kind:"Pod", metadata:metaNueva(nombre, ns, {labels}), spec:plantilla.spec});
  out(`pod/${nombre} created`);
  return 0;
}

/* ---------- set / scale / autoscale ---------- */
function deploymentObjetivo(pos, ns){
  const {r, nombre, resto} = tipoNombre(pos);
  if (!r){ err(`error: the server doesn't have a resource type "${(pos[0] || "").split("/")[0]}"`); return {}; }
  if (r.kind !== "Deployment"){ err(`error: ${r.kind === "Pod" ? "los Pods de un Deployment se cambian en el Deployment (kubectl … deployment/<nombre>)" : `«${r.plural}» no está soportado aquí; usa deployment/<nombre>`}`); return {}; }
  if (!nombre){ err("error: resource name may not be empty   (ej: deployment/web)"); return {}; }
  if (!compruebaNs(ns)) return {};
  const d = obj("Deployment", ns, nombre); if (!d){ noExiste(r, nombre); pistaNs(ns); return {}; }
  return {d, resto};
}
function kSet(pos, f, ns){
  const sub = pos[0];
  if (sub === "image"){
    const {d, resto} = deploymentObjetivo(pos.slice(1), ns); if (!d) return 1;
    if (!resto.length){ err("error: at least one image update is required   (formato: <contenedor>=<imagen>)"); return 1; }
    let cambio = false;
    for (const asig of resto){
      const m = asig.match(/^([^=]+)=(.+)$/); if (!m){ err(`error: invalid argument: ${asig} (formato: <contenedor>=<imagen>)`); return 1; }
      const cs = d.spec.template.spec.containers.filter(c => m[1] === "*" || c.name === m[1]);
      if (!cs.length){ err(`error: unable to find container named "${m[1]}"`); nota(`   (los contenedores de ${d.metadata.name} son: ${d.spec.template.spec.containers.map(c => c.name).join(", ")})`); return 1; }
      for (const c of cs){ if (c.image !== m[2]){ c.image = m[2]; cambio = true; } }
    }
    out(`deployment.apps/${d.metadata.name} ${cambio ? "image updated" : "unchanged"}`); return 0;
  }
  if (sub === "env"){
    const {d, resto} = deploymentObjetivo(pos.slice(1), ns); if (!d) return 1;
    const c = d.spec.template.spec.containers[0];
    if (f.list){ out(`# deployments/${d.metadata.name}, container ${c.name}`); for (const e of c.env || []) out(e.valueFrom ? `# ${e.name} from ${e.valueFrom.configMapKeyRef ? "configmap " + e.valueFrom.configMapKeyRef.name : "secret " + e.valueFrom.secretKeyRef.name}, key ${(e.valueFrom.configMapKeyRef || e.valueFrom.secretKeyRef).key}` : `${e.name}=${e.value ?? ""}`); return 0; }
    if (!resto.length && !f.from){ err("error: at least one environment variable must be provided"); return 1; }
    c.env = c.env || [];
    for (const x of resto){
      let m;
      if ((m = x.match(/^([A-Za-z_][A-Za-z0-9_]*)-$/))){ c.env = c.env.filter(e => e.name !== m[1]); continue; }
      if ((m = x.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s))){ const e = c.env.find(z => z.name === m[1]); if (e){ delete e.valueFrom; e.value = m[2]; } else c.env.push({name:m[1], value:m[2]}); continue; }
      err(`error: envs must be of the form key=value or key-, got "${x}"`); return 1;
    }
    if (!c.env.length) delete c.env;
    out(`deployment.apps/${d.metadata.name} env updated`); return 0;
  }
  if (sub === "resources"){
    const {d} = deploymentObjetivo(pos.slice(1), ns); if (!d) return 1;
    if (!f.requests && !f.limits){ err("error: you must specify an update to requests or limits (in the form of --requests/--limits)"); return 1; }
    for (const c of d.spec.template.spec.containers.filter(c => !f.c || c.name === f.c)){
      c.resources = c.resources || {};
      for (const tipo of ["requests","limits"]) if (f[tipo]){
        c.resources[tipo] = c.resources[tipo] || {};
        for (const par of String(f[tipo]).split(",")){
          const [k, v] = par.split("=");
          if (!["cpu","memory","ephemeral-storage"].includes(k)){ err(`error: invalid resource name "${k}"`); return 1; }
          if (k === "cpu" ? isNaN(cpuM(v)) : isNaN(memMi(v))){ err(`error: quantities must match the regular expression '^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$'`); return 1; }
          if (v === "0" || v === "") delete c.resources[tipo][k]; else c.resources[tipo][k] = v;
        }
      }
      const rq = c.resources.requests || {}, lm = c.resources.limits || {};
      if (rq.memory && lm.memory && memMi(rq.memory) > memMi(lm.memory)){ err(`The Deployment "${d.metadata.name}" is invalid: spec.template.spec.containers[0].resources.requests: Invalid value: "${rq.memory}": must be less than or equal to memory limit of ${lm.memory}`); return 1; }
      if (rq.cpu && lm.cpu && cpuM(rq.cpu) > cpuM(lm.cpu)){ err(`The Deployment "${d.metadata.name}" is invalid: spec.template.spec.containers[0].resources.requests: Invalid value: "${rq.cpu}": must be less than or equal to cpu limit of ${lm.cpu}`); return 1; }
    }
    out(`deployment.apps/${d.metadata.name} resource requirements updated`); return 0;
  }
  if (sub === "selector"){
    const {r, nombre, resto} = tipoNombre(pos.slice(1));
    if (!r || r.kind !== "Service"){ err("error: (simulador) set selector: usa «kubectl set selector service <nombre> clave=valor»"); return 1; }
    if (!compruebaNs(ns)) return 1;
    const s = obj("Service", ns, nombre); if (!s){ noExiste(r, nombre); pistaNs(ns); return 1; }
    if (!resto.length){ err("error: selector must be specified"); return 1; }
    const sel = {}; for (const kv of resto.join(",").split(",")){ const [k, v] = kv.split("="); if (!k || v === undefined){ err(`error: invalid selector "${kv}"`); return 1; } sel[k] = v; }
    s.spec.selector = sel; out(`service/${nombre} selector updated`); return 0;
  }
  err(`error: unknown command "${sub || ""}" for "kubectl set"   (env, image, resources, selector)`); return 1;
}
function kScale(pos, f, ns){
  const {d} = deploymentObjetivo(pos, ns); if (!d) return 1;
  if (f.replicas === undefined || f.replicas === true || !/^\d+$/.test(String(f.replicas))){ err("error: required flag(s) \"replicas\" not set"); return 1; }
  const h = objs("HorizontalPodAutoscaler", ns).find(x => (x.spec.scaleTargetRef || {}).name === d.metadata.name);
  d.spec.replicas = parseInt(f.replicas, 10); out(`deployment.apps/${d.metadata.name} scaled`);
  if (h) nota(`(ojo: el HPA «${h.metadata.name}» manda sobre las réplicas: las devolverá a su rango ${h.spec.minReplicas || 1}-${h.spec.maxReplicas})`);
  return 0;
}
function kAutoscale(pos, f, ns){
  const {d} = deploymentObjetivo(pos, ns); if (!d) return 1;
  if (!f.max || !/^\d+$/.test(String(f.max))){ err("error: --max=MAXPODS is required and must be at least 1"); return 1; }
  let cpu = 80;
  if (f["cpu-percent"] !== undefined) cpu = parseInt(f["cpu-percent"], 10);
  else if (f.cpu !== undefined){ if (!/%$/.test(String(f.cpu))){ err("(simulador) --cpu admite porcentaje (p. ej. --cpu=50%)"); return 1; } cpu = parseInt(f.cpu, 10); }
  const nombre = f.name || d.metadata.name;
  if (obj("HorizontalPodAutoscaler", ns, nombre)){ err(`Error from server (AlreadyExists): horizontalpodautoscalers.autoscaling "${nombre}" already exists`); return 1; }
  const min = parseInt(f.min || "1", 10), max = parseInt(f.max, 10);
  if (min > max){ err(`error: --max=MAXPODS must be larger or equal to --min=MINPODS, max: ${max}, min: ${min}`); return 1; }
  guardarObj({apiVersion:"autoscaling/v2", kind:"HorizontalPodAutoscaler", metadata:metaNueva(nombre, ns), spec:{scaleTargetRef:{apiVersion:"apps/v1", kind:"Deployment", name:d.metadata.name}, minReplicas:min, maxReplicas:max, metrics:[{type:"Resource", resource:{name:"cpu", target:{type:"Utilization", averageUtilization:cpu}}}]}});
  out(`horizontalpodautoscaler.autoscaling/${nombre} autoscaled`); return 0;
}

/* ---------- rollout ---------- */
function kRollout(pos, f, ns){
  const sub = pos[0];
  if (!["status","history","undo","restart","pause","resume"].includes(sub)){ err(`error: unknown command "${sub || ""}" for "kubectl rollout"`); return 1; }
  const {d} = deploymentObjetivo(pos.slice(1), ns); if (!d) return 1;
  reconciliar();
  const n = d.metadata.name; const rss = rsDeDeployment(d).sort((a, b) => a.rev - b.rev);
  if (sub === "status"){
    const e = estadoDeployment(d); const R = d.spec.replicas ?? 1; const viejos = e.replicas - e.updatedReplicas;
    if (e.updatedReplicas >= R && e.actualizadosListos >= R && viejos <= 0){ out(`deployment "${n}" successfully rolled out`); return 0; }
    if (e.updatedReplicas < R) out(`Waiting for deployment "${n}" rollout to finish: ${e.updatedReplicas} out of ${R} new replicas have been updated...`);
    else if (viejos > 0) out(`Waiting for deployment "${n}" rollout to finish: ${viejos} old replicas are pending termination...`);
    else out(`Waiting for deployment "${n}" rollout to finish: ${e.actualizadosListos} of ${R} updated replicas are available...`);
    nota("(el kubectl real se queda esperando aquí hasta que termina o pasa el timeout; Ctrl+C para salir)");
    return 1;
  }
  if (sub === "history"){
    if (f.revision){ const r = rss.find(x => x.rev === parseInt(f.revision, 10)); if (!r){ err(`error: unable to find the specified revision`); return 1; }
      out(`deployment.apps/${n} with revision #${r.rev}\nPod Template:\n  Labels:\t${etiquetasTxt(Object.assign({}, r.tpl.metadata.labels, {"pod-template-hash":r.hash}))}${r.causa ? "\n  Annotations:\tkubernetes.io/change-cause: " + r.causa : ""}\n  Containers:\n   ${r.tpl.spec.containers[0].name}:\n    Image:\t${r.tpl.spec.containers[0].image}`); return 0; }
    out(`deployment.apps/${n} \n` + tabla([["REVISION","CHANGE-CAUSE"], ...rss.map(r => [r.rev, r.causa || "<none>"])])); return 0;
  }
  if (sub === "undo"){
    let destino;
    if (f["to-revision"] !== undefined && f["to-revision"] !== "0"){ destino = rss.find(r => r.rev === parseInt(f["to-revision"], 10)); if (!destino){ err(`error: unable to find specified revision ${f["to-revision"]} in history`); return 1; } }
    else { const ordenadas = rss.slice().sort((a, b) => b.rev - a.rev); destino = ordenadas[1]; if (!destino){ err(`error: no rollout history found for deployment "${n}"`); return 1; } }
    if (destino.hash === d._rsActual){ out(`deployment.apps/${n} skipped rollback (current template already matches revision ${destino.rev})`); return 0; }
    d.spec.template = copia(destino.tpl);
    if (destino.causa) d.metadata.annotations["kubernetes.io/change-cause"] = destino.causa; else delete d.metadata.annotations["kubernetes.io/change-cause"];
    out(`deployment.apps/${n} rolled back`); return 0;
  }
  if (sub === "restart"){
    d.spec.template.metadata = d.spec.template.metadata || {}; d.spec.template.metadata.annotations = d.spec.template.metadata.annotations || {};
    d.spec.template.metadata.annotations["kubectl.kubernetes.io/restartedAt"] = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    out(`deployment.apps/${n} restarted`); return 0;
  }
  if (sub === "pause"){ d.spec.paused = true; out(`deployment.apps/${n} paused`); return 0; }
  if (sub === "resume"){ delete d.spec.paused; out(`deployment.apps/${n} resumed`); return 0; }
}

/* ---------- edit / apply / patch ---------- */
const INMUTABLE = {Deployment:[["spec","selector"]], RoleBinding:[["roleRef"]], Job:[["spec","template"]], Service:[["spec","clusterIP"]]};
function validarObjeto(o, previo){
  const k = o.kind, md = o.metadata || {};
  if (!md.name) return "metadata.name: Required value: name or generateName is required";
  // un Pod suelto pasa la admisión (cuotas, Pod Security) en la propia API: se rechaza al crearlo, no después
  if (k === "Pod" && !previo){ const e = admitir(md.namespace, o, md.name); if (e) return `Error from server (Forbidden): error when creating "STDIN": ${e}`; }
  if (k === "Deployment" || k === "DaemonSet"){
    const sp = o.spec || {};
    if (!sp.selector || !sp.selector.matchLabels || !Object.keys(sp.selector.matchLabels).length) return `The ${k} "${md.name}" is invalid: spec.selector: Required value`;
    const tl = ((sp.template || {}).metadata || {}).labels || {};
    if (!selecciona(sp.selector, tl)) return `The ${k} "${md.name}" is invalid: spec.template.metadata.labels: Invalid value: ${JSON.stringify(tl)}: \`selector\` does not match template \`labels\``;
    const cs = ((sp.template || {}).spec || {}).containers;
    if (!Array.isArray(cs) || !cs.length) return `The ${k} "${md.name}" is invalid: spec.template.spec.containers: Required value`;
    for (const [i, c] of cs.entries()){
      if (!c || !c.name) return `The ${k} "${md.name}" is invalid: spec.template.spec.containers[${i}].name: Required value`;
      if (!c.image) return `The ${k} "${md.name}" is invalid: spec.template.spec.containers[${i}].image: Required value`;
      if (c.command && !Array.isArray(c.command)) return `error: error validating data: ValidationError(${k}.spec.template.spec.containers[${i}].command): invalid type for io.k8s.api.core.v1.Container.command: got "string", expected "array"`;
      if (c.ports && !Array.isArray(c.ports)) return `error: ValidationError(${k}.spec.template.spec.containers[${i}].ports): got "map", expected "array"`;
      for (const pr of ["livenessProbe","readinessProbe"]) if (c[pr] && c[pr].httpGet && c[pr].httpGet.port === undefined) return `The ${k} "${md.name}" is invalid: spec.template.spec.containers[${i}].${pr}.httpGet.port: Required value`;
    }
    if (sp.replicas !== undefined && !Number.isInteger(sp.replicas)) return `The request is invalid: spec.replicas: Invalid value: "${sp.replicas}": spec.replicas in body must be of type integer`;
  }
  if (k === "Service"){
    const sp = o.spec || {};
    if (!Array.isArray(sp.ports) || !sp.ports.length) return `The Service "${md.name}" is invalid: spec.ports: Required value`;
    for (const [i, p] of sp.ports.entries()) if (!Number.isInteger(p.port)) return `The Service "${md.name}" is invalid: spec.ports[${i}].port: Required value`;
    if (sp.type && !["ClusterIP","NodePort","LoadBalancer","ExternalName"].includes(sp.type)) return `The Service "${md.name}" is invalid: spec.type: Unsupported value: "${sp.type}": supported values: "ClusterIP", "ExternalName", "LoadBalancer", "NodePort"`;
  }
  if (k === "ConfigMap") for (const [kk, v] of Object.entries(o.data || {})) if (typeof v !== "string") return `error: unable to decode: json: cannot unmarshal ${typeof v === "number" ? "number" : "bool"} into Go struct field ConfigMap.data of type string   (pon el valor «${kk}» entre comillas)`;
  if (k === "Secret") for (const [kk, v] of Object.entries(o.data || {})) if (b64d(v) === null) return `error: unable to decode: illegal base64 data at input byte 0   (en «data» el valor de «${kk}» va en base64; para texto normal usa «stringData»)`;
  if (k === "HorizontalPodAutoscaler"){ if (!(o.spec || {}).scaleTargetRef) return `HorizontalPodAutoscaler.autoscaling "${md.name}" is invalid: spec.scaleTargetRef: Required value`; if (!(o.spec || {}).maxReplicas) return `HorizontalPodAutoscaler.autoscaling "${md.name}" is invalid: spec.maxReplicas: Required value`; }
  if (k === "CronJob"){ if (!(o.spec || {}).schedule || !cronValido(o.spec.schedule)) return `The CronJob "${md.name}" is invalid: spec.schedule: Invalid value: "${(o.spec || {}).schedule}"`; }
  if (k === "Job"){ const rp = (((o.spec || {}).template || {}).spec || {}).restartPolicy; if (!["Never","OnFailure"].includes(rp)) return `The Job "${md.name}" is invalid: spec.template.spec.restartPolicy: Required value: valid values: "OnFailure", "Never"`; }
  if (k === "PodDisruptionBudget"){ const sp = o.spec || {}; if (sp.minAvailable !== undefined && sp.maxUnavailable !== undefined) return `The PodDisruptionBudget "${md.name}" is invalid: spec: Invalid value: minAvailable and maxUnavailable cannot be both set`; }
  if (k === "RoleBinding" && !o.roleRef) return `The RoleBinding "${md.name}" is invalid: roleRef.name: Required value`;
  if (previo) for (const ruta of INMUTABLE[k] || []){
    const a = ruta.reduce((x, r) => x && x[r], previo), b = ruta.reduce((x, r) => x && x[r], o);
    if (b !== undefined && JSON.stringify(a) !== JSON.stringify(b)) return `The ${k} "${md.name}" is invalid: ${ruta.join(".")}: Invalid value: ${JSON.stringify(b)}: field is immutable`;
  }
  return null;
}
function normalizarEntrada(o, nsDefecto){
  o.metadata = o.metadata || {};
  if (o.kind === "Secret" && o.stringData){ o.data = o.data || {}; for (const [k, v] of Object.entries(o.stringData)) o.data[k] = b64e(String(v)); delete o.stringData; }
  if (o.kind === "Secret") o.type = o.type || "Opaque";
  const r = recursoPorKind(o.kind);
  if (r && !r.cluster) o.metadata.namespace = o.metadata.namespace || nsDefecto;
  if (o.kind === "HorizontalPodAutoscaler" && o.spec && o.spec.targetCPUUtilizationPercentage !== undefined && !o.spec.metrics){ o.spec.metrics = [{type:"Resource", resource:{name:"cpu", target:{type:"Utilization", averageUtilization:o.spec.targetCPUUtilizationPercentage}}}]; delete o.spec.targetCPUUtilizationPercentage; o.apiVersion = "autoscaling/v2"; }
  if (o.kind === "Deployment"){ o.spec = o.spec || {}; if (o.spec.replicas === undefined) o.spec.replicas = 1; }
  if (o.kind === "Job"){ o.spec = o.spec || {}; if (o.spec.backoffLimit === undefined) o.spec.backoffLimit = 6; o.status = {}; }
  return o;
}
function existente(kind, ns, name){
  if (kind === "Namespace") return S.ns[name] ? {kind:"Namespace", metadata:{name, labels:S.ns[name].labels}} : null;
  return obj(kind, ns, name);
}
function aplicarUno(o, nsDefecto, soloCrear){
  if (!o || typeof o !== "object" || !o.kind || !o.apiVersion){ err("error: error validating data: [apiVersion not set, kind not set]; if you choose to ignore these errors, turn validation off with --validate=false"); return false; }
  const r = recursoPorKind(o.kind);
  if (!r || !(KINDS_GUARDADOS.includes(o.kind) || o.kind === "Namespace")){ err(`error: resource mapping not found for name: "${(o.metadata || {}).name}" namespace: "" from "STDIN": no matches for kind "${o.kind}" in version "${o.apiVersion}"\nensure CRDs are installed first`); return false; }
  normalizarEntrada(o, nsDefecto);
  const ns = o.metadata.namespace, nombre = o.metadata.name;
  if (o.kind !== "Namespace" && !r.cluster && !S.ns[ns]){ err(`Error from server (NotFound): error when creating "STDIN": namespaces "${ns}" not found`); return false; }
  const previo = existente(o.kind, ns, nombre);
  if (previo && soloCrear){ err(`Error from server (AlreadyExists): error when creating "STDIN": ${r.plural}${r.api.includes("/") ? "." + r.api.split("/")[0] : ""} "${nombre}" already exists`); return false; }
  const e = validarObjeto(o, previo); if (e){ err(e); return false; }
  const tipoTxt = `${o.kind === "Service" ? "service" : r.plural.replace(/ies$/, "y").replace(/s$/, "")}${r.api.includes("/") ? "." + r.api.split("/")[0] : ""}/${nombre}`;
  if (o.kind === "Namespace"){
    if (previo){ const nuevas = Object.assign({"kubernetes.io/metadata.name":nombre}, o.metadata.labels || {}); const igual = JSON.stringify(nuevas) === JSON.stringify(S.ns[nombre].labels); S.ns[nombre].labels = nuevas; out(`namespace/${nombre} ${igual ? "unchanged" : "configured"}`); }
    else { crearNamespace(nombre, o.metadata.labels); out(`namespace/${nombre} created`); }
    return true;
  }
  if (previo){
    const limpio = x => { const c = copia(aObjeto(x.kind, x)); delete c.status; delete c.metadata.uid; delete c.metadata.creationTimestamp; delete (c.metadata.annotations || {})["deployment.kubernetes.io/revision"]; if (c.metadata.annotations && !Object.keys(c.metadata.annotations).length) delete c.metadata.annotations; if (c.metadata.labels && !Object.keys(c.metadata.labels).length) delete c.metadata.labels; return JSON.stringify(c); };
    const ocultas = {}; for (const [k, v] of Object.entries(previo.metadata.annotations || {})) if (k.startsWith("eks-quest/") || k === "deployment.kubernetes.io/revision") ocultas[k] = v;
    o.metadata.annotations = Object.assign({}, o.metadata.annotations || {}, ocultas);
    o.metadata.uid = previo.metadata.uid; o.metadata.creationTimestamp = previo.metadata.creationTimestamp;
    if (previo._rsActual) Object.defineProperty(o, "_rsActual", {value:previo._rsActual, enumerable:false, writable:true, configurable:true});
    if (previo._lbEn) Object.defineProperty(o, "_lbEn", {value:previo._lbEn, enumerable:false, writable:true});
    if (o.kind === "Service" && previo.spec.clusterIP) o.spec.clusterIP = previo.spec.clusterIP;
    if (o.kind === "Job") o.status = previo.status;
    const igual = limpio(previo) === limpio(Object.assign(copia(o), {kind:o.kind}));
    guardarObj(o); out(`${tipoTxt} ${igual ? "unchanged" : "configured"}`);
  } else { guardarObj(o); out(`${tipoTxt} created`); }
  return true;
}
function plantillaApply(ns){
  return `# kubectl apply -f -   →  escribe o pega tu YAML y pulsa «Guardar» (Ctrl+S). «Cancelar» (Esc) no aplica nada.
# Varios objetos: sepáralos con una línea que contenga solo ---
# Plantilla de ejemplo (cámbiala o bórrala):
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ejemplo
  namespace: ${ns}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ejemplo
  template:
    metadata:
      labels:
        app: ejemplo
    spec:
      containers:
      - name: ejemplo
        image: nginx:1.27-alpine
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 50m
            memory: 32Mi
---
apiVersion: v1
kind: Service
metadata:
  name: ejemplo
  namespace: ${ns}
spec:
  selector:
    app: ejemplo
  ports:
  - port: 80
    targetPort: 80
`;
}
function kApply(pos, f, ns, soloCrear){
  if (!f.f){ err("error: must specify one of -f and -k"); return 1; }
  if (f.f !== "-" && f.f !== true) nota(`(simulador) no hay ficheros: «-f ${f.f}» abre el editor para que pegues el YAML (igual que -f -)`);
  if (!f.n && !S.defNs && JUEGO.nivelNs()) ns = JUEGO.nivelNs();
  abrirEditor(plantillaApply(ns), texto => {
    let docs; try { docs = yamlParseTodos(texto); } catch(e){ err(`error: error parsing STDIN: error converting YAML to JSON: yaml: ${e.message}`); return; }
    if (!docs.length){ err("error: no objects passed to apply"); return; }
    for (const d of docs) aplicarUno(d, typeof f.n === "string" ? f.n : ns, soloCrear);
    reconciliar(); JUEGO.trasComando();
  }, `kubectl ${soloCrear ? "create" : "apply"} -f -  (escribe tu YAML)`);
  return 0;
}
function textoEdicion(o){
  const ob = copia(aObjeto(o.kind, o)); delete ob.status;
  return "# Please edit the object below. Lines beginning with a '#' will be ignored,\n# and an empty file will abort the edit. If an error occurs while saving this file will be\n# reopened with the relevant failures.\n#\n# (juego) Guardar: Ctrl+S   ·   Cancelar: Esc\n#\n" + yamlDump(ob) + "\n";
}
function kEdit(pos, f, ns){
  const {r, tok, nombre} = tipoNombre(pos);
  if (!r){ err(`error: the server doesn't have a resource type "${tok || ""}"`); return 1; }
  if (r.kind === "Pod"){
    const p = S.pods.find(x => x.ns === ns && x.name === nombre);
    aviso(`⚠️ No se edita el Pod: ${p && p.owner && p.owner.kind === "ReplicaSet" ? `lo gestiona el Deployment «${(S.rs.find(x => x.name === p.owner.name) || {}).dep}». Si cambiaras el Pod, al recrearse volvería a ser como dice el Deployment` : "casi todo el spec de un Pod es inmutable (solo la imagen, activeDeadlineSeconds y tolerations se pueden tocar)"}.\n   Edita el Deployment:  kubectl edit deployment ${p && p.owner ? (S.rs.find(x => x.name === p.owner.name) || {}).dep : "<nombre>"} -n ${ns}`);
    return 1;
  }
  if (r.kind === "Node"){ aviso("(simulador) para nodos usa kubectl label / taint / cordon"); return 1; }
  if (r.kind === "Namespace"){
    if (!S.ns[nombre]){ noExiste(r, nombre); return 1; }
    abrirEditor(yamlDump({apiVersion:"v1", kind:"Namespace", metadata:{name:nombre, labels:S.ns[nombre].labels}}) + "\n", texto => {
      let o; try { o = yamlParse(texto); } catch(e){ err(`error: ${e.message}`); return; }
      aplicarUno(o, null, false); reconciliar(); JUEGO.trasComando(); }, "kubectl edit namespace");
    return 0;
  }
  if (!KINDS_GUARDADOS.includes(r.kind)){ aviso(`(simulador) kubectl edit no está para ${r.plural}`); return 1; }
  if (!compruebaNs(ns)) return 1;
  if (!nombre){ err("error: (simulador) indica el nombre: kubectl edit <tipo> <nombre>"); return 1; }
  const o = obj(r.kind, ns, nombre); if (!o){ noExiste(r, nombre); pistaNs(ns); return 1; }
  const original = textoEdicion(o);
  abrirEditor(original, texto => {
    if (!texto.split("\n").some(l => l.trim() && !l.trim().startsWith("#"))){ out("Edit cancelled, no changes made."); return; }
    if (texto === original){ out("Edit cancelled, no changes made."); return; }
    let nuevo; try { nuevo = yamlParse(texto); } catch(e){ err(`error: ${r.plural} "${nombre}" is invalid\nerror: error parsing edited-file: yaml: ${e.message}`); nota("(el kubectl real reabriría el editor con el error arriba; aquí vuelve a lanzar kubectl edit)"); return; }
    if (!nuevo || nuevo.kind !== o.kind || !nuevo.metadata || nuevo.metadata.name !== nombre){ err(`error: At least one of apiVersion, kind and name was changed`); return; }
    nuevo.metadata.namespace = ns;
    const ant = CAPTURA; const salida = []; CAPTURA = salida;
    const ok = aplicarUno(nuevo, ns, false); CAPTURA = ant;
    if (ok){ const m = (salida[0] || "").match(/^(\S+) (unchanged|configured|created)/); out(m ? (m[2] === "unchanged" ? "Edit cancelled, no changes made." : `${m[1]} edited`) : salida.join("\n")); }
    else nota("(el kubectl real reabriría el editor con el error arriba; aquí vuelve a lanzar kubectl edit)");
    reconciliar(); JUEGO.trasComando();
  }, `kubectl edit ${r.plural.replace(/s$/, "")}/${nombre}`);
  return 0;
}
const CLAVES_LISTA = {containers:"name", initContainers:"name", env:"name", volumes:"name", volumeMounts:"mountPath", ports:null, tolerations:null};
function fusionEstrategica(dest, src, clave){
  if (src === null) return undefined;
  if (Array.isArray(src)){
    if (!Array.isArray(dest)) return copia(src);
    let k = CLAVES_LISTA[clave];
    if (clave === "ports") k = src.every(x => x && x.containerPort !== undefined) ? "containerPort" : src.every(x => x && x.port !== undefined) ? "port" : null;
    if (!k) return copia(src);
    const r = copia(dest);
    for (const it of src){ const i = r.findIndex(x => x && x[k] === it[k]); if (i >= 0) r[i] = fusionEstrategica(r[i], it, null); else r.push(copia(it)); }
    return r;
  }
  if (src && typeof src === "object"){
    const r = dest && typeof dest === "object" && !Array.isArray(dest) ? copia(dest) : {};
    for (const [k, v] of Object.entries(src)){ const x = fusionEstrategica(r[k], v, k); if (x === undefined) delete r[k]; else r[k] = x; }
    return r;
  }
  return src;
}
function fusionMerge(dest, src){
  if (src === null) return undefined;
  if (src && typeof src === "object" && !Array.isArray(src)){ const r = dest && typeof dest === "object" && !Array.isArray(dest) ? copia(dest) : {}; for (const [k, v] of Object.entries(src)){ const x = fusionMerge(r[k], v); if (x === undefined) delete r[k]; else r[k] = x; } return r; }
  return copia(src);
}
function parcheJSON(doc, ops){
  const r = copia(doc);
  for (const op of ops){
    if (!op.path || !op.op) throw new Error("cada operación necesita «op» y «path»");
    const partes = op.path.split("/").slice(1).map(p => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    let padre = r;
    for (const p of partes.slice(0, -1)){ if (padre[Array.isArray(padre) ? parseInt(p, 10) : p] === undefined){ if (op.op === "add") padre[p] = {}; else throw new Error(`doc is missing path: "${op.path}"`); } padre = padre[Array.isArray(padre) ? parseInt(p, 10) : p]; }
    const ult = partes[partes.length - 1];
    if (op.op === "replace"){ if (!(Array.isArray(padre) ? parseInt(ult, 10) < padre.length : ult in padre)) throw new Error(`replace operation does not apply: doc is missing key: ${op.path}`); padre[Array.isArray(padre) ? parseInt(ult, 10) : ult] = copia(op.value); }
    else if (op.op === "add"){ if (Array.isArray(padre)){ if (ult === "-") padre.push(copia(op.value)); else padre.splice(parseInt(ult, 10), 0, copia(op.value)); } else padre[ult] = copia(op.value); }
    else if (op.op === "remove"){ if (Array.isArray(padre)) padre.splice(parseInt(ult, 10), 1); else { if (!(ult in padre)) throw new Error(`remove operation does not apply: doc is missing path: "${op.path}"`); delete padre[ult]; } }
    else if (op.op === "test"){ if (JSON.stringify(padre[ult]) !== JSON.stringify(op.value)) throw new Error("testing value failed"); }
    else throw new Error(`Unexpected kind: ${op.op}`);
  }
  return r;
}
function kPatch(pos, f, ns){
  const {r, tok, nombre} = tipoNombre(pos);
  if (!r){ err(`error: the server doesn't have a resource type "${tok || ""}"`); return 1; }
  if (f.p === undefined || f.p === true){ err("error: must specify -p to patch\n\n(ej: kubectl patch deployment web -n <ns> -p '{\"spec\":{\"replicas\":3}}')"); return 1; }
  let parche; try { parche = JSON.parse(f.p); } catch(e){ err(`error: unable to parse "${f.p}": ${e.message}\n   (comillas simples por fuera y dobles por dentro: -p '{"spec":{"replicas":3}}')`); return 1; }
  if (r.kind === "Node"){
    const n = S.nodes.find(x => x.name === nombre); if (!n){ noExiste(r, nombre); return 1; }
    if (parche.spec && "unschedulable" in parche.spec) n.unsched = !!parche.spec.unschedulable;
    if (parche.metadata && parche.metadata.labels) for (const [k, v] of Object.entries(parche.metadata.labels)) if (v === null) delete n.extra[k]; else n.extra[k] = String(v);
    out(`node/${nombre} patched`); return 0;
  }
  if (!KINDS_GUARDADOS.includes(r.kind)){ aviso(`(simulador) patch no está para ${r.plural}`); return 1; }
  if (!compruebaNs(ns)) return 1;
  const o = obj(r.kind, ns, nombre); if (!o){ noExiste(r, nombre); pistaNs(ns); return 1; }
  const base = copia(aObjeto(o.kind, o)); delete base.status;
  let nuevo;
  try {
    if (f.type === "json"){ if (!Array.isArray(parche)){ err("error: unable to parse JSON patch: debe ser una lista de operaciones [{\"op\":…,\"path\":…}]"); return 1; } nuevo = parcheJSON(base, parche); }
    else if (f.type === "merge") nuevo = fusionMerge(base, parche);
    else nuevo = fusionEstrategica(base, parche, null);
  } catch(e){ err(`The request is invalid: the server rejected our request due to an error in our request: ${e.message}`); return 1; }
  const ant = CAPTURA; const salida = []; CAPTURA = salida;
  const ok = aplicarUno(nuevo, ns, false); CAPTURA = ant;
  if (!ok) return 1;
  const m = (salida[0] || "").match(/^(\S+) (unchanged|configured|created)/);
  out(m ? `${m[1]} ${m[2] === "unchanged" ? "patched (no change)" : "patched"}` : salida.join("\n"));
  return 0;
}

/* ---------- label / annotate / taint / cordon / drain ---------- */
function cambiosEtiquetas(destino, cambios, f, txtObj){
  for (const c of cambios){
    if (c.endsWith("-")){ delete destino[c.slice(0, -1)]; continue; }
    const m = c.match(/^([^=]+)=(.*)$/); if (!m){ err(`error: at least one label update is required   (formato: clave=valor o clave-)`); return false; }
    if (destino[m[1]] !== undefined && destino[m[1]] !== m[2] && !f.overwrite){ err(`error: '${m[1]}' already has a value (${destino[m[1]]}), and --overwrite is false`); return false; }
    if (!/^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/.test(m[2]) && m[2] !== ""){ err(`error: invalid label value: "${m[1]}=${m[2]}": a valid label must be an empty string or consist of alphanumeric characters, '-', '_' or '.'`); return false; }
    destino[m[1]] = m[2];
  }
  return true;
}
function kLabel(pos, f, ns){
  const {r, tok, nombre, resto} = tipoNombre(pos);
  if (!r){ err(`error: the server doesn't have a resource type "${tok || ""}"`); return 1; }
  let nombres = nombre ? [nombre] : [], cambios = resto || [];
  if (f.all && nombre && nombre.includes("=")){ cambios = [nombre, ...cambios]; nombres = []; }
  if (!cambios.length){ err("error: at least one label update is required"); return 1; }
  if (r.kind === "Node"){
    const ns_ = f.all ? S.nodes : nombres.map(n => S.nodes.find(x => x.name === n));
    if (ns_.some(x => !x)){ noExiste(r, nombres[ns_.findIndex(x => !x)]); return 1; }
    for (const n of ns_){ const base = etiquetasNodo(n); const prov = Object.assign({}, n.extra);
      for (const c of cambios){ const k = c.replace(/-$/, "").split("=")[0]; if (c.endsWith("-") && !(k in n.extra) && k in base){ err(`(simulador) la label «${k}» la pone EKS: no la quites`); return 1; } }
      if (!cambiosEtiquetas(prov, cambios, Object.assign({}, f, {overwrite:f.overwrite || false}))) return 1;
      for (const c of cambios){ const k = c.replace(/-$/, "").split("=")[0]; if (!c.endsWith("-") && base[k] !== undefined && !(k in n.extra) && base[k] !== prov[k] && !f.overwrite){ err(`error: '${k}' already has a value (${base[k]}), and --overwrite is false`); return 1; } }
      n.extra = prov; out(`node/${n.name} ${cambios.every(c => c.endsWith("-")) ? "unlabeled" : "labeled"}`); }
    return 0;
  }
  if (r.kind === "Namespace"){
    if (!S.ns[nombre]){ noExiste(r, nombre); return 1; }
    const l = Object.assign({}, S.ns[nombre].labels); if (!cambiosEtiquetas(l, cambios, f)) return 1; S.ns[nombre].labels = l; out(`namespace/${nombre} labeled`); return 0;
  }
  if (!compruebaNs(ns)) return 1;
  if (r.kind === "Pod"){
    const p = S.pods.find(x => x.ns === ns && x.name === nombre); if (!p){ noExiste(r, nombre); pistaNs(ns); return 1; }
    const l = Object.assign({}, p.labels); if (!cambiosEtiquetas(l, cambios, f)) return 1;
    p.labels = l;
    if (p.owner && p.owner.kind === "ReplicaSet"){ const rs = S.rs.find(x => x.name === p.owner.name); if (rs && !selecciona(Object.assign({}, (rs.tpl.metadata || {}).labels, {"pod-template-hash":rs.hash}), l)){ p.owner = null; p.huerfano = true; nota("(este Pod ya no coincide con su ReplicaSet: queda huérfano y el ReplicaSet crea otro para sustituirlo, como en un cluster real)"); } }
    out(`pod/${nombre} labeled`); return 0;
  }
  if (!KINDS_GUARDADOS.includes(r.kind)){ aviso(`(simulador) label no está para ${r.plural}`); return 1; }
  const o = obj(r.kind, ns, nombre); if (!o){ noExiste(r, nombre); pistaNs(ns); return 1; }
  const l = Object.assign({}, o.metadata.labels); if (!cambiosEtiquetas(l, cambios, f)) return 1; o.metadata.labels = l;
  out(`${r.kind === "Deployment" ? "deployment.apps" : r.plural.replace(/s$/, "")}/${nombre} labeled`);
  if (r.kind === "Deployment") nota("(ojo: esto etiqueta el objeto Deployment, no sus Pods. Las labels de los Pods están en spec.template.metadata.labels → kubectl edit)");
  return 0;
}
function kAnnotate(pos, f, ns){
  const {r, tok, nombre, resto} = tipoNombre(pos);
  if (!r){ err(`error: the server doesn't have a resource type "${tok || ""}"`); return 1; }
  if (!nombre){ err("error: one or more resources must be specified as <resource> <name> or <resource>/<name>"); return 1; }
  if (!(resto || []).length){ err("error: at least one annotation update is required"); return 1; }
  const g = Object.assign({}, f, {overwrite:f.overwrite || r.kind === "Deployment"});
  if (r.kind === "Pod"){
    const p = S.pods.find(x => x.ns === ns && x.name === nombre && !x.efimero); if (!p){ noExiste(r, nombre); pistaNs(ns); return 1; }
    const a = Object.assign({}, p.annotations); if (!cambiosEtiquetas(a, resto, g)) return 1; p.annotations = a;
    const o = obj("Pod", ns, nombre); if (o) o.metadata.annotations = Object.assign({}, a);
  } else if (r.kind === "Node"){
    const n = S.nodes.find(x => x.name === nombre); if (!n){ noExiste(r, nombre); return 1; }
    const a = Object.assign({}, n.anot || {}); if (!cambiosEtiquetas(a, resto, g)) return 1; n.anot = a;
  } else if (r.kind === "Namespace"){
    if (!S.ns[nombre]){ noExiste(r, nombre); return 1; }
    const a = Object.assign({}, S.ns[nombre].annotations || {}); if (!cambiosEtiquetas(a, resto, g)) return 1; S.ns[nombre].annotations = a;
  } else {
    const o = r.cluster ? S.objs.find(x => x.kind === r.kind && x.metadata.name === nombre) : obj(r.kind, ns, nombre);
    if (!o){ noExiste(r, nombre); pistaNs(ns); return 1; }
    const a = Object.assign({}, o.metadata.annotations); if (!cambiosEtiquetas(a, resto, g)) return 1; o.metadata.annotations = a;
  }
  out(`${r.kind === "Service" ? "service" : r.plural.replace(/ies$/, "y").replace(/s$/, "")}${r.api.includes("/") ? "." + r.api.split("/")[0] : ""}/${nombre} annotated`); return 0;
}
function kTaint(pos, f){
  const r = recurso(pos[0] || "");
  if (!r || r.kind !== "Node"){ err("error: (simulador) kubectl taint nodes <nodo>|--all clave=valor:Efecto"); return 1; }
  let nodos, cambios;
  if (f.all){ nodos = S.nodes; cambios = pos.slice(1); } else { const n = S.nodes.find(x => x.name === pos[1]); if (!n){ noExiste(r, pos[1] || ""); return 1; } nodos = [n]; cambios = pos.slice(2); }
  if (!cambios.length){ err("error: at least one taint update is required"); return 1; }
  for (const n of nodos){
    let quitado = false, puesto = false;
    for (const c of cambios){
      let m;
      if ((m = c.match(/^([^=:]+)(?:=([^:]*))?(?::(NoSchedule|PreferNoSchedule|NoExecute))?-$/))){
        const antes = n.taints.length; n.taints = n.taints.filter(t => !(t.key === m[1] && (!m[3] || t.effect === m[3])));
        if (n.taints.length === antes){ err(`error: taint "${m[1]}${m[3] ? ":" + m[3] : ""}" not found`); return 1; } quitado = true; continue;
      }
      if ((m = c.match(/^([^=:]+)(?:=([^:]*))?:(NoSchedule|PreferNoSchedule|NoExecute)$/))){
        const ex = n.taints.find(t => t.key === m[1] && t.effect === m[3]);
        if (ex && !f.overwrite){ err(`error: node ${n.name} already has ${m[1]} taint(s) with same effect(s) and --overwrite is false`); return 1; }
        n.taints = n.taints.filter(t => !(t.key === m[1] && t.effect === m[3])); n.taints.push({key:m[1], value:m[2], effect:m[3]}); puesto = true;
        if (m[3] === "NoExecute") for (const p of S.pods.filter(p => p.node === n.name && !esDS(p) && !tolera(p.spec.tolerations, {key:m[1], value:m[2], effect:"NoExecute"}))) S.pods = S.pods.filter(x => x !== p);
        continue;
      }
      err(`error: invalid taint spec: ${c}, unknown taint effect   (formato: clave=valor:NoSchedule  o  clave-)`); return 1;
    }
    out(`node/${n.name} ${puesto ? "tainted" : quitado ? "untainted" : "modified"}`);
  }
  return 0;
}
function kCordon(verbo, pos){
  const n = S.nodes.find(x => x.name === pos[0]);
  if (!pos[0]){ err(`error: USAGE: ${verbo} NODE [flags]`); return 1; }
  if (!n){ err(`Error from server (NotFound): nodes "${pos[0]}" not found`); return 1; }
  const quiero = verbo === "cordon";
  out(`node/${n.name} ${n.unsched === quiero ? "already " : ""}${quiero ? "cordoned" : "uncordoned"}`);
  n.unsched = quiero; return 0;
}
function kDrain(pos, f){
  const n = S.nodes.find(x => x.name === pos[0]);
  if (!pos[0]){ err("error: USAGE: drain NODE [flags]"); return 1; }
  if (!n){ err(`Error from server (NotFound): nodes "${pos[0]}" not found`); return 1; }
  out(`node/${n.name} ${n.unsched ? "already cordoned" : "cordoned"}`); n.unsched = true;
  const enNodo = () => S.pods.filter(p => p.node === n.name && !p.borrando && !["Succeeded","Failed"].includes(p.fase));
  const ds = enNodo().filter(esDS); const sueltos = enNodo().filter(p => !p.owner && !esDS(p));
  const conEmpty = enNodo().filter(p => (p.spec.volumes || []).some(v => v.emptyDir));
  const problemas = [];
  if (ds.length && !f["ignore-daemonsets"]) problemas.push(`cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): ${ds.map(p => p.ns + "/" + p.name).join(", ")}`);
  if (sueltos.length && !f.force) problemas.push(`cannot delete Pods that declare no controller (use --force to override): ${sueltos.map(p => p.ns + "/" + p.name).join(", ")}`);
  if (conEmpty.length && !f["delete-emptydir-data"]) problemas.push(`cannot delete Pods with local storage (use --delete-emptydir-data to override): ${conEmpty.map(p => p.ns + "/" + p.name).join(", ")}`);
  if (problemas.length){ err(`error: unable to drain node "${n.name}" due to error: ${problemas.join(", ")}, continuing command...\nThere are pending nodes to be drained:\n ${n.name}`); return 1; }
  if (ds.length) aviso(`Warning: ignoring DaemonSet-managed Pods: ${ds.map(p => p.ns + "/" + p.name).join(", ")}`);
  if (sueltos.length) aviso(`Warning: deleting Pods that declare no controller: ${sueltos.map(p => p.ns + "/" + p.name).join(", ")}`);
  let bloqueados = [];
  for (let vuelta = 0; vuelta < 30; vuelta++){
    const pend = enNodo().filter(p => !esDS(p)); if (!pend.length) break;
    let avance = false; bloqueados = [];
    for (const p of pend){
      const pdbs = objs("PodDisruptionBudget", p.ns).filter(b => selecciona((b.spec || {}).selector || {}, p.labels));
      if (pdbs.some(b => p.listo && estadoPDB(b).permitidas < 1)){ bloqueados.push(p); continue; }
      out(`evicting pod ${p.ns}/${p.name}`);
      S.pods = S.pods.filter(x => x !== p); if (!p.owner){ const o = obj("Pod", p.ns, p.name); if (o) borrarObjeto(o); }
      reconciliar(); avance = true;
    }
    if (!avance) break;
  }
  if (bloqueados.length){
    for (const p of bloqueados) err(`error when evicting pods/"${p.name}" -n "${p.ns}" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.`);
    nota("(el drain real se queda reintentando cada 5 s hasta que el PDB lo permita o pulses Ctrl+C. Aquí lo corto: el nodo queda cordoned.)");
    return 1;
  }
  for (const p of S.pods.filter(p => p.node === n.name && !esDS(p))) if (!p.borrando) out(`pod/${p.name} evicted`);
  out(`node/${n.name} drained`); return 0;
}

/* ---------- delete ---------- */
function kDelete(pos, f, ns){
  if (f.f){ aviso("(simulador) delete -f no está: borra por tipo y nombre"); return 1; }
  const {r, tok, nombre, resto} = tipoNombre(pos);
  if (!r){ err(pos.length ? `error: the server doesn't have a resource type "${tok}"` : "error: You must provide one or more resources by argument or filename."); return 1; }
  const nombres = [nombre, ...(resto || [])].filter(Boolean);
  if (r.kind === "Namespace"){
    for (const n of nombres){
      if (["default","kube-system","kube-public","kube-node-lease"].includes(n)){ err(`Error from server (Forbidden): namespaces "${n}" is forbidden: this namespace may not be deleted`); continue; }
      if (!S.ns[n]){ noExiste(r, n); continue; }
      borrarNamespace(n); out(`namespace "${n}" deleted`);
    }
    return 0;
  }
  if (r.kind === "Node"){ aviso("(simulador) borrar el objeto Node no apaga la EC2: el kubelet lo vuelve a registrar.\n   En EKS un nodo se quita con: kubectl drain → aws ec2 terminate-instances (o bajando el node group)."); return 1; }
  if (!compruebaNs(ns)) return 1;
  if (!nombres.length && !f.all && !f.l){ err("error: resource(s) were provided, but no name was specified"); return 1; }
  if (r.kind === "Pod"){
    let lista = f.all ? S.pods.filter(p => p.ns === ns) : f.l ? S.pods.filter(p => p.ns === ns && selectorLabels(f.l)(p.labels)) : nombres.map(n => S.pods.find(p => p.ns === ns && p.name === n && !p.efimero) || n);
    for (const p of lista){
      if (typeof p === "string"){ noExiste(r, p); pistaNs(ns); continue; }
      S.pods = S.pods.filter(x => x !== p); out(`pod "${p.name}" deleted from ${ns} namespace`);
      if (!p.owner){ const o = obj("Pod", ns, p.name); if (o) borrarObjeto(o); if (!p.huerfano) nota("(era un Pod suelto: nadie lo recrea)"); }
    }
    if (lista.some(p => typeof p !== "string" && p.owner)) nota("(su controlador creará otro igual: manda el estado deseado)");
    return 0;
  }
  if (!KINDS_GUARDADOS.includes(r.kind)){ aviso(`(simulador) delete no está para ${r.plural}`); return 1; }
  if (r.cluster){
    if (r.kind === "ClusterRole" && nombres.some(n => CLUSTERROLES[n])){ err("(simulador) los ClusterRoles predefinidos (view, edit, admin, cluster-admin) no se borran"); return 1; }
    for (const n of nombres){ const o = S.objs.find(x => x.kind === r.kind && x.metadata.name === n); if (!o){ noExiste(r, n); continue; } borrarObjeto(o); out(`${r.plural.replace(/s$/, "")}.rbac.authorization.k8s.io "${n}" deleted`); }
    return 0;
  }
  const lista = f.all ? objs(r.kind, ns) : f.l ? objs(r.kind, ns).filter(o => selectorLabels(f.l)(o.metadata.labels || {})) : nombres;
  if (!lista.length){ out("No resources found"); return 0; }
  for (const x of lista){
    const o = typeof x === "string" ? obj(r.kind, ns, x) : x;
    if (!o){ noExiste(r, x); pistaNs(ns); continue; }
    borrarObjeto(o);
    out(`${r.kind === "Service" ? "service" : r.plural.replace(/ies$/, "y").replace(/s$/, "")}${r.api.includes("/") ? "." + r.api.split("/")[0] : ""} "${o.metadata.name}" deleted from ${ns} namespace`);
    JUEGO.alBorrar(o);
  }
  return 0;
}

/* ---------- exec / port-forward / curl ---------- */
function kExec(pos, f, ns, tras){
  if (!pos.length){ err("error: expected 'exec (POD | TYPE/NAME) [-c CONTAINER] [flags] -- COMMAND [args...]'"); return 1; }
  if (pos.length > 1 && !tras.length){ err("error: exec [POD] [COMMAND] is not supported anymore. Use exec [POD] -- [COMMAND] instead\nSee 'kubectl exec -h' for help and examples"); return 1; }
  if (!compruebaNs(ns)) return 1;
  const p = podObjetivo(pos[0], ns, true);
  if (!p){ err(`Error from server (NotFound): pods "${pos[0]}" not found`); pistaNs(ns); return 1; }
  if (p.noPods){ err(`error: no se encuentran Pods de ${p.t}/${p.n}`); return 1; }
  if (!tras.length){ err(`error: you must specify at least one command for the container\n   (ej: kubectl exec ${p.name} -n ${ns} -- env   ·   shell: kubectl exec -it ${p.name} -n ${ns} -- sh)`); return 1; }
  if (p.estado !== "Running"){ err(`error: unable to upgrade connection: container not found ("${p.spec.containers[0].name}")   — el Pod está en ${p.estado}`); return 1; }
  if (f.c && f.c !== true && !p.spec.containers.some(c => c.name === f.c)){ err(`error: container ${f.c} not found in pod ${p.name}`); nota(`   (contenedores: ${p.spec.containers.map(c => c.name).join(", ")})`); return 1; }
  const perf = perfil(p.spec.containers[0]);
  if (perf.tipo === "generico" || perf.tipo === "sistema"){
    err(`error: Internal error occurred: error executing command in container: failed to exec in container: OCI runtime exec failed: exec failed: unable to start container process: exec: "${tras[0]}": executable file not found in $PATH: unknown`);
    nota("   (esta imagen no trae shell ni utilidades. Para mirar dentro: kubectl debug -it <pod> --image=busybox:1.37 --target=<contenedor>)"); return 126;
  }
  if (tras.length === 1 && ["sh","/bin/sh","ash","bash","/bin/bash"].includes(tras[0])){
    if (perf.tipo === "generico" || perf.tipo === "sistema"){ err(`error: Internal error occurred: error executing command in container: failed to exec in container: OCI runtime exec failed: exec failed: unable to start container process: exec: "${tras[0]}": executable file not found in $PATH: unknown`); return 126; }
    if (tras[0].includes("bash")){ err(`error: Internal error occurred: error executing command in container: failed to exec in container: OCI runtime exec failed: exec failed: unable to start container process: exec: "bash": executable file not found in $PATH: unknown`); nota("(las imágenes alpine/busybox traen «sh», no «bash»)"); return 126; }
    if (!(f.i && f.t) && !f.it) aviso("(sin -it, una shell no sería interactiva; el juego te la abre igualmente)");
    MODO = {tipo:"pod", pod:p, ns, perf, prompt:perf.tipo === "web" ? `${p.name}:/# ` : "/ # "}; JUEGO.cambioPrompt(); return 0;
  }
  const r = ejecutarProceso(tras, p.envSnap || {}, p, ns, perf);
  if (r.fin === "starterror"){ err(`error: Internal error occurred: error executing command in container: failed to exec in container: OCI runtime exec failed: exec failed: unable to start container process: ${r.errorArranque.replace(/^.*?exec:/, "exec:")}`); return 126; }
  if (r.lineas.length) out(r.lineas.join("\n"));
  if (r.fin === "corriendo") nota("(simulador: el comando seguiría corriendo; en el real, Ctrl+C)");
  if (r.codigo) err(`command terminated with exit code ${r.codigo}`);
  return r.codigo;
}
function kDebug(pos, f, ns, tras){
  const ref = pos[0] || "";
  if (!ref){ err("error: (simulador) kubectl debug -it <pod> --image=busybox:1.37 --target=<contenedor>   ·   kubectl debug node/<nodo> -it --image=busybox:1.37"); return 1; }
  if (!f.image || f.image === true){ err("error: --image is required when not using --copy-to (o un perfil)"); return 1; }
  if (f["copy-to"]){ aviso("(simulador) --copy-to no está: usa el contenedor efímero con --target"); return 1; }
  if (/^(node|nodes|no)\//.test(ref)){
    const n = S.nodes.find(x => x.name === ref.split("/")[1]); if (!n){ err(`Error from server (NotFound): nodes "${ref.split("/")[1]}" not found`); return 1; }
    out(`Creating debugging pod node-debugger-${n.name.split(".")[0]}-${sufijo(5)} with container debugger on node ${n.name}.\nIf you don't see a command prompt, try pressing enter.`);
    nota("(el sistema de ficheros del nodo está en /host: en el real harías  chroot /host. Aquí: systemctl status kubelet · journalctl -u kubelet · crictl ps · exit)");
    MODO = {tipo:"nodo", id:n.id, sesion:"debug", prompt:"root@" + n.name.split(".")[0] + ":/# "}; JUEGO.cambioPrompt(); return 0;
  }
  if (!compruebaNs(ns)) return 1;
  const p = podObjetivo(ref.replace(/^pods?\//, ""), ns, true);
  if (!p || p.noPods){ err(`Error from server (NotFound): pods "${ref}" not found`); pistaNs(ns); return 1; }
  if (p.estado !== "Running"){ err(`error: el Pod ${p.name} no está Running (${p.estado}): los contenedores efímeros necesitan un Pod en marcha`); return 1; }
  const inf = imagenInfo(f.image); if (!inf.ok){ err(`(el contenedor efímero no arranca: ErrImagePull de "${f.image}")`); return 1; }
  const perf = perfil({image:f.image});
  if (perf.tipo !== "shell" && perf.tipo !== "web"){ aviso("(simulador) usa una imagen con shell para depurar: --image=busybox:1.37"); return 1; }
  if (f.target && f.target !== p.spec.containers[0].name){ err(`error: (el Pod ${p.name} no tiene un contenedor llamado "${f.target}"; tiene: ${p.spec.containers.map(c => c.name).join(", ")})`); return 1; }
  const nombreD = `debugger-${sufijo(5)}`;
  out(`Defaulting debug container name to ${nombreD}.`);
  if (f.target) out(`Targeting container "${f.target}". If you don't see processes from this container it may be because the container runtime doesn't support this feature.`);
  const modo = {tipo:"pod", pod:p, ns, perf, debug:true, imagen:f.image, objetivo:f.target ? p : null, prompt:"/ # "};
  if (tras.length && !(tras.length === 1 && ["sh","/bin/sh"].includes(tras[0]))){
    const anterior = MODO; MODO = modo; lineaEnShell(tras.map(x => /\s/.test(x) ? `"${x}"` : x).join(" ")); MODO = anterior; JUEGO.cambioPrompt(); return 0;
  }
  out("If you don't see a command prompt, try pressing enter.");
  if (!f.target) nota("(sin --target no ves los procesos del contenedor que quieres depurar: compartes red y Pod, pero no su espacio de procesos)");
  MODO = modo; JUEGO.cambioPrompt(); return 0;
}
function lineaEnShell(linea){
  pintarSalida((MODO.prompt || "$ ") + linea, "c-cian-sin-prompt");
  if (["exit","logout"].includes(linea.trim())){
    if (MODO.tipo === "pod" && MODO.efimero) out(`pod "${MODO.pod.name}" deleted from ${MODO.ns} namespace`);
    if (MODO.tipo === "nodo" && MODO.sesion === "debug") nota("(el Pod node-debugger-… se queda en Completed: en un cluster real, bórralo con kubectl delete pod)");
    else if (MODO.tipo === "nodo") out(`\n\nExiting session with sessionId: ${MODO.sesion}.`);
    MODO = null; JUEGO.cambioPrompt(); return;
  }
  if (MODO.tipo === "nodo") return comandoNodo(linea);
  const ctx = {env:Object.assign({}, MODO.debug ? {} : (MODO.pod.envSnap || {})), lineas:[], ns:MODO.ns, pod:MODO.pod.efimero ? Object.assign({}, MODO.pod) : MODO.pod, perfil:MODO.perf, hostname:MODO.pod.name, cmdPrincipal:"sh",
               debug:!!MODO.debug, c:MODO.debug ? {name:"debugger", image:MODO.imagen} : (MODO.pod.spec ? MODO.pod.spec.containers[0] : null),
               objetivo:MODO.debug ? (MODO.objetivo || null) : (MODO.pod.efimero ? null : MODO.pod)};
  ctx.out = t => ctx.lineas.push(String(t));
  try {
    const nodos = analizarScript(linea);
    ejecutarNodos(nodos, ctx);
  } catch(e){
    if (e instanceof Bloqueo) ctx.lineas.push("(simulador: se quedaría esperando; aquí lo cortamos)");
    else if (e instanceof Salida){ ctx.lineas.forEach(l => out(l)); MODO = null; JUEGO.cambioPrompt(); return; }
    else ctx.lineas.push(`sh: ${e.message}`);
  }
  if (ctx.lineas.length) out(ctx.lineas.join("\n"));
  reconciliar(); JUEGO.trasComando();
}
function comandoNodo(linea){
  const n = S.nodes.find(x => x.id === MODO.id);
  const a = trocear(linea.replace(/^sudo\s+/, "")); const c = a.join(" ");
  if (!n){ err("Connection closed: la instancia ya no existe"); MODO = null; JUEGO.cambioPrompt(); return; }
  if (/^systemctl (status|is-active) kubelet/.test(c)){
    out(n.roto ? `○ kubelet.service - Kubernetes Kubelet\n     Loaded: loaded (/etc/systemd/system/kubelet.service; enabled; preset: disabled)\n     Active: inactive (dead) since ${new Date(Date.now() - (ahora() - n.rotoDesde) * 1000).toUTCString()}` : `● kubelet.service - Kubernetes Kubelet\n     Loaded: loaded (/etc/systemd/system/kubelet.service; enabled; preset: disabled)\n     Active: active (running) since ${new Date(Date.now() - (ahora() - n.creado) * 1000).toUTCString()}\n   Main PID: 2417 (kubelet)`); return;
  }
  if (/^systemctl (start|restart) kubelet/.test(c)){ n.roto = false; n.ready = true; nota("(kubelet arrancado: el nodo volverá a Ready. En EKS lo habitual con un nodo dañado es reemplazarlo, que es lo que pide el nivel.)"); reconciliar(); JUEGO.trasComando(); return; }
  if (/^systemctl stop kubelet/.test(c)){ n.roto = true; n.ready = false; n.rotoDesde = ahora(); nota("(kubelet parado: en ~40 s el nodo saldrá NotReady)"); reconciliar(); return; }
  if (/^journalctl/.test(c)){ out(n.roto ? `${new Date().toUTCString()} ${n.name.split(".")[0]} systemd[1]: Stopping kubelet.service - Kubernetes Kubelet...\n${new Date().toUTCString()} ${n.name.split(".")[0]} systemd[1]: kubelet.service: Deactivated successfully.\n${new Date().toUTCString()} ${n.name.split(".")[0]} systemd[1]: Stopped kubelet.service - Kubernetes Kubelet.` : `I1127 kubelet.go:2475] "SyncLoop (PLEG): event for pod"\nI1127 kubelet_node_status.go:75] "Successfully registered node" node="${n.name}"`); return; }
  if (/^crictl (ps|pods)/.test(c)){ const ps = S.pods.filter(p => p.node === n.name); out(tabla([["CONTAINER","IMAGE","CREATED","STATE","NAME","POD"], ...ps.map(p => [hash(p.uid).toString(16).slice(0,13), p.spec.containers[0].image.split("/").pop(), edad(p.creado) + " ago", p.estado === "Running" ? "Running" : "Exited", p.spec.containers[0].name, p.name])])); return; }
  if (/^(hostname)$/.test(c)){ out(n.name); return; }
  if (/^free/.test(c)){ out("               total        used        free      shared  buff/cache   available\nMem:            3835         812        1520           1        1502        2795\nSwap:              0           0           0"); return; }
  if (/^df/.test(c)){ out("Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1   20G  4.1G   16G  21% /"); return; }
  if (/^cat \/etc\/os-release/.test(c)){ out('NAME="Amazon Linux"\nVERSION="2023"\nPRETTY_NAME="Amazon Linux 2023.12.20261118"'); return; }
  if (/^(ls|pwd|whoami|id)/.test(c)){ out(c.startsWith("whoami") ? "ssm-user" : c.startsWith("id") ? "uid=1001(ssm-user) gid=1001(ssm-user) groups=1001(ssm-user)" : c.startsWith("pwd") ? "/usr/bin" : ""); return; }
  err(`sh: ${a[0]}: (simulador) en el nodo: systemctl status|start|stop kubelet · journalctl -u kubelet · crictl ps · free -m · df -h · exit`);
}
function kPortForward(pos, f, ns){
  if (!compruebaNs(ns)) return 1;
  const ref = pos[0] || "", puertos = pos.slice(1);
  if (!ref || !puertos.length){ err("error: TYPE/NAME and list of ports are required for port-forward\n   (ej: kubectl port-forward svc/web 8080:80 -n <ns>)"); return 1; }
  const [t, n] = ref.includes("/") ? ref.split("/") : ["pod", ref];
  const r = recurso(t); if (!r){ err(`error: the server doesn't have a resource type "${t}"`); return 1; }
  const [loc, rem] = puertos[0].includes(":") ? puertos[0].split(":") : [puertos[0], puertos[0]];
  let pod, remoto = parseInt(rem || loc, 10);
  if (r.kind === "Service"){
    const s = obj("Service", ns, n); if (!s){ noExiste(r, n); pistaNs(ns); return 1; }
    const sp = s.spec.ports.find(x => x.port === remoto || String(x.name) === rem); if (!sp){ err(`error: Service ${n} does not have a service port ${rem}`); return 1; }
    const eps = endpointsDe(s); if (!eps.length){ err(`error: unable to forward port because pod is not running. Current status=${(S.pods.find(p => p.ns === ns && selecciona(s.spec.selector, p.labels)) || {}).estado || "no hay Pods que casen con el selector"}`); return 1; }
    pod = eps[0]; remoto = puertoContenedor(pod, sp.targetPort);
  } else if (r.kind === "Pod"){ pod = S.pods.find(p => p.ns === ns && p.name === n); if (!pod){ noExiste(r, n); pistaNs(ns); return 1; } }
  else if (r.kind === "Deployment"){ pod = podObjetivo(`deploy/${n}`, ns, true); if (!pod || pod.noPods){ err(`error: no hay Pods de deployment/${n}`); return 1; } }
  else { err("error: port-forward admite svc/, pod/ y deployment/"); return 1; }
  if (pod.estado !== "Running"){ err(`error: unable to forward port because pod is not running. Current status=${pod.estado}`); return 1; }
  S.pf[loc] = {ns, pod:pod.name, remoto};
  out(`Forwarding from 127.0.0.1:${loc} -> ${remoto}\nForwarding from [::1]:${loc} -> ${remoto}`);
  nota(`(simulador: queda activo en segundo plano. Pruébalo con:  curl http://localhost:${loc}\n  En tu terminal real este comando se queda «colgado»: abre otra terminal para el curl, o añade & al final.)`);
  return 0;
}
function curlLocal(prog, args){
  const url = args.filter(x => !x.startsWith("-") && !/^\d+$/.test(x))[0];
  if (!url){ err(prog === "curl" ? "curl: try 'curl --help' for more information" : "wget: missing URL"); return 2; }
  const u = analizarURL(url); if (!u){ err(`curl: (3) URL rejected: Malformed input to a URL function`); return 3; }
  if (u.host === "localhost" || u.host === "127.0.0.1"){
    const pf = S.pf[u.puerto];
    if (!pf){ err(`curl: (7) Failed to connect to localhost port ${u.puerto} after 0 ms: Couldn't connect to server`); nota("   (¿falta el kubectl port-forward? Mira «kubectl port-forward -h»)"); return 7; }
    const p = S.pods.find(x => x.ns === pf.ns && x.name === pf.pod);
    if (!p || p.estado !== "Running"){ err("curl: (52) Empty reply from server"); nota(`(el port-forward se ha roto: el Pod ${pf.pod} ya no existe o no corre. Vuelve a lanzarlo)`); delete S.pf[u.puerto]; return 52; }
    if (!p.proc || p.proc.escucha !== pf.remoto){ err("curl: (52) Empty reply from server"); aviso(`Handling connection for ${u.puerto}\nE1127 portforward.go:424] "Unhandled Error" err="an error occurred forwarding ${u.puerto} -> ${pf.remoto}: error forwarding port ${pf.remoto} to pod ${p.name}: failed to connect to localhost:${pf.remoto} inside namespace: connection refused"`); return 52; }
    nota(`Handling connection for ${u.puerto}`);
    const r = contenidoWeb(p, u.ruta); out(r.cuerpo); JUEGO.marca("curl-local"); return 0;
  }
  const r = peticionHTTP(null, null, url);
  if (/\.elb\.amazonaws\.com$/.test(u.host) || r.externo){ if (r.ok){ out(r.cuerpo); JUEGO.marca("curl-lb"); return 0; } err(r.curl); return r.codigoCurl || 7; }
  if (/\.(com|es|org|net|io|dev)$/.test(u.host)){ out("<!doctype html><html>… (web externa) …</html>"); return 0; }
  err(`curl: (6) Could not resolve host: ${u.host}`);
  nota("   (los nombres de Services solo existen DENTRO del cluster. Desde tu PC: kubectl port-forward, o prueba desde un Pod: kubectl run prueba --rm -it --image=busybox:1.37 -n <ns> -- wget -qO- http://<svc>)");
  return 6;
}

/* ---------- top / explain / config / auth ---------- */
function kTop(pos, f, ns){
  const metrics = S.pods.some(p => p.ns === "kube-system" && p.labels["k8s-app"] === "metrics-server" && p.listo);
  if (!metrics){ err("error: Metrics API not available"); return 1; }
  const r = recurso(pos[0] || "");
  if (r && r.kind === "Node"){ out(tabla([["NAME","CPU(cores)","CPU(%)","MEMORY(bytes)","MEMORY(%)"], ...S.nodes.filter(n => n.ready).map(n => { const u = usoNodo(n); const cpu = Math.round(u.cpu * 0.3 + 40); const mem = Math.round(u.mem * 0.6 + 520); return [n.name, cpu + "m", Math.round(cpu / n.alloc.cpu * 100) + "%", mem + "Mi", Math.round(mem / n.alloc.mem * 100) + "%"]; })])); return 0; }
  if (r && r.kind === "Pod"){
    if (!f.A && !compruebaNs(ns)) return 1;
    const ps = S.pods.filter(p => (f.A || p.ns === ns) && p.fase === "Running" && !p.efimero);
    if (!ps.length){ out(`No resources found in ${ns} namespace.`); return 0; }
    out(tabla([[...(f.A ? ["NAMESPACE"] : []), "NAME","CPU(cores)","MEMORY(bytes)"], ...ps.map(p => [...(f.A ? [p.ns] : []), p.name, Math.max(1, Math.round(reqPod(p.spec).cpu * 0.08 + hash(p.name) % 3)) + "m", Math.round((p.proc && p.proc.mem) || (3 + hash(p.uid) % 9)) + "Mi"])]));
    return 0;
  }
  err("error: (simulador) kubectl top nodes | top pods"); return 1;
}
const EXPLICA = {
  "pod":"KIND:       Pod\nVERSION:    v1\n\nDESCRIPTION:\n    La unidad mínima de Kubernetes: uno o varios contenedores que comparten red\n    (misma IP) y volúmenes. Casi nunca se crea suelto: lo crea un Deployment,\n    Job o DaemonSet para que alguien lo recree si muere.",
  "deployment":"KIND:       Deployment\nGROUP:      apps\nVERSION:    v1\n\nDESCRIPTION:\n    Mantiene N copias (réplicas) de una plantilla de Pod y las actualiza sin\n    corte (rolling update), guardando el historial en ReplicaSets.\n\nFIELDS:\n  spec.replicas   <integer>  número de Pods deseados\n  spec.selector   <Object>   qué Pods son suyos (por labels); inmutable\n  spec.template   <Object>   la plantilla de Pod\n  spec.strategy   <Object>   RollingUpdate (maxSurge/maxUnavailable) o Recreate",
  "deployment.spec.replicas":"KIND:       Deployment\nGROUP:      apps\nVERSION:    v1\n\nFIELD: replicas <integer>\n\nDESCRIPTION:\n    Número de Pods deseados. Por defecto 1. Si hay un HPA, lo gestiona él.",
  "deployment.spec.selector":"FIELD: selector <LabelSelector> -required-\n\nDESCRIPTION:\n    Qué Pods pertenecen al Deployment. Debe coincidir con\n    spec.template.metadata.labels. Es INMUTABLE: para cambiarlo hay que recrear.",
  "deployment.spec.template":"FIELD: template <PodTemplateSpec> -required-\n\nDESCRIPTION:\n    La plantilla de los Pods. Cualquier cambio aquí (imagen, env, recursos…)\n    crea un ReplicaSet nuevo = una revisión nueva (rollout).",
  "deployment.spec.strategy":"FIELD: strategy <DeploymentStrategy>\n\nDESCRIPTION:\n    RollingUpdate (por defecto: maxSurge 25%, maxUnavailable 25%) o Recreate\n    (mata todos y crea los nuevos: hay corte).",
  "service":"KIND:       Service\nVERSION:    v1\n\nDESCRIPTION:\n    IP y nombre DNS estables delante de un grupo de Pods (elegidos por selector).\n\nFIELDS:\n  spec.type       ClusterIP (interno) | NodePort | LoadBalancer (en EKS crea un ELB)\n  spec.selector   labels de los Pods a los que manda tráfico\n  spec.ports      port (donde escucha el Service) y targetPort (donde escucha el contenedor)",
  "service.spec.ports":"FIELD: ports <[]ServicePort>\n\nDESCRIPTION:\n    port: puerto del Service.  targetPort: puerto del CONTENEDOR (número o nombre).\n    Si targetPort no coincide con donde escucha la app → endpoints sí, respuestas no.",
  "service.spec.ports.targetport":"FIELD: targetPort <IntOrString>\n\nDESCRIPTION:\n    Puerto (o nombre de puerto) del contenedor al que se reenvía. Si se omite,\n    vale lo mismo que port.",
  "service.spec.type":"FIELD: type <string>\n\nDESCRIPTION:\n    ClusterIP (por defecto, solo dentro del cluster), NodePort (puerto en cada nodo),\n    LoadBalancer (AWS crea un balanceador; cuesta dinero), ExternalName (CNAME).",
  "service.spec.selector":"FIELD: selector <map[string]string>\n\nDESCRIPTION:\n    El Service manda tráfico a los Pods LISTOS que tengan TODAS estas labels.\n    Si no casa con nadie, el Service no tiene endpoints.",
  "pod.spec.containers.resources":"FIELD: resources <ResourceRequirements>\n\nDESCRIPTION:\n    requests: lo que se reserva para planificar (el scheduler suma requests).\n    limits:   el máximo. Superar limits.memory = OOMKilled (exit 137).\n              Superar limits.cpu = estrangulado (throttling), no muere.",
  "pod.spec.containers.livenessprobe":"FIELD: livenessProbe <Probe>\n\nDESCRIPTION:\n    ¿Sigue vivo? Si falla failureThreshold veces, el kubelet MATA y reinicia el contenedor.",
  "pod.spec.containers.readinessprobe":"FIELD: readinessProbe <Probe>\n\nDESCRIPTION:\n    ¿Puede recibir tráfico? Si falla, el Pod sale de los endpoints (no se reinicia).",
  "pod.spec.tolerations":"FIELD: tolerations <[]Toleration>\n\nDESCRIPTION:\n    Permiten al Pod ir a nodos con taints. Ej: {key: mantenimiento, operator: Equal,\n    value: si, effect: NoSchedule}  o  {key: mantenimiento, operator: Exists}",
  "pod.spec.nodeselector":"FIELD: nodeSelector <map[string]string>\n\nDESCRIPTION:\n    El Pod solo puede ir a nodos que tengan TODAS estas labels.",
  "pod.spec.securitycontext":"FIELD: securityContext <PodSecurityContext>\n\nDESCRIPTION:\n    Seguridad a nivel de Pod: runAsNonRoot, runAsUser, fsGroup, seccompProfile…\n    El de contenedor añade allowPrivilegeEscalation, capabilities, readOnlyRootFilesystem.",
  "configmap":"KIND:       ConfigMap\nVERSION:    v1\n\nDESCRIPTION:\n    Configuración clave=valor fuera de la imagen. Se usa como variables de entorno\n    (se leen SOLO al arrancar) o montada como ficheros (se actualiza sola, con retraso).",
  "secret":"KIND:       Secret\nVERSION:    v1\n\nDESCRIPTION:\n    Como un ConfigMap pero para datos sensibles. «data» va en base64 (que NO es\n    cifrado); «stringData» acepta texto normal.",
  "job":"KIND:       Job\nGROUP:      batch\nVERSION:    v1\n\nDESCRIPTION:\n    Ejecuta Pods hasta que terminan bien (completions). restartPolicy: Never u OnFailure.",
  "cronjob.spec.schedule":"FIELD: schedule <string> -required-\n\nDESCRIPTION:\n    Formato cron: minuto hora día-del-mes mes día-de-la-semana.\n    \"0 3 * * *\" = todos los días a las 03:00 · \"*/5 * * * *\" = cada 5 minutos.",
  "horizontalpodautoscaler":"KIND:       HorizontalPodAutoscaler\nGROUP:      autoscaling\nVERSION:    v2\n\nDESCRIPTION:\n    Cambia spec.replicas de un Deployment según métricas (metrics-server).\n    % de CPU = uso / requests: sin requests de CPU no puede calcularlo.",
  "resourcequota":"KIND:       ResourceQuota\nVERSION:    v1\n\nDESCRIPTION:\n    Límite de lo que puede consumir un namespace (pods, cpu, memory…).\n    Si se supera, el ReplicaSet no puede crear Pods (FailedCreate, exceeded quota).",
  "poddisruptionbudget":"KIND:       PodDisruptionBudget\nGROUP:      policy\nVERSION:    v1\n\nDESCRIPTION:\n    Cuántos Pods deben seguir disponibles durante desalojos VOLUNTARIOS (drain,\n    upgrades, Karpenter). minAvailable o maxUnavailable.",
  "networkpolicy":"KIND:       NetworkPolicy\nGROUP:      networking.k8s.io\nVERSION:    v1\n\nDESCRIPTION:\n    Cortafuegos entre Pods. Si una política selecciona un Pod para Ingress, solo\n    entra lo que alguna política permita. Las políticas se SUMAN.",
  "role":"KIND:       Role\nGROUP:      rbac.authorization.k8s.io\nVERSION:    v1\n\nDESCRIPTION:\n    Permisos (verbos sobre recursos) dentro de UN namespace. Por sí solo no da\n    nada: hay que asignarlo con un RoleBinding.",
  "rolebinding":"KIND:       RoleBinding\nGROUP:      rbac.authorization.k8s.io\nVERSION:    v1\n\nDESCRIPTION:\n    Da un Role (o un ClusterRole, solo en este namespace) a usuarios, grupos o\n    ServiceAccounts. roleRef es inmutable.",
};
function kExplain(pos){
  const k = String(pos[0] || "").toLowerCase().replace(/^deploy\./, "deployment.").replace(/^deployments\./, "deployment.").replace(/^svc\./, "service.").replace(/^services\./, "service.").replace(/^po\./, "pod.").replace(/^pods\./, "pod.").replace(/^hpa/, "horizontalpodautoscaler").replace(/^pdb/, "poddisruptionbudget").replace(/^cm$/, "configmap").replace(/^netpol/, "networkpolicy").replace(/^quota/, "resourcequota");
  const base = k.replace(/s$/, "");
  const txt = EXPLICA[k] || EXPLICA[base] || EXPLICA[k.replace(/^deployment\.spec\.template\.spec\./, "pod.spec.")];
  if (!txt && pos[0]){ const e = explicarEsquema(k); if (e && e.txt){ out(e.txt); return 0; } if (e && e.error){ err(e.error); return 1; } }
  if (!txt){ if (!pos[0]){ err("error: You must specify the type of resource to explain. Use \"kubectl api-resources\" for a complete list of supported resources."); return 1; } aviso(`(simulador) sin explicación para «${pos[0]}». Prueba: deployment, deployment.spec.replicas, service.spec.ports, pod.spec.containers.resources, pod.spec.tolerations, cronjob.spec.schedule, networkpolicy, role…`); return 1; }
  out(txt); return 0;
}
/* ---------- kubectl explain: esquema de los campos más usados (para rutas que no tienen texto propio) ---------- */
const ESQ_PROBE = {_t:"Probe", _d:"Comprobación periódica del contenedor: httpGet, tcpSocket o exec.",
  httpGet:{_t:"HTTPGetAction", _d:"Petición HTTP GET. Éxito si responde 200-399.", path:{_t:"string", _d:"Ruta a pedir, p. ej. /."}, port:{_t:"IntOrString", _d:"Puerto del CONTENEDOR (número o nombre)."}, scheme:{_t:"string", _d:"HTTP (por defecto) o HTTPS."}},
  tcpSocket:{_t:"TCPSocketAction", _d:"Éxito si se puede abrir una conexión TCP.", port:{_t:"IntOrString", _d:"Puerto del contenedor."}},
  exec:{_t:"ExecAction", _d:"Ejecuta un comando dentro del contenedor; éxito si sale con 0.", command:{_t:"[]string", _d:"El comando y sus argumentos."}},
  initialDelaySeconds:{_t:"integer", _d:"Segundos de espera tras arrancar antes de la primera prueba."}, periodSeconds:{_t:"integer", _d:"Cada cuántos segundos se prueba (10 por defecto)."},
  timeoutSeconds:{_t:"integer", _d:"Segundos para responder (1 por defecto)."}, failureThreshold:{_t:"integer", _d:"Fallos seguidos para darlo por fallido (3 por defecto)."}, successThreshold:{_t:"integer", _d:"Éxitos seguidos para darlo por bueno (1)."}};
const ESQ_CONT = {_t:"[]Container", _d:"Los contenedores del Pod. Cada uno es una imagen con su comando, puertos, variables, recursos y sondas.",
  name:{_t:"string", _d:"Nombre del contenedor (único en el Pod). Es el que usan set image, logs -c, exec -c."}, image:{_t:"string", _d:"Imagen: repositorio:tag."},
  imagePullPolicy:{_t:"string", _d:"Always, IfNotPresent o Never."}, command:{_t:"[]string", _d:"Sustituye el ENTRYPOINT de la imagen."}, args:{_t:"[]string", _d:"Sustituye el CMD de la imagen (argumentos del command)."},
  workingDir:{_t:"string", _d:"Directorio de trabajo."}, ports:{_t:"[]ContainerPort", _d:"Puertos que expone (informativo).", containerPort:{_t:"integer", _d:"Puerto en el que escucha el contenedor."}, name:{_t:"string", _d:"Nombre del puerto (lo puede usar un targetPort)."}, protocol:{_t:"string", _d:"TCP (por defecto), UDP o SCTP."}},
  env:{_t:"[]EnvVar", _d:"Variables de entorno.", name:{_t:"string", _d:"Nombre de la variable."}, value:{_t:"string", _d:"Valor literal."}, valueFrom:{_t:"EnvVarSource", _d:"Valor sacado de un ConfigMap (configMapKeyRef), un Secret (secretKeyRef) o del propio Pod (fieldRef)."}},
  envFrom:{_t:"[]EnvFromSource", _d:"Carga TODAS las claves de un ConfigMap (configMapRef) o Secret (secretRef) como variables."},
  resources:{_t:"ResourceRequirements", _d:"requests: lo que se reserva para planificar. limits: el máximo (memoria: OOMKilled; CPU: throttling).", requests:{_t:"map[string]Quantity", _d:"cpu (100m = 0,1 CPU), memory (64Mi)…"}, limits:{_t:"map[string]Quantity", _d:"cpu, memory…"}},
  livenessProbe:ESQ_PROBE, readinessProbe:ESQ_PROBE, startupProbe:ESQ_PROBE,
  volumeMounts:{_t:"[]VolumeMount", _d:"Dónde se montan los volúmenes del Pod.", name:{_t:"string", _d:"Nombre del volumen (de spec.volumes)."}, mountPath:{_t:"string", _d:"Ruta dentro del contenedor."}, readOnly:{_t:"boolean", _d:"Solo lectura."}},
  securityContext:{_t:"SecurityContext", _d:"Seguridad del contenedor.", runAsUser:{_t:"integer", _d:"UID con el que corre."}, runAsNonRoot:{_t:"boolean", _d:"Si es true, no arranca como root."}, allowPrivilegeEscalation:{_t:"boolean", _d:"false = ningún proceso puede ganar privilegios (NoNewPrivs)."},
    privileged:{_t:"boolean", _d:"Acceso casi total al nodo. Nunca en producción."}, readOnlyRootFilesystem:{_t:"boolean", _d:"Sistema de ficheros raíz de solo lectura."}, capabilities:{_t:"Capabilities", _d:"add / drop de capabilities de Linux (drop: [\"ALL\"])."}, seccompProfile:{_t:"SeccompProfile", _d:"type: RuntimeDefault (recomendado), Localhost o Unconfined."}}};
const ESQ_PODSPEC = {_t:"PodSpec", _d:"Qué corre el Pod y cómo.", containers:ESQ_CONT, initContainers:Object.assign({}, ESQ_CONT, {_t:"[]Container", _d:"Contenedores que se ejecutan EN ORDEN antes de los normales; cada uno debe terminar bien."}),
  volumes:{_t:"[]Volume", _d:"Volúmenes del Pod: configMap, secret, emptyDir, persistentVolumeClaim…"}, restartPolicy:{_t:"string", _d:"Always (por defecto), OnFailure o Never."},
  nodeSelector:{_t:"map[string]string", _d:"Solo nodos que tengan TODAS estas labels."}, tolerations:{_t:"[]Toleration", _d:"Permiten ir a nodos con taints (key, operator, value, effect)."}, affinity:{_t:"Affinity", _d:"Reglas de afinidad con nodos y con otros Pods."},
  serviceAccountName:{_t:"string", _d:"La ServiceAccount (identidad) del Pod."}, automountServiceAccountToken:{_t:"boolean", _d:"Si se monta el token de la ServiceAccount en el Pod."},
  securityContext:{_t:"PodSecurityContext", _d:"Seguridad para todos los contenedores: runAsUser, runAsNonRoot, fsGroup, seccompProfile."}, shareProcessNamespace:{_t:"boolean", _d:"Todos los contenedores ven los procesos de todos."},
  terminationGracePeriodSeconds:{_t:"integer", _d:"Segundos que se espera al parar (30 por defecto)."}, priorityClassName:{_t:"string", _d:"Prioridad del Pod."}, hostNetwork:{_t:"boolean", _d:"Usa la red del nodo."}};
const ESQ_META = {_t:"ObjectMeta", _d:"Nombre, namespace, labels y annotations.", name:{_t:"string", _d:"Nombre (único por tipo y namespace)."}, namespace:{_t:"string", _d:"Namespace."}, labels:{_t:"map[string]string", _d:"Etiquetas: las usan los selectores."}, annotations:{_t:"map[string]string", _d:"Notas para herramientas; no sirven para seleccionar."}};
const ESQUEMA = {
  pod:{_k:"Pod", _v:"v1", metadata:ESQ_META, spec:ESQ_PODSPEC, status:{_t:"PodStatus", _d:"Lo que HAY: phase, conditions, podIP, containerStatuses, qosClass. Lo escribe Kubernetes."}},
  deployment:{_k:"Deployment", _g:"apps", _v:"v1", metadata:ESQ_META, spec:{_t:"DeploymentSpec", _d:"Estado deseado.", replicas:{_t:"integer", _d:"Número de Pods (1 por defecto)."}, selector:{_t:"LabelSelector", _d:"Qué Pods son suyos; debe coincidir con template.metadata.labels."},
    template:{_t:"PodTemplateSpec", _d:"La plantilla de los Pods.", metadata:ESQ_META, spec:ESQ_PODSPEC}, strategy:{_t:"DeploymentStrategy", _d:"RollingUpdate (maxSurge, maxUnavailable) o Recreate."}, revisionHistoryLimit:{_t:"integer", _d:"Revisiones que se guardan para rollout undo (10)."}, minReadySeconds:{_t:"integer", _d:"Segundos listo para contar como disponible."}, paused:{_t:"boolean", _d:"rollout pause."}},
    status:{_t:"DeploymentStatus", _d:"replicas, readyReplicas, availableReplicas, updatedReplicas, conditions."}},
  service:{_k:"Service", _v:"v1", metadata:ESQ_META, spec:{_t:"ServiceSpec", _d:"Cómo se publica.", type:{_t:"string", _d:"ClusterIP, NodePort, LoadBalancer o ExternalName."}, selector:{_t:"map[string]string", _d:"Pods LISTOS con estas labels reciben el tráfico."},
    ports:{_t:"[]ServicePort", _d:"Puertos.", port:{_t:"integer", _d:"Puerto del Service."}, targetPort:{_t:"IntOrString", _d:"Puerto del CONTENEDOR."}, nodePort:{_t:"integer", _d:"Puerto en cada nodo (NodePort/LoadBalancer)."}, name:{_t:"string", _d:"Nombre del puerto."}, protocol:{_t:"string", _d:"TCP, UDP o SCTP."}},
    clusterIP:{_t:"string", _d:"IP interna (None = headless)."}}},
  daemonset:{_k:"DaemonSet", _g:"apps", _v:"v1", metadata:ESQ_META, spec:{_t:"DaemonSetSpec", _d:"Un Pod en cada nodo (que encaje).", selector:{_t:"LabelSelector", _d:"Sus Pods."}, template:{_t:"PodTemplateSpec", _d:"Plantilla.", spec:ESQ_PODSPEC}, updateStrategy:{_t:"DaemonSetUpdateStrategy", _d:"RollingUpdate u OnDelete."}}},
  job:{_k:"Job", _g:"batch", _v:"v1", metadata:ESQ_META, spec:{_t:"JobSpec", _d:"Ejecutar hasta terminar.", completions:{_t:"integer", _d:"Éxitos necesarios."}, parallelism:{_t:"integer", _d:"Pods a la vez."}, backoffLimit:{_t:"integer", _d:"Reintentos antes de fallar (6)."}, activeDeadlineSeconds:{_t:"integer", _d:"Tiempo máximo."}, ttlSecondsAfterFinished:{_t:"integer", _d:"Borrado automático al acabar."}, template:{_t:"PodTemplateSpec", _d:"Plantilla (restartPolicy Never u OnFailure).", spec:ESQ_PODSPEC}}},
  cronjob:{_k:"CronJob", _g:"batch", _v:"v1", metadata:ESQ_META, spec:{_t:"CronJobSpec", _d:"Job programado.", schedule:{_t:"string", _d:"minuto hora día mes día-semana."}, suspend:{_t:"boolean", _d:"Pausarlo."}, concurrencyPolicy:{_t:"string", _d:"Allow, Forbid o Replace."}, jobTemplate:{_t:"JobTemplateSpec", _d:"El Job que se crea."}, successfulJobsHistoryLimit:{_t:"integer", _d:"Jobs buenos que se guardan (3)."}}},
  namespace:{_k:"Namespace", _v:"v1", metadata:ESQ_META, spec:{_t:"NamespaceSpec", _d:"finalizers."}},
  node:{_k:"Node", _v:"v1", metadata:ESQ_META, spec:{_t:"NodeSpec", _d:"providerID, podCIDR, taints, unschedulable (cordon).", taints:{_t:"[]Taint", _d:"key, value, effect (NoSchedule, PreferNoSchedule, NoExecute)."}, unschedulable:{_t:"boolean", _d:"true = cordon."}, providerID:{_t:"string", _d:"aws:///<zona>/<id de instancia>."}},
    status:{_t:"NodeStatus", _d:"capacity, allocatable, conditions (Ready…), addresses, nodeInfo."}},
  serviceaccount:{_k:"ServiceAccount", _v:"v1", metadata:ESQ_META, automountServiceAccountToken:{_t:"boolean", _d:"Si sus Pods montan el token (se decide al crear cada Pod)."}, imagePullSecrets:{_t:"[]LocalObjectReference", _d:"Secrets para descargar imágenes privadas."}},
  clusterrole:{_k:"ClusterRole", _g:"rbac.authorization.k8s.io", _v:"v1", metadata:ESQ_META, rules:{_t:"[]PolicyRule", _d:"apiGroups, resources, verbs (como un Role, pero sin namespace)."}},
  clusterrolebinding:{_k:"ClusterRoleBinding", _g:"rbac.authorization.k8s.io", _v:"v1", metadata:ESQ_META, roleRef:{_t:"RoleRef", _d:"El ClusterRole que se da."}, subjects:{_t:"[]Subject", _d:"A quién: User, Group o ServiceAccount (con namespace). Vale en todo el cluster."}},
  replicaset:{_k:"ReplicaSet", _g:"apps", _v:"v1", metadata:ESQ_META, spec:{_t:"ReplicaSetSpec", _d:"Lo crea un Deployment (uno por versión).", replicas:{_t:"integer", _d:"Pods."}, selector:{_t:"LabelSelector", _d:"Sus Pods."}, template:{_t:"PodTemplateSpec", _d:"Plantilla.", spec:ESQ_PODSPEC}}},
};
const ALIAS_EXPLAIN = {po:"pod", pods:"pod", deploy:"deployment", deployments:"deployment", svc:"service", services:"service", ds:"daemonset", daemonsets:"daemonset", jobs:"job", cj:"cronjob", cronjobs:"cronjob", ns:"namespace", namespaces:"namespace",
  no:"node", nodes:"node", sa:"serviceaccount", serviceaccounts:"serviceaccount", clusterroles:"clusterrole", clusterrolebindings:"clusterrolebinding", rs:"replicaset", replicasets:"replicaset"};
function explicarEsquema(ruta){
  const partes = ruta.split(".").filter(Boolean); if (!partes.length) return null;
  const raiz = ALIAS_EXPLAIN[partes[0]] || partes[0]; const tipo = ESQUEMA[raiz]; if (!tipo) return null;
  let nodo = tipo, nombre = raiz;
  for (const p of partes.slice(1)){
    const k = Object.keys(nodo).find(z => !z.startsWith("_") && z.toLowerCase() === p.toLowerCase());
    if (!k) return {error:`error: field "${p}" does not exist`};
    nodo = nodo[k]; nombre = k;
  }
  const cab = `KIND:       ${tipo._k}\n${tipo._g ? `GROUP:      ${tipo._g}\n` : ""}VERSION:    ${tipo._v}\n\n`;
  const hijos = Object.keys(nodo).filter(z => !z.startsWith("_"));
  const campos = hijos.length ? "\n\nFIELDS:\n" + hijos.map(h => `  ${h}\t<${nodo[h]._t || "Object"}>\n    ${nodo[h]._d || ""}`).join("\n\n") : "";
  if (partes.length === 1) return {txt:cab + `DESCRIPTION:\n    ${(EXPLICA[raiz] || "").split("DESCRIPTION:\n")[1] ? EXPLICA[raiz].split("DESCRIPTION:\n")[1].split("\n\n")[0].trim() : tipo._k}` + campos};
  return {txt:cab + `FIELD: ${nombre} <${nodo._t || "Object"}>\n\nDESCRIPTION:\n    ${nodo._d || ""}` + campos};
}

/* ---------- kubectl wait ---------- */
function kWait(pos, f, ns){
  if (!compruebaNs(ns)) return 1;
  const cond = String(f.for || "");
  if (!cond){ err("error: --for must be specified: --for=condition=Ready, --for=condition=Available, --for=condition=Complete o --for=delete"); return 1; }
  const tiempo = (() => { const m = String(f.timeout || "30s").match(/^(\d+)(s|m)?$/); return m ? parseInt(m[1], 10) * (m[2] === "m" ? 60 : 1) : 30; })();
  // objetivos: «pod/x», «pod x y», «pods -l app=x», «deployment/x»…
  let tipo = null, nombres = [];
  for (const p of pos){ if (p.includes("/")){ const [t, n] = p.split("/"); tipo = tipo || t; nombres.push(n); } else if (!tipo) tipo = p; else nombres.push(p); }
  const r = tipo && recurso(tipo);
  if (!r){ err(`error: the server doesn't have a resource type "${tipo || ""}"`); return 1; }
  const sel = f.l || f.selector;
  const lista = () => {
    if (r.kind === "Pod"){ const ps = S.pods.filter(p => p.ns === ns && !p.efimero && (f.all || (sel ? selectorLabels(sel)(p.labels) : nombres.includes(p.name)))); return ps.map(p => ({id:`pod/${p.name}`, o:p})); }
    const os = objs(r.kind, ns).filter(o => f.all || (sel ? selectorLabels(sel)(o.metadata.labels || {}) : nombres.includes(o.metadata.name)));
    return os.map(o => ({id:`${r.plural.replace(/s$/, "")}${r.api.includes("/") ? "." + r.api.split("/")[0] : ""}/${o.metadata.name}`, o}));
  };
  const inicial = lista();
  if (!inicial.length){ if (cond === "delete"){ return 0; } err(sel ? `error: no matching resources found` : `Error from server (NotFound): ${r.plural} "${nombres[0] || ""}" not found`); return 1; }
  const cumple = it => {
    const c = cond.toLowerCase();
    if (c === "delete") return !lista().some(z => z.id === it.id);
    const o = it.o;
    if (r.kind === "Pod"){ if (c === "condition=ready") return !!o.listo; if (c === "condition=podscheduled") return !!o.node; if (c === "condition=initialized") return !(o.spec.initContainers || []).length || !!o.initHecho; if (c === "condition=containersready") return !!o.listo; }
    if (r.kind === "Deployment" && c === "condition=available"){ const e = estadoDeployment(o); return (e.availableReplicas || 0) >= (o.spec.replicas ?? 1); }
    if (r.kind === "Job" && c === "condition=complete") return !!((o.status || {}).succeeded >= ((o.spec || {}).completions || 1));
    if (r.kind === "Job" && c === "condition=failed") return !!(o.status || {}).failed && (o.status.failed > ((o.spec || {}).backoffLimit ?? 6));
    return null;
  };
  if (cumple(inicial[0]) === null){ err(`error: (simulador) condición no reconocida «${cond}» para ${r.plural}. Prueba: condition=Ready (pods), condition=Available (deployments), condition=Complete (jobs), delete`); return 1; }
  let pendientes = inicial.slice();
  for (let t = 0; t <= tiempo && pendientes.length; t++){
    const vivos = lista(); pendientes = pendientes.map(p => vivos.find(v => v.id === p.id) || (cond === "delete" ? p : null)).filter(Boolean);
    for (const p of pendientes.slice()) if (cumple(p)){ out(`${p.id} condition met`); pendientes = pendientes.filter(z => z !== p); }
    if (pendientes.length && t < tiempo){ avanzarReloj(1); reconciliar(); }
  }
  if (pendientes.length){ for (const p of pendientes) err(`error: timed out waiting for the condition on ${p.id.split("/")[0]}s/${p.id.split("/")[1]}`); return 1; }
  return 0;
}

/* ---------- kubectl logs -l (varios Pods por selector) ---------- */
function logsPorSelector(f, ns){
  const sel = f.l || f.selector;
  const ps = S.pods.filter(p => p.ns === ns && !p.efimero && !p.borrando && selectorLabels(sel)(p.labels)).sort((a, b) => a.name.localeCompare(b.name));
  if (!ps.length){ out(`No resources found in ${ns} namespace.`); return 0; }
  const max = parseInt(f["max-log-requests"] || "5", 10);
  if (ps.length > max){ err(`error: you are attempting to follow ${ps.length} log streams, but maximum allowed concurrency is ${max}, use --max-log-requests to increase the limit`); return 1; }
  const g = Object.assign({}, f); delete g.l; delete g.selector;
  let codigo = 0;
  for (const p of ps){
    if (f.prefix){ const ant = CAPTURA; const buf = []; CAPTURA = buf; try { codigo = kLogs([p.name], g, ns) || codigo; } finally { CAPTURA = ant; }
      const c = g.c || p.spec.containers[0].name; for (const l of buf.join("\n").split("\n")) if (l) out(`[pod/${p.name}/${c}] ${l}`); }
    else codigo = kLogs([p.name], g, ns) || codigo;
  }
  return codigo;
}

/* ---------- kubectl create service clusterip|nodeport|loadbalancer <nombre> --tcp=puerto:targetPort ---------- */
function crearService(pos, f, ns){
  if (!compruebaNs(ns)) return 1;
  const tipos = {clusterip:"ClusterIP", nodeport:"NodePort", loadbalancer:"LoadBalancer"};
  const tipo = tipos[String(pos[1] || "").toLowerCase()], nombre = pos[2];
  if (!tipo){ err(`error: must specify one of: clusterip, nodeport, loadbalancer\n   (ej: kubectl create service clusterip web --tcp=80:8080 -n <ns>)`); return 1; }
  if (!nombre){ err("error: exactly one NAME is required, got 0"); return 1; }
  const tcp = [].concat(f.tcp || []).flatMap(x => String(x).split(",")).filter(Boolean);
  if (!tcp.length){ err("error: at least one tcp port specifier must be provided"); return 1; }
  if (obj("Service", ns, nombre)){ err(`error: failed to create ${tipo === "ClusterIP" ? "ClusterIP" : tipo} service: services "${nombre}" already exists`); return 1; }
  const ports = [];
  for (const t of tcp){ const m = t.match(/^(\d+)(?::(\w+))?$/); if (!m){ err(`error: invalid port "${t}"`); return 1; } ports.push({name:`${m[1]}-${m[2] || m[1]}`, port:parseInt(m[1], 10), protocol:"TCP", targetPort:/^\d+$/.test(m[2] || m[1]) ? parseInt(m[2] || m[1], 10) : m[2]}); }
  guardarObj({apiVersion:"v1", kind:"Service", metadata:metaNueva(nombre, ns, {labels:{app:nombre}}), spec:{type:tipo, selector:{app:nombre}, ports}});
  out(`service/${nombre} created`);
  nota(`(el selector es app=${nombre}: solo recibe tráfico si hay Pods con esa label. Si no, cámbialo con kubectl set selector)`);
  return 0;
}

/* ---------- tipos que existen en un EKS real aunque el juego no los use: salen vacíos o con lo que trae EKS ---------- */
const OTROS_RECURSOS = [
  {p:"persistentvolumes", a:["pv","persistentvolume"], ns:false},
  {p:"persistentvolumeclaims", a:["pvc","persistentvolumeclaim"], ns:true},
  {p:"statefulsets", a:["sts","statefulset","statefulsets.apps"], ns:true},
  {p:"ingresses", a:["ing","ingress","ingresses.networking.k8s.io"], ns:true},
  {p:"ingressclasses", a:["ingressclass"], ns:false},
  {p:"limitranges", a:["limits","limitrange"], ns:true},
  {p:"certificatesigningrequests", a:["csr","certificatesigningrequest"], ns:false},
  {p:"volumeattachments", a:["volumeattachment"], ns:false},
  {p:"replicationcontrollers", a:["rc","replicationcontroller"], ns:true},
  {p:"podtemplates", a:["podtemplate"], ns:true},
  {p:"csidrivers", a:["csidriver"], ns:false, filas:[["NAME","ATTACHREQUIRED","PODINFOONMOUNT","STORAGECAPACITY","TOKENREQUESTS","REQUIRESREPUBLISH","MODES","AGE"],["efs.csi.aws.com","false","false","false","<unset>","false","Persistent","1d"]]},
  {p:"storageclasses", a:["sc","storageclass","storageclasses.storage.k8s.io"], ns:false, filas:[["NAME","PROVISIONER","RECLAIMPOLICY","VOLUMEBINDINGMODE","ALLOWVOLUMEEXPANSION","AGE"],["gp2","kubernetes.io/aws-ebs","Delete","WaitForFirstConsumer","false","1d"]]},
  {p:"priorityclasses", a:["pc","priorityclass"], ns:false, filas:[["NAME","VALUE","GLOBAL-DEFAULT","AGE","PREEMPTIONPOLICY"],["system-cluster-critical","2000000000","false","1d","PreemptLowerPriority"],["system-node-critical","2000001000","false","1d","PreemptLowerPriority"]]},
  {p:"customresourcedefinitions", a:["crd","crds","customresourcedefinition"], ns:false, filas:[["NAME","CREATED AT"],["cninodes.vpcresources.k8s.aws","2026-11-26T09:00:00Z"],["eniconfigs.crd.k8s.amazonaws.com","2026-11-26T09:00:00Z"],["policyendpoints.networking.k8s.aws","2026-11-26T09:00:00Z"],["securitygrouppolicies.vpcresources.k8s.aws","2026-11-26T09:00:00Z"]]},
  {p:"mutatingwebhookconfigurations", a:["mutatingwebhookconfiguration"], ns:false, filas:[["NAME","WEBHOOKS","AGE"],["pod-identity-webhook","1","1d"],["vpc-resource-mutating-webhook","1","1d"]]},
  {p:"validatingwebhookconfigurations", a:["validatingwebhookconfiguration"], ns:false, filas:[["NAME","WEBHOOKS","AGE"],["vpc-resource-validating-webhook","2","1d"]]},
  {p:"apiservices", a:["apiservice"], ns:false, filas:[["NAME","SERVICE","AVAILABLE","AGE"],["v1.","Local","True","1d"],["v1.apps","Local","True","1d"],["v1.batch","Local","True","1d"],["v1.rbac.authorization.k8s.io","Local","True","1d"],["v1beta1.metrics.k8s.io","kube-system/metrics-server","True","1d"]]},
  {p:"componentstatuses", a:["cs","componentstatus"], ns:false, aviso:"Warning: v1 ComponentStatus is deprecated in v1.19+", filas:[["NAME","STATUS","MESSAGE","ERROR"],["etcd-0","Healthy","ok",""],["scheduler","Healthy","ok",""],["controller-manager","Healthy","ok",""]]},
  {p:"leases", a:["lease","leases.coordination.k8s.io"], ns:true, filasNs:ns => ns === "kube-node-lease" ? [["NAME","HOLDER","AGE"], ...S.nodes.map(n => [n.name, n.name, "1d"])] : null},
];
function otroRecurso(tok, f, ns){
  const t = String(tok || "").toLowerCase(); const r = OTROS_RECURSOS.find(x => x.p === t || x.a.includes(t)); if (!r) return null;
  if (r.ns && !f.A && !compruebaNs(ns)) return 1;
  if (r.aviso) aviso(r.aviso);
  const filas = r.filasNs ? r.filasNs(ns) : r.filas;
  if (filas && filas.length > 1){ out(tabla(f["no-headers"] ? filas.slice(1) : filas)); return 0; }
  out(r.ns && !f.A ? `No resources found in ${ns} namespace.` : "No resources found");
  return 0;
}
function getRaw(ruta){
  const r = String(ruta || "");
  if (/^\/(healthz|readyz|livez)(\?.*)?$/.test(r)){ out("ok"); return 0; }
  if (r === "/version"){ out(JSON.stringify({major:"1", minor:K8S_MINOR.split(".")[1] + "+", gitVersion:K8S_VER, platform:"linux/amd64"}, null, 2)); return 0; }
  if (/^\/(readyz|livez)\?verbose/.test(r) || r === "/readyz?verbose"){ out("[+]ping ok\n[+]etcd ok\nreadyz check passed"); return 0; }
  if (r === "/api" || r === "/api/"){ out(JSON.stringify({kind:"APIVersions", versions:["v1"]})); return 0; }
  err(`Error from server (NotFound): the server could not find the requested resource`); return 1;
}
function crearToken(sa, f, ns){
  if (!compruebaNs(ns)) return 1;
  if (!sa){ err("error: exactly one NAME is required, got 0"); return 1; }
  if (!obj("ServiceAccount", ns, sa)){ err(`Error from server (NotFound): serviceaccounts "${sa}" not found`); return 1; }
  const seg = (() => { const m = String(f.duration || "1h").match(/^(\d+)(h|m|s)$/); return m ? parseInt(m[1], 10) * ({h:3600, m:60, s:1})[m[2]] : 3600; })();
  const ahoraS = Math.floor(Date.now() / 1000);
  const b = o => b64e(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  out(`${b({alg:"RS256", kid:"7f3a9"})}.${b({aud:["https://kubernetes.default.svc"], exp:ahoraS + seg, iat:ahoraS, iss:`https://oidc.eks.${REGION}.amazonaws.com/id/0A1B2C3D4E5F60718293A4B5C6D7E8F9`, sub:`system:serviceaccount:${ns}:${sa}`})}.c2ltdWxhZG8tbm8tdmFsaWRv`);
  return 0;
}
function kProxy(f){
  out(`Starting to serve on 127.0.0.1:${f.port || 8001}`);
  nota("(simulador) en el navegador no se abre ningún puerto. En tu PC, con el proxy abierto: curl http://127.0.0.1:8001/api/v1/namespaces/default/pods  · Ctrl+C para pararlo");
  return 0;
}
function kAttach(pos, f, ns){
  const p = podObjetivo(pos[0], ns, true);
  if (!p || p.noPods){ err(`Error from server (NotFound): pods "${pos[0] || ""}" not found`); return 1; }
  if (p.estado !== "Running"){ err(`error: unable to upgrade connection: container not found ("${p.spec.containers[0].name}") — el Pod está en ${p.estado}`); return 1; }
  out("If you don't see a command prompt, try pressing enter.");
  const c = kLogs([p.name], Object.assign({}, f, {tail:"5", f:undefined, follow:undefined}), ns);
  nota("(simulador) attach te conecta a la salida del proceso principal; en el real se queda escuchando hasta Ctrl+C");
  return c;
}
function kCp(pos, f, ns){
  const [orig, dest] = pos;
  if (!orig || !dest){ err("error: source and destination are required"); return 1; }
  const m = orig.match(/^(?:([^/:]+)\/)?([^:]+):(.+)$/);
  if (!m){ aviso("(simulador) en el navegador no hay disco local, así que no se puede SUBIR un fichero al Pod. Para escribir dentro: kubectl exec -it <pod> -- sh"); return 1; }
  const nsCp = m[1] || ns, pod = m[2], ruta = m[3];
  const ant = CAPTURA; const buf = []; CAPTURA = buf; let c;
  try { c = kExec([pod], {}, nsCp, ["cat", ruta]); } finally { CAPTURA = ant; }
  if (c !== 0){ err(`error: ${ruta}: No such file or directory (o el contenedor no trae «tar»)`); return 1; }
  nota(`(simulador) copiado «${ruta}» → ${dest} (${buf.join("\n").length} bytes). En el navegador no hay disco: para verlo, kubectl exec ${pod} -- cat ${ruta}`);
  return 0;
}
function kDiff(pos, f, ns){
  if (!f.f){ err("error: must specify one of -f and -k"); return 1; }
  if (!f.n && !S.defNs && JUEGO.nivelNs()) ns = JUEGO.nivelNs();
  abrirEditor(plantillaApply(ns), texto => {
    let docs; try { docs = yamlParseTodos(texto); } catch(e){ err(`error: error parsing STDIN: error converting YAML to JSON: yaml: ${e.message}`); return; }
    let hay = false;
    for (const d of docs){
      if (!d || !d.kind || !d.metadata) continue;
      const nsD = d.metadata.namespace || (typeof f.n === "string" ? f.n : ns);
      const previo = existente(d.kind, (recursoPorKind(d.kind) || {}).cluster ? undefined : nsD, d.metadata.name);
      const limpia = o => { const c = copia(o); delete c.status; if (c.metadata){ for (const k of ["uid","creationTimestamp","resourceVersion","generation","managedFields"]) delete c.metadata[k]; if (c.metadata.annotations && !Object.keys(c.metadata.annotations).length) delete c.metadata.annotations; if (c.metadata.labels && !Object.keys(c.metadata.labels).length) delete c.metadata.labels; } return yamlDump(c).replace(/\n$/, "").split("\n"); };
      const a = previo ? limpia(aObjeto(d.kind, previo)) : [], b = limpia(Object.assign({}, d, {metadata:Object.assign({namespace:nsD}, d.metadata)}));
      const sa = new Set(a), sb = new Set(b);
      const menos = a.filter(l => !sb.has(l)), mas = b.filter(l => !sa.has(l));
      if (!menos.length && !mas.length) continue;
      hay = true;
      out(`diff -u -N /tmp/LIVE/${d.kind.toLowerCase()}.${d.metadata.name} /tmp/MERGED/${d.kind.toLowerCase()}.${d.metadata.name}`);
      for (const l of menos) out("-" + l, "c-err");
      for (const l of mas) out("+" + l, "c-ok");
    }
    if (!hay) nota("(sin diferencias: apply no cambiaría nada)");
  }, "kubectl diff -f -  (pega el YAML que quieres comparar con lo que hay)");
  return 0;
}

function kConfig(pos, f){
  const sub = pos[0];
  const ctx = `arn:aws:eks:${REGION}:${CUENTA}:cluster/${CLUSTER}`;
  if (sub === "current-context"){ out("eks-juego"); return 0; }
  if (sub === "get-contexts"){ out(tabla([["CURRENT","NAME","CLUSTER","AUTHINFO","NAMESPACE"],["*","eks-juego",ctx,ctx,S.defNs || ""]])); return 0; }
  if (sub === "get-clusters"){ out("NAME\n" + ctx); return 0; }
  if (sub === "use-context"){ if (pos[1] === "eks-juego"){ out(`Switched to context "eks-juego".`); return 0; } err(`error: no context exists with the name: "${pos[1] || ""}"`); return 1; }
  if (sub === "set-context"){
    if (f.namespace === undefined){ err("error: (simulador) kubectl config set-context --current --namespace=<ns>"); return 1; }
    S.defNs = f.namespace === "default" || f.namespace === "" ? null : f.namespace;
    out(`Context "eks-juego" modified.`); nota(`(ahora, sin -n, trabajas en «${f.namespace || "default"}». Acuérdate de cambiarlo al pasar de nivel.)`); return 0;
  }
  if (sub === "view"){ out(`apiVersion: v1\nclusters:\n- cluster:\n    certificate-authority-data: DATA+OMITTED\n    server: https://0A1B2C3D4E5F60718293A4B5C6D7E8F9.yl4.${REGION}.eks.amazonaws.com\n  name: ${ctx}\ncontexts:\n- context:\n    cluster: ${ctx}\n    namespace: ${S.defNs || "default"}\n    user: ${ctx}\n  name: eks-juego\ncurrent-context: eks-juego\nkind: Config\nusers:\n- name: ${ctx}\n  user:\n    exec:\n      apiVersion: client.authentication.k8s.io/v1beta1\n      args:\n      - --region\n      - ${REGION}\n      - eks\n      - get-token\n      - --cluster-name\n      - ${CLUSTER}\n      command: aws\n      env:\n      - name: AWS_PROFILE\n        value: laboratorio`); return 0; }
  err("error: (simulador) config current-context | get-contexts | use-context | set-context --current --namespace=<ns> | view"); return 1;
}
function kAuth(pos, f, ns){
  if (pos[0] === "whoami"){ out(tabla([["ATTRIBUTE","VALUE"],["Username",`arn:aws:sts::${CUENTA}:assumed-role/AWSReservedSSO_Admin_0123456789abcdef/jugador`],["UID","aws-iam-authenticator:"+CUENTA+":AROA00000000000000000"],["Groups","[system:authenticated]"]])); return 0; }
  if (pos[0] !== "can-i"){ err("error: (simulador) kubectl auth can-i <verbo> <recurso> [--as=…] · kubectl auth whoami"); return 1; }
  const como = typeof f.as === "string" ? f.as : null;
  if (como && !/^system:serviceaccount:[^:]+:.+$/.test(como)){ aviso("(simulador) --as solo admite ServiceAccounts: --as=system:serviceaccount:<ns>:<nombre>"); return 1; }
  if (como){ const m = como.match(/^system:serviceaccount:([^:]+):(.+)$/); if (!obj("ServiceAccount", m[1], m[2])) aviso(`(ojo: la ServiceAccount ${m[1]}/${m[2]} no existe)`); }
  if (f.list){
    const filas = [["Resources","Non-Resource URLs","Resource Names","Verbs"]];
    if (!como){ filas.push(["*.*","[]","[]","[*]"]); out(tabla(filas)); return 0; }
    const m = como.match(/^system:serviceaccount:([^:]+):(.+)$/);
    filas.push(["selfsubjectreviews.authentication.k8s.io","[]","[]","[create]"], ["selfsubjectaccessreviews.authorization.k8s.io","[]","[]","[create]"]);
    for (const rb of objs("RoleBinding", ns)) if ((rb.subjects || []).some(s => s.kind === "ServiceAccount" && s.name === m[2] && (s.namespace || ns) === m[1])){
      const reglas = rb.roleRef.kind === "ClusterRole" ? CLUSTERROLES[rb.roleRef.name] : (obj("Role", ns, rb.roleRef.name) || {}).rules || [];
      for (const r of reglas) filas.push([(r.resources || []).join(","), "[]", "[]", `[${(r.verbs || []).join(" ")}]`]);
    }
    out(tabla(filas)); return 0;
  }
  const verbo = pos[1], rec = pos[2];
  if (!verbo || !rec){ err("error: you must specify two arguments: verb resource or a resourceName"); return 1; }
  const r = recurso(rec.split("/")[0]);
  if (!r){ aviso(`Warning: the server doesn't have a resource type '${rec}'`); out("no"); return 1; }
  if (!["get","list","watch","create","update","patch","delete","deletecollection","*"].includes(verbo)) aviso(`Warning: verb '${verbo}' is not a known verb`);
  const si = puede(como, verbo, r.plural + (rec.includes("/") ? "/" + rec.split("/")[1] : ""), f.A ? null : ns);
  out(si ? "yes" : "no"); JUEGO.marca("can-i"); return si ? 0 : 1;
}

/* ============================== aws ============================== */
function aws(a){
  const {f, pos} = flags(a, "aws");
  const [serv, op] = pos;
  if (!serv){ out("usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]"); return 0; }
  if (f.profile && f.profile !== "laboratorio"){ nota(`(simulador: el perfil «${f.profile}» no cambia nada; todo está en la cuenta de laboratorio ${CUENTA}. En tu PC real, comprueba SIEMPRE la cuenta con aws sts get-caller-identity)`); }
  if (f.region && f.region !== REGION){ err(`(simulador) en ${f.region} no hay nada: todo está en ${REGION}`); return 1; }
  const salida = (o) => {
    let v = o;
    if (f.query){ try { v = jmes(o, f.query); } catch(e){ err(`Bad value for --query ${f.query}: ${e.message}`); return 1; } }
    if (f.output === "text"){
      const txt = x => x === null || x === undefined ? "None" : Array.isArray(x) ? (x.every(y => !Array.isArray(y) && (y === null || typeof y !== "object")) ? x.map(txt).join("\t") : x.map(txt).join("\n")) : typeof x === "object" ? Object.values(x).map(txt).join("\t") : String(x);
      out(txt(v));
    } else if (f.output === "table"){ out(Array.isArray(v) ? tabla([["-"], ...v.map(x => [Array.isArray(x) ? x.join(" | ") : typeof x === "object" ? JSON.stringify(x) : x])]) : JSON.stringify(v, null, 4)); }
    else out(JSON.stringify(v, null, 4));
    return 0;
  };
  if (serv === "sts" && op === "get-caller-identity") return salida({UserId:"AROA3EXAMPLEEXAMPLE:jugador", Account:CUENTA, Arn:`arn:aws:sts::${CUENTA}:assumed-role/AWSReservedSSO_Admin_0123456789abcdef/jugador`});
  if (serv === "sso" && op === "login"){ out("(simulador) Sesión SSO renovada. En tu PC real se abriría el navegador."); return 0; }
  if (serv === "eks"){
    const clusterOk = () => { if (f.name !== CLUSTER && f["cluster-name"] !== CLUSTER){ err(`An error occurred (ResourceNotFoundException) when calling the ${opNombre(op)} operation: No cluster found for name: ${f.name || f["cluster-name"] || "(vacío)"}.`); return false; } return true; };
    if (op === "list-clusters") return salida({clusters:[CLUSTER]});
    if (op === "describe-cluster"){ if (!clusterOk()) return 1;
      return salida({cluster:{name:CLUSTER, arn:`arn:aws:eks:${REGION}:${CUENTA}:cluster/${CLUSTER}`, createdAt:new Date(Date.now() - (ahora() - S.creado) * 1000 - 86400000).toISOString(), version:K8S_MINOR, endpoint:`https://0A1B2C3D4E5F60718293A4B5C6D7E8F9.yl4.${REGION}.eks.amazonaws.com`, roleArn:`arn:aws:iam::${CUENTA}:role/eks-juego-cluster-role`,
        resourcesVpcConfig:{subnetIds:["subnet-0a1b2c3d4e5f60001","subnet-0a1b2c3d4e5f60002"], clusterSecurityGroupId:"sg-0a1b2c3d4e5f60003", vpcId:"vpc-0a1b2c3d4e5f60004", endpointPublicAccess:true, endpointPrivateAccess:true, publicAccessCidrs:["0.0.0.0/0"]},
        kubernetesNetworkConfig:{serviceIpv4Cidr:"172.20.0.0/16", ipFamily:"ipv4"}, status:"ACTIVE", platformVersion:"eks.12", accessConfig:{authenticationMode:"API"}, upgradePolicy:{supportType:"STANDARD"}, tags:{Project:"eks-juego"}}}); }
    if (op === "list-nodegroups"){ if (!clusterOk()) return 1; return salida({nodegroups:[NG]}); }
    if (op === "describe-nodegroup" || op === "update-nodegroup-config"){
      if (!clusterOk()) return 1;
      if (f["nodegroup-name"] !== NG){ err(`An error occurred (ResourceNotFoundException) when calling the ${opNombre(op)} operation: No node group found for name: ${f["nodegroup-name"] || "(vacío)"}.`); return 1; }
      if (op === "describe-nodegroup") return salida({nodegroup:{nodegroupName:NG, clusterName:CLUSTER, version:K8S_MINOR, releaseVersion:"1.36.4-20261119", status:S.uniendo.length || S.nodes.some(n => n.terminando) ? "UPDATING" : "ACTIVE", capacityType:"ON_DEMAND", scalingConfig:{minSize:S.ng.min, maxSize:S.ng.max, desiredSize:S.ng.desired}, instanceTypes:["t3.medium"], subnets:["subnet-0a1b2c3d4e5f60001","subnet-0a1b2c3d4e5f60002"], amiType:"AL2023_x86_64_STANDARD", nodeRole:`arn:aws:iam::${CUENTA}:role/eks-juego-node-role`, labels:{juego:"eks-quest"}, resources:{autoScalingGroups:[{name:"eks-ng-juego-a2c6e5f0-1b2c-3d4e-5f60-7a8b9c0d1e2f"}]}, health:{issues:[]}, updateConfig:{maxUnavailable:1}}});
      const sc = String(f["scaling-config"] || ""); if (!sc){ err("aws: error: (simulador) falta --scaling-config minSize=…,maxSize=…,desiredSize=…"); return 1; }
      const v = {}; for (const par of sc.split(",")){ const [k, x] = par.split("="); if (!/^(minSize|maxSize|desiredSize)$/.test(k) || !/^\d+$/.test(x || "")){ err(`Error parsing parameter '--scaling-config': Expected: '=', received: '${par}' (formato: minSize=1,maxSize=2,desiredSize=2)`); return 1; } v[k] = parseInt(x, 10); }
      const nuevo = {min:v.minSize ?? S.ng.min, max:v.maxSize ?? S.ng.max, desired:v.desiredSize ?? S.ng.desired};
      if (nuevo.max < 1 || nuevo.min > nuevo.max || nuevo.desired > nuevo.max || nuevo.desired < nuevo.min){ err(`An error occurred (InvalidParameterException) when calling the UpdateNodegroupConfig operation: Minimum capacity ${nuevo.min} can't be greater than desired size ${nuevo.desired}`.replace(/Minimum.*/, nuevo.desired > nuevo.max ? `Desired capacity ${nuevo.desired} can't be greater than max size ${nuevo.max}` : nuevo.min > nuevo.max ? `Minimum capacity ${nuevo.min} can't be greater than max size ${nuevo.max}` : `Minimum capacity ${nuevo.min} can't be greater than desired size ${nuevo.desired}`)); return 1; }
      if (nuevo.max > 4){ err("(simulador) en el laboratorio el máximo son 4 nodos (cada uno cuesta 0,0456 $/h)"); return 1; }
      S.ng = nuevo; reconciliar();
      return salida({update:{id:uid(), status:"InProgress", type:"ConfigUpdate", params:Object.entries(v).map(([k, x]) => ({type:k.charAt(0).toUpperCase() + k.slice(1), value:String(x)})), createdAt:new Date().toISOString(), errors:[]}});
    }
    if (op === "update-kubeconfig"){ if (!clusterOk()) return 1; out(`Updated context ${f.alias || `arn:aws:eks:${REGION}:${CUENTA}:cluster/${CLUSTER}`} in ~/.kube/config`); return 0; }
    const ADDONS = {"coredns":"v1.14.7-eksbuild.35", "eks-pod-identity-agent":"v1.5.0-eksbuild.3", "kube-proxy":"v1.36.0-eksbuild.65", "metrics-server":"v0.9.1-eksbuild.2", "vpc-cni":"v1.23.3-eksbuild.2"};
    if (op === "list-addons"){ if (!clusterOk()) return 1; return salida({addons:Object.keys(ADDONS)}); }
    if (op === "describe-addon"){
      if (!clusterOk()) return 1;
      const nom = f["addon-name"]; if (!nom || nom === true){ err("aws: error: the following arguments are required: --addon-name"); return 1; }
      if (!ADDONS[nom]){ err(`An error occurred (ResourceNotFoundException) when calling the DescribeAddon operation: No addon: ${nom} found in cluster: ${CLUSTER}`); return 1; }
      return salida({addon:{addonName:nom, clusterName:CLUSTER, status:"ACTIVE", addonVersion:ADDONS[nom], health:{issues:[]}, addonArn:`arn:aws:eks:${REGION}:${CUENTA}:addon/${CLUSTER}/${nom}/0a1b2c3d`, createdAt:new Date(Date.now() - 86400000).toISOString(), tags:{}}});
    }
    S.podIdentity = S.podIdentity || [];
    if (op === "create-pod-identity-association"){
      if (!clusterOk()) return 1;
      const faltan = ["namespace","service-account","role-arn"].filter(k => !f[k] || f[k] === true);
      if (faltan.length){ err(`aws: error: the following arguments are required: ${faltan.map(k => "--" + k).join(", ")}`); return 1; }
      if (!/^arn:aws:iam::\d{12}:role\/[\w+=,.@\/-]+$/.test(f["role-arn"])){ err(`An error occurred (InvalidParameterException) when calling the CreatePodIdentityAssociation operation: Invalid role ARN: ${f["role-arn"]}`); return 1; }
      if (S.podIdentity.some(a => a.ns === f.namespace && a.sa === f["service-account"])){ err(`An error occurred (ResourceInUseException) when calling the CreatePodIdentityAssociation operation: Association already exists for namespace ${f.namespace} and service account ${f["service-account"]}`); return 1; }
      const a = {id:"a-" + hash(f.namespace + f["service-account"] + ahora()).toString(36).padEnd(17, "0").slice(0, 17), ns:String(f.namespace), sa:String(f["service-account"]), role:String(f["role-arn"])};
      S.podIdentity.push(a);
      salida({association:{clusterName:CLUSTER, namespace:a.ns, serviceAccount:a.sa, roleArn:a.role, associationArn:`arn:aws:eks:${REGION}:${CUENTA}:podidentityassociation/${CLUSTER}/${a.id}`, associationId:a.id, createdAt:new Date().toISOString()}});
      nota("(los Pods que YA existen no la ven: las variables se inyectan al CREAR el Pod. Reinícialos: kubectl rollout restart …)"); return 0;
    }
    if (op === "list-pod-identity-associations"){ if (!clusterOk()) return 1; return salida({associations:S.podIdentity.filter(a => !f.namespace || a.ns === f.namespace).map(a => ({clusterName:CLUSTER, namespace:a.ns, serviceAccount:a.sa, associationId:a.id}))}); }
    if (op === "describe-pod-identity-association"){ if (!clusterOk()) return 1; const a = S.podIdentity.find(x => x.id === f["association-id"]); if (!a){ err(`An error occurred (ResourceNotFoundException) when calling the DescribePodIdentityAssociation operation: No association found for id: ${f["association-id"] || ""}`); return 1; } return salida({association:{clusterName:CLUSTER, namespace:a.ns, serviceAccount:a.sa, roleArn:a.role, associationId:a.id}}); }
    if (op === "delete-pod-identity-association"){ if (!clusterOk()) return 1; const i = S.podIdentity.findIndex(x => x.id === f["association-id"]); if (i < 0){ err(`An error occurred (ResourceNotFoundException) when calling the DeletePodIdentityAssociation operation: No association found for id: ${f["association-id"] || ""}`); return 1; } const [a] = S.podIdentity.splice(i, 1); return salida({association:{namespace:a.ns, serviceAccount:a.sa, associationId:a.id}}); }
    err(`(simulador) «aws eks ${op || ""}» no está. Disponibles: list-clusters, describe-cluster, list-nodegroups, describe-nodegroup, update-nodegroup-config, update-kubeconfig, list-addons`); return 1;
  }
  if (serv === "ec2"){
    const inst = n => ({InstanceId:n.id, InstanceType:"t3.medium", State:{Code:n.terminando ? 32 : 16, Name:n.terminando ? "shutting-down" : "running"}, PrivateIpAddress:n.ip, PrivateDnsName:n.name, Placement:{AvailabilityZone:n.az}, ImageId:"ami-091cdf1e1e565fdae", LaunchTime:new Date(Date.now() - (ahora() - n.creado) * 1000).toISOString(), Tags:[{Key:"eks:nodegroup-name", Value:NG}, {Key:"eks:cluster-name", Value:CLUSTER}, {Key:"Name", Value:"eks-juego-ng-juego-Node"}, {Key:"Project", Value:"eks-juego"}]});
    if (op === "describe-instances"){
      let lista = S.nodes;
      if (f["instance-ids"]) { const ids = String(f["instance-ids"]).split(/[ ,]/); lista = lista.filter(n => ids.includes(n.id)); if (!lista.length){ err(`An error occurred (InvalidInstanceID.NotFound) when calling the DescribeInstances operation: The instance ID '${ids[0]}' does not exist`); return 1; } }
      return salida({Reservations:lista.map(n => ({ReservationId:"r-0" + hash(n.id).toString(16), OwnerId:CUENTA, Instances:[inst(n)]}))});
    }
    if (op === "terminate-instances"){
      if (!f["instance-ids"]){ err("aws: error: the following arguments are required: --instance-ids"); return 1; }
      const ids = String(f["instance-ids"]).split(/[ ,]/).filter(Boolean); const res = [];
      for (const id of ids){ const n = S.nodes.find(x => x.id === id); if (!n){ err(`An error occurred (InvalidInstanceID.NotFound) when calling the TerminateInstances operation: The instance ID '${id}' does not exist`); return 1; }
        const prev = n.terminando ? "shutting-down" : "running"; n.terminando = true; n.finT = ahora() + 3; n.unsched = true;
        res.push({InstanceId:id, CurrentState:{Code:32, Name:"shutting-down"}, PreviousState:{Code:prev === "running" ? 16 : 32, Name:prev}}); }
      salida({TerminatingInstances:res}); nota("(el ASG del node group lanzará otra instancia para mantener desiredSize: tarda unos segundos en el juego, 2-4 min en AWS)"); reconciliar(); return 0;
    }
    err(`(simulador) «aws ec2 ${op || ""}» no está. Disponibles: describe-instances, terminate-instances`); return 1;
  }
  if (serv === "ssm"){
    if (op === "start-session"){
      const n = S.nodes.find(x => x.id === f.target);
      if (!f.target){ err("aws: error: the following arguments are required: --target"); return 1; }
      if (!n){ err(`An error occurred (TargetNotConnected) when calling the StartSession operation: ${f.target} is not connected.`); return 1; }
      const sesion = "jugador-" + hash(n.id + ahora()).toString(16);
      out(`\nStarting session with SessionId: ${sesion}`);
      MODO = {tipo:"nodo", id:n.id, sesion, prompt:"sh-5.2$ "}; JUEGO.cambioPrompt(); return 0;
    }
    if (op === "send-command"){ out(JSON.stringify({Command:{CommandId:uid(), DocumentName:f["document-name"] || "AWS-RunShellScript", Status:"Pending"}}, null, 4)); nota("(simulador) el comando no se ejecuta de verdad; para hacer cosas en un nodo usa aws ssm start-session --target <i-…>"); return 0; }
  }
  if (serv === "iam"){
    const ROLES = [
      {RoleName:"AWSServiceRoleForAmazonEKS", Path:"/aws-service-role/eks.amazonaws.com/"},
      {RoleName:"AWSServiceRoleForAmazonEKSNodegroup", Path:"/aws-service-role/eks-nodegroup.amazonaws.com/"},
      {RoleName:"eks-juego-cluster-role", Path:"/"}, {RoleName:"eks-juego-node-role", Path:"/"}, {RoleName:"eks-quest-s3-subidor", Path:"/"}];
    const rol = x => Object.assign({}, x, {RoleId:"AROA" + hash(x.RoleName).toString(36).toUpperCase().padEnd(17, "X").slice(0, 17), Arn:`arn:aws:iam::${CUENTA}:role${x.Path}${x.RoleName}`, CreateDate:"2026-11-26T09:00:00+00:00"});
    if (op === "list-roles") return salida({Roles:ROLES.slice(0, parseInt(f["max-items"] || "100", 10)).map(rol)});
    if (op === "get-role"){ const x = ROLES.find(z => z.RoleName === f["role-name"]); if (!x){ err(`An error occurred (NoSuchEntity) when calling the GetRole operation: The role with name ${f["role-name"] || ""} cannot be found.`); return 1; }
      const conf = x.RoleName === "eks-quest-s3-subidor" ? {Service:"pods.eks.amazonaws.com"} : x.RoleName.includes("node") ? {Service:"ec2.amazonaws.com"} : {Service:"eks.amazonaws.com"};
      return salida({Role:Object.assign(rol(x), {AssumeRolePolicyDocument:{Version:"2012-10-17", Statement:[{Effect:"Allow", Principal:conf, Action:conf.Service.startsWith("pods") ? ["sts:AssumeRole","sts:TagSession"] : "sts:AssumeRole"}]}})}); }
    if (op === "list-attached-role-policies"){ const n = f["role-name"]; const pol = {"eks-juego-node-role":["AmazonEKSWorkerNodePolicy","AmazonEKS_CNI_Policy","AmazonEC2ContainerRegistryReadOnly","AmazonSSMManagedInstanceCore"], "eks-juego-cluster-role":["AmazonEKSClusterPolicy"], "eks-quest-s3-subidor":["AmazonS3FullAccess"]}[n];
      if (!pol){ err(`An error occurred (NoSuchEntity) when calling the ListAttachedRolePolicies operation: The role with name ${n || ""} cannot be found.`); return 1; }
      return salida({AttachedPolicies:pol.map(x => ({PolicyName:x, PolicyArn:`arn:aws:iam::aws:policy/${x}`}))}); }
  }
  if (serv === "configure"){
    if (op === "list"){ out(`      Name                    Value             Type    Location
      ----                    -----             ----    --------
   profile              laboratorio           manual    --profile
access_key     ****************WXYZ              sso    
secret_key     ****************abcd              sso    
    region                eu-west-1      config-file    ~/.aws/config`); return 0; }
    if (op === "get"){ const k = pos[2]; if (k === "region"){ out(REGION); return 0; } if (k === "output"){ out("json"); return 0; } return 1; }
    if (op === "list-profiles"){ out("laboratorio"); return 0; }
  }
  err(`(simulador) «aws ${serv} ${op || ""}» no está disponible. Hay: sts get-caller-identity · eks … · ec2 describe-instances|terminate-instances · ssm start-session`); return 1;
}
function opNombre(op){ return String(op || "").split("-").map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(""); }
