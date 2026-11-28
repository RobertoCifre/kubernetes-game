/* ============================================================================
   ui.js — interfaz: terminal, panel de misión, mapa de niveles, mapa del
   cluster, editor YAML, visor de chuletas y partida guardada.
   ========================================================================== */
"use strict";

const VERSION_JUEGO = "3.2";
const CLAVE_PARTIDA = "eksquest3";
const NUEVOS_AL_PRINCIPIO = 6;   // la v3.1 metió 6 niveles nuevos delante: los de la v2/3.0 suben 6 puestos
let P = {hechos:{}, actual:1, pistas:{}, solucion:{}};
let SUPERADO_AHORA = false;
const $ = id => document.getElementById(id);
const escHTML = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- partida ---------- */
function guardarPartida(){ try { localStorage.setItem(CLAVE_PARTIDA, JSON.stringify(P)); } catch(e){} }
function cargarPartida(){
  try {
    const j = JSON.parse(localStorage.getItem(CLAVE_PARTIDA));
    if (j && j.hechos){ P = Object.assign({hechos:{}, actual:1, pistas:{}, solucion:{}}, j); P.actual = primerBloqueado() > P.actual ? P.actual : (siguientePendiente(1) || 1); return "ok"; }
    const v2 = JSON.parse(localStorage.getItem("eksquest2"));
    if (v2 && v2.hechos){
      const mueve = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [String(parseInt(k, 10) + NUEVOS_AL_PRINCIPIO), v]));
      P = {hechos:mueve(v2.hechos), actual:1, pistas:mueve(v2.pistas), solucion:mueve(v2.solucion)};
      P.actual = siguientePendiente(1) || 1; guardarPartida(); return "migrada";
    }
    const viejo = JSON.parse(localStorage.getItem("eksquest"));
    if (viejo && viejo.nivel){
      const mapa = {1:1, 2:4, 3:8, 4:10, 5:12, 6:17, 7:15, 8:34, 9:24, 10:37, 11:40, 12:49};
      for (let k = 1; k < viejo.nivel && k <= 12; k++) P.hechos[mapa[k] + NUEVOS_AL_PRINCIPIO] = 100;
      P.actual = siguientePendiente(1) || 1; guardarPartida(); return "migrada";
    }
  } catch(e){}
  return "nueva";
}
const xpTotal = () => Object.values(P.hechos).reduce((a, b) => a + b, 0);
const RANGOS = [[0, "🐣 Becario de Kubernetes"], [300, "📦 Junior de pods"], [900, "🔧 Operador de cluster"], [2000, "🛠️ Administrador EKS"],
                [3300, "🚒 SRE de guardia"], [4600, "🔬 Cirujano de contenedores"], [6000, "👑 Maestro EKS"], [7300, "🎓 Listo para la CKA"]];
function rangoDe(x){ let r = RANGOS[0][1]; for (const [d, n] of RANGOS) if (x >= d) r = n; return r; }
function rango(){ return rangoDe(xpTotal()); }
function proximoRango(){ const x = xpTotal(); const s = RANGOS.find(([d]) => d > x); return s ? {nombre:s[1], faltan:s[0] - x} : null; }
function primerBloqueado(){ for (let k = 1; k <= MAX; k++) if (!(k in P.hechos)) return k + 1; return MAX + 1; }   // el primero sin hacer está abierto; los de después, cerrados
function desbloqueado(id){ return id >= 1 && id <= MAX && id < primerBloqueado(); }
function irANivel(id){
  if (!id){ irA(null); return; }
  if (!desbloqueado(id)){ const p = siguientePendiente(1); out(`🔒 El nivel ${id} está bloqueado: los niveles se desbloquean en orden. Ahora te toca el nivel ${p} («${NIVELES[p].t}»). Escribe «nivel ${p}».`, "c-am"); return; }
  irA(id);
}
function siguientePendiente(desde){ for (let k = desde; k <= MAX; k++) if (!(k in P.hechos)) return k; for (let k = 1; k < desde; k++) if (!(k in P.hechos)) return k; return null; }

/* ---------- salida en pantalla ---------- */
function pintarSalida(t, cls){
  const sal = $("salida"); if (!sal) { (typeof SALIDA_PRUEBAS !== "undefined") && SALIDA_PRUEBAS.push({t, cls}); return; }
  const d = document.createElement("div");
  if (cls === "c-cian-sin-prompt"){ d.className = "c-cian"; d.textContent = t; }
  else { if (cls) d.className = cls; d.textContent = t; }
  sal.appendChild(d);
  while (sal.childNodes.length > 1500) sal.removeChild(sal.firstChild);
  sal.scrollTop = sal.scrollHeight;
}
function pintarHTML(h){ const sal = $("salida"); if (!sal){ (typeof SALIDA_PRUEBAS !== "undefined") && SALIDA_PRUEBAS.push({t:h.replace(/<[^>]+>/g, ""), cls:"html"}); return; } const d = document.createElement("div"); d.innerHTML = h; sal.appendChild(d); sal.scrollTop = sal.scrollHeight; }

/* ---------- el juego ---------- */
const NIVEL = () => NIVELES[P.actual];
const JUEGO = {
  nivelNs(){ const n = NIVEL(); if (!n) return null; const ns = `nivel-${n.id}`; return S && S.ns[ns] ? ns : null; },
  esPregunta(){ return NIVEL() && NIVEL().tipo === "pregunta"; },
  cambioPrompt(){ const p = $("prompt"); if (p) p.textContent = MODO ? MODO.prompt.trim() : "$"; },
  trasComando(){ if (typeof document !== "undefined" && $("mapa")) pintarPanel(); comprobar(true); },
  marca(que){ if (que === "curl-lb" && S.datos) S.datos.curlLB = true; },
  alBorrar(o){},
  comando(c, args){
    switch (c){
      case "help": case "ayuda": case "?": ayuda(args[0]); return true;
      case "clear": case "cls": { const s = $("salida"); if (s) s.innerHTML = ""; return true; }
      case "mision": case "misión": mostrarMision(); return true;
      case "pista": pedirPista(); return true;
      case "comprobar": comprobar(false); return true;
      case "responder": responder(args.join(" ")); return true;
      case "siguiente": { if (!(P.actual in P.hechos)){ out(`Primero supera el nivel ${P.actual}: los niveles van en orden. ¿Atascado? «pista» (−20 XP) o «solucion».`, "c-am"); return true; }
        irANivel(P.actual >= MAX ? null : P.actual + 1); return true; }
      case "anterior": irANivel(Math.max(1, P.actual - 1)); return true;
      case "nivel": { const n = parseInt(args[0], 10); if (!(n >= 1 && n <= MAX)){ out(`Uso: nivel <1-${MAX}>`, "c-am"); return true; } irANivel(n); return true; }
      case "repetir": case "reiniciar": irA(P.actual); return true;
      case "solucion": case "solución": verSolucion(); return true;
      case "mapa": mapaTexto(); return true;
      case "chuletas": case "chuleta": abrirChuletas(args[0]); return true;
      case "progreso": case "estado": case "rango": { const pr = proximoRango(); out(`${rango()} · ${xpTotal()} XP · ${Object.keys(P.hechos).length}/${MAX} niveles${pr ? ` · siguiente rango: ${pr.nombre} (faltan ${pr.faltan} XP)` : " · rango máximo"}`, "c-mag"); return true; }
    }
    return false;
  },
};
function nsDelNivel(n){ return S && S.ns && S.ns["nivel-" + n.id] ? "nivel-" + n.id : null; }
function lineaNs(n){ const ns = nsDelNivel(n); return ns ? `📁 Namespace de este nivel: ${ns}  →  añade  -n ${ns}  a tus comandos (en este juego el namespace es siempre «nivel-» + el número del nivel)` : "📁 Este nivel no tiene namespace propio: se trabaja con los nodos, con kube-system o con AWS"; }
function textoMision(n){ return `━━━ NIVEL ${n.id} · ${MUNDOS[n.mundo - 1]} · ${n.t} ━━━\n${n.m}`; }
function mostrarMision(){ const n = NIVEL(); out(textoMision(n), "c-am"); out(lineaNs(n), "c-cian"); if (n.trasMision) n.trasMision(); }
function irA(id){
  if (!id){ out("🏆 ¡Has superado los 76 niveles! Ahora, a practicarlo en un cluster de verdad: kind o minikube en tu PC, o un EKS de pruebas.", "c-ok"); return; }
  P.actual = id; guardarPartida(); SUPERADO_AHORA = false;
  MODO = null; JUEGO.cambioPrompt();
  estadoBase();
  try { NIVEL().prep(); } catch(e){ out("Error preparando el nivel: " + e.message, "c-err"); }
  reconciliar();
  out("");
  mostrarMision();
  if (NIVEL().tipo === "pregunta") out("(nivel de PREGUNTA: investiga con kubectl/aws y contesta con «responder <valor>»)", "c-dim");
  else out("(nivel de MISIÓN: se supera solo en cuanto el cluster quede bien)", "c-dim");
  if (typeof document !== "undefined" && $("mapa")) pintarPanel();
}
function pedirPista(){
  const n = NIVEL(); const k = P.pistas[n.id] || 0;
  if (k >= n.p.length){ out("No hay más pistas en este nivel. Si sigues atascado: «solucion» (el nivel valdrá 0 XP).", "c-am"); return; }
  P.pistas[n.id] = k + 1; guardarPartida();
  out(`💡 Pista ${k + 1}/${n.p.length} (−20 XP): ${n.p[k]}`, "c-am");
  if (typeof document !== "undefined" && $("mapa")) pintarPanel();
}
function verSolucion(){
  const n = NIVEL();
  if (!P.solucion[n.id] && typeof confirm === "function" && typeof document !== "undefined" && !confirm("¿Ver la solución? Si aún no lo has superado, este nivel valdrá 0 XP.")) return;
  P.solucion[n.id] = true; guardarPartida();
  out("📖 Solución:\n" + n.sol, "c-mag");
}
function pctTareas(n){ const t = n.tareas || []; if (!t.length) return 0; let b = 0; for (const x of t){ try { if (x.ok()) b++; } catch(e){} } return Math.round(100 * b / t.length); }
function premio(n){ if (Array.isArray(n.tareas)) return Math.round(Math.max(0, (P.solucion[n.id] && !(n.id in P.hechos) ? 0 : 100 - 20 * (P.pistas[n.id] || 0))) * pctTareas(n) / 100); return P.solucion[n.id] && !(n.id in P.hechos) ? 0 : Math.max(0, 100 - 20 * (P.pistas[n.id] || 0)); }
function superar(){
  const n = NIVEL(); if (SUPERADO_AHORA) return; SUPERADO_AHORA = true;
  const antes = P.hechos[n.id], xp = premio(n), rangoAntes = rango();
  P.hechos[n.id] = Math.max(antes || 0, xp); guardarPartida();
  const rangoAhora = rango();
  pintarHTML(`<div class="gana">✅ ¡NIVEL ${n.id} SUPERADO! ${antes === undefined ? `+${xp} XP` : xp > antes ? `mejoras a ${xp} XP` : "(ya lo tenías)"} · ${escHTML(rango())} · ${xpTotal()} XP<br><span class="aprende">📚 Qué has aprendido: ${escHTML(n.a)}</span><br><span class="c-dim">Escribe <b>siguiente</b> o pulsa ▶ para continuar.</span></div>`);
  if (rangoAhora !== rangoAntes){ const pr = proximoRango(); pintarHTML(`<div class="ascenso">🎖️ ¡ASCENSO! Ahora eres <b>${escHTML(rangoAhora)}</b>${pr ? `<br><span class="c-dim">Siguiente rango: ${escHTML(pr.nombre)} · te faltan ${pr.faltan} XP</span>` : "<br>Has llegado al rango máximo."}</div>`); }
  if (n.alSuperar) n.alSuperar();
  if (Object.keys(P.hechos).length === MAX) pintarHTML(`<div class="gana">🏆 ¡HAS COMPLETADO EKS QUEST! ${xpTotal()} XP · ${escHTML(rango())}<br>Siguiente paso: practícalo en un cluster de verdad (kind o minikube en tu PC, o un EKS de pruebas).</div>`);
  if (typeof document !== "undefined" && $("mapa")) pintarPanel();
}
function comprobar(silencio){
  if (!S || !NIVEL()) return;
  const n = NIVEL();
  if (n.tipo === "pregunta"){ if (!silencio) out("Este nivel es una pregunta: contesta con «responder <valor>».", "c-am"); return; }
  reconciliar();
  if (Array.isArray(n.tareas)){
    const pct = pctTareas(n);
    if (!silencio){ out(n.tareas.map((x, i) => { let b = false; try { b = x.ok(); } catch(e){} return `${b ? "✅" : "⬜"} ${i + 1}. ${x.t}`; }).join("\n") + `\nNota: ${pct} %  (se aprueba con 66 %)`, pct >= 66 ? "c-ok" : "c-am"); }
    if (pct >= 66 && premio(n) > (P.hechos[n.id] ?? -1)){ SUPERADO_AHORA = false; superar(); }
    else if (!silencio && pct < 66) out("❌ Todavía no llegas al 66 %. Sigue con otra tarea (son independientes).", "c-err");
    return;
  }
  let ok = false; try { ok = n.ok(); } catch(e){ ok = false; }
  if (ok) superar();
  else if (!silencio) out(SUPERADO_AHORA ? "Ya lo superaste: escribe «siguiente»." : "❌ Todavía no. Investiga con get / describe / logs, o pide una «pista».", SUPERADO_AHORA ? "c-dim" : "c-err");
}
function normalizar(s){ return String(s).trim().replace(/^["']|["']$/g, "").replace(/\.$/, "").replace(/^v(?=\d)/i, "").toLowerCase(); }
function responder(valor){
  const n = NIVEL();
  if (n.tipo !== "pregunta"){ out("Este nivel es una misión: arregla el cluster y se supera solo (o escribe «comprobar»).", "c-am"); return; }
  if (!valor){ out("Uso: responder <valor>", "c-am"); return; }
  const bueno = n.resp();
  const ok = n.acepta ? n.acepta(valor) : n.exacta ? valor.trim() === bueno : normalizar(valor) === normalizar(bueno);
  if (ok) superar();
  else {
    out(`❌ «${valor}» no es correcto.`, "c-err");
    if (n.id === 7 && parseInt(valor, 10) > 100) out("   Eso parecen IPs de una subnet. La pregunta es cuántos PODS caben en el NODO (kubectl describe node).", "c-am");
    if (n.exacta && normalizar(valor) === normalizar(bueno)) out("   Casi: aquí importan mayúsculas y minúsculas (es una contraseña).", "c-am");
  }
}
function mapaTexto(){
  let s = "";
  for (let m = 1; m <= MUNDOS.length; m++){
    const ids = NIVELES.filter(n => n && n.mundo === m).map(n => n.id);
    s += `\nMUNDO ${m} · ${MUNDOS[m - 1]}\n  ` + ids.map(i => `${i === P.actual ? "▶" : i in P.hechos ? "✅" : "·"}${String(i).padStart(2, " ")}`).join("  ");
  }
  out(s.trim(), "c-dim");
  out(`${Object.keys(P.hechos).length}/${MAX} superados · ${xpTotal()} XP · ${rango()}   (ir a uno: «nivel N»)`, "c-mag");
}
function ayuda(tema){
  out(`COMANDOS DEL JUEGO
  mision · pista (−20 XP) · comprobar · responder <x> · solucion (nivel a 0 XP)
  siguiente · anterior · nivel <N> · repetir · mapa · chuletas · progreso · clear
  sleep <seg>  → hace avanzar el reloj del cluster (para esperar a que algo arranque)

MIRAR      kubectl get pods|deploy|svc|ep|nodes|ns|cm|secret|hpa|jobs|cronjobs|quota|pdb|netpol|sa|roles|rolebindings|ds|rs|events|all
           [-n NS | -A] [-o wide|yaml|json|name|jsonpath='{…}'] [-l app=x] [-L etiqueta] [--show-labels] [--no-headers]
           kubectl describe <tipo> <nombre> -n NS        kubectl logs <pod>|deploy/<n>|job/<n> [--previous] -n NS
           kubectl get events -n NS     kubectl top nodes|pods     kubectl explain <campo>     kubectl api-resources
CREAR      kubectl create deployment|configmap|secret generic|namespace|job|cronjob|serviceaccount|role|rolebinding|quota …
           kubectl expose deployment <n> --port=80 [--target-port=…] [--type=LoadBalancer]     kubectl run <n> --image=…
           kubectl apply -f -   (abre un editor para escribir YAML)        kubectl autoscale deployment <n> --min --max --cpu-percent
CAMBIAR    kubectl edit <tipo> <n> -n NS   (editor YAML: Ctrl+S guarda, Esc cancela)
           kubectl set image|env|resources|selector …     kubectl scale … --replicas=N     kubectl patch … -p '{…}' [--type=json]
           kubectl label|taint|cordon|uncordon|drain …     kubectl rollout status|history|undo [--to-revision=N]|restart
DENTRO     kubectl exec <pod> -n NS -- <cmd>     kubectl exec -it <pod> -n NS -- sh   (shell; «exit» para salir)
           kubectl run t --rm -it --image=busybox:1.37 -n NS -- nslookup|wget …     kubectl port-forward svc/<n> 8080:80 -n NS
PERMISOS   kubectl auth can-i <verbo> <recurso> -n NS [--as=system:serviceaccount:NS:SA]     kubectl auth whoami
AWS        aws sts get-caller-identity · aws eks describe-cluster|describe-nodegroup|update-nodegroup-config …
           aws ec2 describe-instances|terminate-instances · aws ssm start-session --target <i-…>   (+ --query / --output text)
TUBERÍAS   | grep [-i -v -c] · | wc -l · | head · | tail · | sort · | awk '{print $1}' · | base64 -d        (y ; &&)
CONTEXTO   kubectl config current-context|get-contexts|set-context --current --namespace=NS

Atajos: k = kubectl · kgp, kgd, kgs, kgn, kd, kdp, kl, kex, kaf, ksd… (escribe «alias» para verlos todos) · kubens <ns> fija el namespace · ↑/↓ historial · Tab autocompleta · «kubectl <verbo> --help» trae ejemplos · 📚 Chuletas arriba a la derecha`, "c-dim");
}

/* ---------- panel ---------- */
function claseNivel(i){ return i === P.actual ? "lv act" : i in P.hechos ? (P.hechos[i] >= 100 ? "lv ok oro" : "lv ok") : desbloqueado(i) ? "lv" : "lv cerrado"; }
function pintarPanel(){
  if (!$("mapa")) return;
  const n = NIVEL();
  $("xp").textContent = `${xpTotal()} XP`; $("rango").textContent = rango();
  $("niv").textContent = `${Object.keys(P.hechos).length}/${MAX}`;
  $("prog").style.width = (Object.keys(P.hechos).length / MAX * 100) + "%";
  $("numnivel").textContent = `NIVEL ${n.id} · MUNDO ${n.mundo}: ${MUNDOS[n.mundo - 1].toUpperCase()}`;
  $("titulo").textContent = (n.id in P.hechos ? "✅ " : "") + n.t;
  $("tipo").textContent = n.tipo === "pregunta" ? "PREGUNTA · contesta con: responder <valor>" : "MISIÓN · se supera sola cuando el cluster queda bien";
  $("mision").textContent = n.m;
  if ($("nsnivel")) $("nsnivel").textContent = nsDelNivel(n) ? `📁 -n ${nsDelNivel(n)}` : "📁 sin namespace propio";
  const pr = proximoRango(); $("rango").title = pr ? `Siguiente rango: ${pr.nombre} (faltan ${pr.faltan} XP)` : "Rango máximo";
  const k = P.pistas[n.id] || 0;
  $("pistas").textContent = n.p.slice(0, k).map((x, i) => `💡 ${i + 1}. ${x}`).join("\n");
  $("btnSig").style.display = SUPERADO_AHORA || n.id in P.hechos ? "" : "none";
  // mapa de niveles
  let h = "";
  for (let m = 1; m <= MUNDOS.length; m++){
    h += `<div class="mundo"><div class="mtit">${m} · ${escHTML(MUNDOS[m - 1])}</div>`;
    for (const x of NIVELES.filter(z => z && z.mundo === m)) h += `<button class="${claseNivel(x.id)}" title="${escHTML(x.id + ". " + x.t + (x.id in P.hechos ? " · " + P.hechos[x.id] + " XP" : desbloqueado(x.id) ? "" : " · 🔒 bloqueado"))}" onclick="irANivel(${x.id})">${x.id}</button>`;
    h += `</div>`;
  }
  $("niveles").innerHTML = h;
  // mapa del cluster
  let c = `<div class="leyenda"><span class="pod ok"></span>listo <span class="pod esp"></span>no listo <span class="pod mal"></span>roto <span class="pod sys"></span>sistema</div>`;
  for (const nd of S.nodes){
    const ps = S.pods.filter(p => p.node === nd.name);
    const est = !nd.ready ? '<span class="c-err">NotReady</span>' : nd.terminando ? '<span class="c-am">terminando</span>' : nd.unsched ? '<span class="c-am">SchedulingDisabled</span>' : '<span class="c-ok">Ready</span>';
    c += `<div class="nodo${nd.ready ? "" : " off"}"><b>${escHTML(nd.name.split(".")[0])}</b> <span class="c-dim">${nd.az.slice(-2)}</span> ${est}${nd.taints.length ? ' <span class="c-am">taint</span>' : ""}<br>` +
      ps.map(p => `<span class="pod ${p.ns === "kube-system" ? "sys" : p.listo || p.fase === "Succeeded" ? "ok" : /BackOff|Error|OOM|Err|Config/.test(p.estado) ? "mal" : "esp"}" title="${escHTML(p.ns + "/" + p.name + " · " + p.estado)}"></span>`).join("") + `<span class="c-dim cnt">${ps.length}/${nd.alloc.pods}</span></div>`;
  }
  for (const u of S.uniendo) c += `<div class="nodo off">⏳ nodo nuevo arrancando (${u.az})…</div>`;
  const pend = S.pods.filter(p => !p.node && !p.efimero);
  if (pend.length) c += `<div class="nodo off">Pending: ${pend.map(p => `<span class="pod esp" title="${escHTML(p.ns + "/" + p.name)}"></span>`).join("")}</div>`;
  $("mapa").innerHTML = c;
}

/* ---------- editor (kubectl edit / apply) ---------- */
function abrirEditor(texto, alGuardar, titulo){
  if (typeof document === "undefined" || !document.body || !$("salida")){ if (typeof EDITOR_PRUEBAS !== "undefined") EDITOR_PRUEBAS.push({texto, alGuardar}); return; }
  const capa = document.createElement("div"); capa.className = "capa";
  capa.innerHTML = `<div class="caja"><div class="cab">✏️ ${escHTML(titulo || "editor")}</div><textarea spellcheck="false"></textarea><div class="pie"><span class="c-dim">Ctrl+S guarda · Esc cancela · Tab = 2 espacios</span><span><button data-a="no">Cancelar</button><button data-a="si" class="verde">Guardar</button></span></div></div>`;
  document.body.appendChild(capa);
  const ta = capa.querySelector("textarea"); ta.value = texto; ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0;
  const cerrar = guardar => { const v = ta.value; capa.remove(); $("cmd").focus(); if (guardar){ alGuardar(v); pintarPanel(); comprobar(true); } else out("Edit cancelled, no changes made.", "c-dim"); };
  capa.querySelector('[data-a="si"]').onclick = () => cerrar(true);
  capa.querySelector('[data-a="no"]').onclick = () => cerrar(false);
  ta.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s"){ e.preventDefault(); cerrar(true); }
    else if (e.key === "Escape"){ e.preventDefault(); cerrar(false); }
    else if (e.key === "Tab"){ e.preventDefault(); const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 2; }
  });
}

/* ---------- chuletas ---------- */
function mdAHtml(md){
  const lineas = md.replace(/\r/g, "").split("\n"); let h = "", enCodigo = false, codigo = [], enTabla = false, enLista = false;
  const inline = s => escHTML(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => /^https?:/.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : `<span class="enlace">${t}</span>`);
  const cerrarTabla = () => { if (enTabla){ h += "</table></div>"; enTabla = false; } };
  const cerrarLista = () => { if (enLista){ h += "</ul>"; enLista = false; } };
  for (const l of lineas){
    if (l.trim().startsWith("```")){ if (enCodigo){ h += `<pre>${escHTML(codigo.join("\n"))}</pre>`; codigo = []; enCodigo = false; } else { cerrarTabla(); cerrarLista(); enCodigo = true; } continue; }
    if (enCodigo){ codigo.push(l); continue; }
    if (/^\s*\|.*\|\s*$/.test(l)){
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;
      const celdas = l.trim().slice(1, -1).split("|").map(x => x.trim());
      if (!enTabla){ cerrarLista(); h += `<div class="tabla"><table><tr>${celdas.map(x => `<th>${inline(x)}</th>`).join("")}</tr>`; enTabla = true; }
      else h += `<tr>${celdas.map(x => `<td>${inline(x)}</td>`).join("")}</tr>`;
      continue;
    }
    cerrarTabla();
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))){ cerrarLista(); h += `<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`; continue; }
    if ((m = l.match(/^\s*[-*]\s+(.*)$/)) || (m = l.match(/^\s*\d+\.\s+(.*)$/))){ if (!enLista){ h += "<ul>"; enLista = true; } h += `<li>${inline(m[1])}</li>`; continue; }
    cerrarLista();
    if ((m = l.match(/^>\s?(.*)$/))){ h += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    if (/^---+\s*$/.test(l)){ h += "<hr>"; continue; }
    if (l.trim()) h += `<p>${inline(l)}</p>`;
  }
  cerrarTabla(); cerrarLista(); if (enCodigo) h += `<pre>${escHTML(codigo.join("\n"))}</pre>`;
  return h;
}
function abrirChuletas(cual){
  if (typeof document === "undefined" || !$("salida")) return;
  const nombres = Object.keys(CHULETAS);
  if (!nombres.length){ out("(esta copia del juego no trae chuletas)", "c-am"); return; }
  let actual = nombres.find(n => cual && n.toLowerCase().includes(String(cual).toLowerCase())) || nombres[0];
  const capa = document.createElement("div"); capa.className = "capa";
  capa.innerHTML = `<div class="caja ancha"><div class="cab"><span>📚 Chuletas</span><button data-a="x">Cerrar (Esc)</button></div><div class="pestanas"></div><div class="md"></div></div>`;
  document.body.appendChild(capa);
  const pintar = () => {
    capa.querySelector(".pestanas").innerHTML = nombres.map(n => `<button class="${n === actual ? "act" : ""}" data-n="${escHTML(n)}">${escHTML(n.replace(/^CHULETA-?/, "").replace(/\.md$/, "").replace(/-/g, " ") || "ÍNDICE")}</button>`).join("");
    capa.querySelector(".md").innerHTML = mdAHtml(CHULETAS[actual]); capa.querySelector(".md").scrollTop = 0;
    capa.querySelectorAll(".pestanas button").forEach(b => b.onclick = () => { actual = b.dataset.n; pintar(); });
  };
  pintar();
  const cerrar = () => { capa.remove(); document.removeEventListener("keydown", esc); $("cmd").focus(); };
  const esc = e => { if (e.key === "Escape") cerrar(); };
  document.addEventListener("keydown", esc);
  capa.querySelector('[data-a="x"]').onclick = cerrar;
  capa.addEventListener("click", e => { if (e.target === capa) cerrar(); });
}

/* ---------- arranque ---------- */
function bienvenida(estado){
  pintarHTML(`<pre class="logo">
 ███████╗██╗  ██╗███████╗     ██████╗ ██╗   ██╗███████╗███████╗████████╗
 ██╔════╝██║ ██╔╝██╔════╝    ██╔═══██╗██║   ██║██╔════╝██╔════╝╚══██╔══╝
 █████╗  █████╔╝ ███████╗    ██║   ██║██║   ██║█████╗  ███████╗   ██║
 ██╔══╝  ██╔═██╗ ╚════██║    ██║▄▄ ██║██║   ██║██╔══╝  ╚════██║   ██║
 ███████╗██║  ██╗███████║    ╚██████╔╝╚██████╔╝███████╗███████║   ██║
 ╚══════╝╚═╝  ╚═╝╚══════╝     ╚══▀▀═╝  ╚═════╝ ╚══════╝╚══════╝   ╚═╝  v${VERSION_JUEGO}</pre>`);
  out(`Cluster simulado «eks-juego» · cuenta de laboratorio · Kubernetes ${K8S_MINOR} · 1 nodo t3.medium.
76 niveles en 10 mundos, de «¿cómo se llama este Pod?» a mirar los cgroups por dentro. Se desbloquean en orden. Los comandos son los REALES de kubectl y aws: lo que aprendas aquí vale en EKS.
«help» = comandos · «mapa» = niveles · 📚 Chuletas arriba · ↑/↓ historial · Tab autocompleta.`, "c-dim");
  if (estado === "migrada") out("Partida anterior migrada: tus niveles superados se conservan con la nueva numeración (ahora hay 6 niveles nuevos al principio).", "c-am");
  if (estado === "ok" && Object.keys(P.hechos).length) out(`Partida recuperada: ${Object.keys(P.hechos).length}/${MAX} niveles · ${xpTotal()} XP. (El cluster se regenera al entrar en cada nivel.)`, "c-dim");
}
function arrancarUI(){
  const estado = cargarPartida();
  clusterNuevo();
  bienvenida(estado);
  irA(P.actual || 1);
  const inp = $("cmd"); const hist = []; let hi = 0;
  // en escritorio, el cursor ya en la terminal; en móvil no (el foco bajaría la página hasta el final y abriría el teclado)
  try { if (window.matchMedia && window.matchMedia("(min-width: 821px)").matches) inp.focus({preventScroll:true}); } catch(e){}
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter"){
      const v = inp.value; inp.value = ""; if (v.trim()){ hist.push(v); hi = hist.length; }
      if (!MODO) pintarSalida("$ " + v, "c-cian");
      try { ejecutarLinea(v); } catch(ex){ out("error interno del simulador: " + ex.message, "c-err"); console.error(ex); }
      pintarPanel(); comprobar(true);
    } else if (e.key === "ArrowUp"){ if (hi > 0){ hi--; inp.value = hist[hi]; } e.preventDefault(); }
    else if (e.key === "ArrowDown"){ if (hi < hist.length - 1){ hi++; inp.value = hist[hi]; } else { hi = hist.length; inp.value = ""; } e.preventDefault(); }
    else if (e.key === "Tab"){ e.preventDefault(); autocompletar(inp); }
    else if (e.key === "l" && e.ctrlKey){ e.preventDefault(); $("salida").innerHTML = ""; }
    else if (e.key === "c" && e.ctrlKey && !window.getSelection().toString()){ e.preventDefault(); if (MODO){ out("^C", "c-dim"); } else { pintarSalida("$ " + inp.value + "^C", "c-dim"); inp.value = ""; } }
  });
  document.addEventListener("click", e => { if (!window.getSelection().toString() && !e.target.closest(".capa") && !["BUTTON","A","TEXTAREA","INPUT"].includes(e.target.tagName)) inp.focus(); });
  setInterval(() => { reconciliar(); pintarPanel(); comprobar(true); }, 2000);
}
const PALABRAS = ["kubectl","kubens","alias","get","describe","logs","create","deployment","configmap","secret","generic","namespace","job","cronjob","serviceaccount","role","rolebinding","expose","set","image","env","resources","selector","scale","autoscale","rollout","status","history","undo","restart","edit","apply","patch","label","taint","cordon","uncordon","drain","delete","exec","run","port-forward","top","explain","config","current-context","set-context","auth","can-i","whoami","nodes","pods","deploy","svc","service","endpoints","events","hpa","jobs","cronjobs","quota","resourcequota","pdb","networkpolicy","sa","roles","rolebindings","ds","rs","all","--namespace=","--replicas=","--image=","--port=","--target-port=","--type=LoadBalancer","--ignore-daemonsets","--delete-emptydir-data","--from-literal=","--limits=memory=","--requests=cpu=","--requests=memory=","--previous","--show-labels","--no-headers","--overwrite","--to-revision=","--cpu-percent=","--min=","--max=","--schedule=","--verb=","--resource=","--role=","--clusterrole=","--serviceaccount=","--as=system:serviceaccount:","--current","--rm","-it","--type=json","-o","yaml","wide","jsonpath=","aws","eks","ec2","ssm","sts","get-caller-identity","describe-cluster","describe-nodegroup","update-nodegroup-config","describe-instances","terminate-instances","start-session","--cluster-name","eks-juego","--nodegroup-name","ng-juego","--scaling-config","minSize=1,maxSize=2,desiredSize=2","--instance-ids","--target","--query","--output","text","responder","pista","comprobar","mision","siguiente","solucion","mapa","chuletas","nivel","repetir","busybox:1.37","nginx:1.27-alpine","nginx:1.28-alpine","kube-system","coredns","nslookup","wget","-qO-"];
function autocompletar(inp){
  const v = inp.value; const partes = v.split(" "); const ult = partes.pop(); if (!ult) return;
  const nombres = [...S.pods.map(p => p.name), ...S.nodes.map(n => n.name), ...S.nodes.map(n => n.id), ...S.objs.map(o => o.metadata.name), ...Object.keys(S.ns), ...Object.keys(S.ns).map(n => "-n " + n)];
  const base = ult.includes("/") ? ult.split("/")[0] + "/" : "";
  const cand = [...new Set([...PALABRAS, ...nombres, ...nombres.map(n => base + n)])].filter(w => w.startsWith(ult) && w !== ult);
  if (cand.length === 1){ partes.push(cand[0]); inp.value = partes.join(" ") + (/[=:\/]$/.test(cand[0]) ? "" : " "); }
  else if (cand.length > 1){
    let comun = cand[0]; for (const c of cand) while (!c.startsWith(comun)) comun = comun.slice(0, -1);
    if (comun.length > ult.length){ partes.push(comun); inp.value = partes.join(" "); } else out(cand.slice(0, 30).join("   "), "c-dim");
  }
}
