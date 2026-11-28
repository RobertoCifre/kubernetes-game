/* ============================================================================
   niveles.js — los 66 niveles (misma especificación que docs/NIVELES.md)
   ========================================================================== */
"use strict";

/* ---------- ayudas para preparar niveles ---------- */
function mkNs(ns, labels){ crearNamespace(ns, labels); }
function mkDep(ns, nombre, o){
  o = o || {};
  const labels = Object.assign({app:nombre}, o.labels || {});
  const c = {name:o.cname || nombre, image:o.image || "nginx:1.27-alpine"};
  if (o.cmd) c.command = o.cmd;
  if (o.args) c.args = o.args;
  if (o.ports) c.ports = o.ports;
  if (o.env) c.env = o.env.map(e => e.cm ? {name:e.name, valueFrom:{configMapKeyRef:{name:e.cm[0], key:e.cm[1]}}} : e.secret ? {name:e.name, valueFrom:{secretKeyRef:{name:e.secret[0], key:e.secret[1]}}} : {name:e.name, value:e.value});
  if (o.req || o.lim){ c.resources = {}; if (o.req) c.resources.requests = o.req; if (o.lim) c.resources.limits = o.lim; }
  if (o.readiness) c.readinessProbe = o.readiness;
  if (o.liveness) c.livenessProbe = o.liveness;
  if (o.mounts) c.volumeMounts = o.mounts;
  if (o.csc) c.securityContext = o.csc;
  const spec = {containers:[c]};
  if (o.nodeSelector) spec.nodeSelector = o.nodeSelector;
  if (o.tolerations) spec.tolerations = o.tolerations;
  if (o.volumes) spec.volumes = o.volumes;
  if (o.psc) spec.securityContext = o.psc;
  if (o.sa) spec.serviceAccountName = o.sa;
  if (o.automount !== undefined) spec.automountServiceAccountToken = o.automount;
  if (o.inits) spec.initContainers = o.inits;
  return guardarObj({apiVersion:"apps/v1", kind:"Deployment", metadata:metaNueva(nombre, ns, {labels:{app:nombre}, annotations:Object.assign({}, o.anot || {})}),
    spec:{replicas:o.replicas === undefined ? 1 : o.replicas, selector:{matchLabels:{app:nombre}}, template:{metadata:{labels}, spec}}});
}
function mkSvc(ns, nombre, o){
  o = o || {};
  return guardarObj({apiVersion:"v1", kind:"Service", metadata:metaNueva(nombre, ns, {labels:{app:nombre}}),
    spec:{type:o.type || "ClusterIP", selector:o.selector || {app:nombre}, ports:[{port:o.port || 80, protocol:"TCP", targetPort:o.targetPort === undefined ? (o.port || 80) : o.targetPort}]}});
}
function mkCm(ns, nombre, data){ return guardarObj({apiVersion:"v1", kind:"ConfigMap", metadata:metaNueva(nombre, ns), data}); }
function mkSecret(ns, nombre, data){ const d = {}; for (const [k, v] of Object.entries(data)) d[k] = b64e(v); return guardarObj({apiVersion:"v1", kind:"Secret", type:"Opaque", metadata:metaNueva(nombre, ns), data:d}); }
const dObj = (ns, n) => obj("Deployment", ns, n);
function listos(ns, n){ const d = dObj(ns, n); return d ? podsDeDeployment(d).filter(p => p.listo).length : 0; }
function eps(ns, n){ const s = obj("Service", ns, n); return s ? endpointsDe(s).length : 0; }
function asegurarNodos(k){
  if (S.ng.max < k) S.ng.max = k;
  if (S.ng.desired < k) S.ng.desired = k;
  while (S.nodes.filter(n => !n.terminando).length < k){ S.uniendo = []; S.nodes.push(nuevoNodo(S.nodes.length % 2 ? "eu-west-1b" : "eu-west-1a")); }
  reconciliar();
}
const SCRIPT_PROCESADOR = 'if [ "$MODO" != "normal" ] && [ "$MODO" != "debug" ]; then echo "ERROR: falta la variable de entorno MODO (valores válidos: normal o debug)"; exit 1; fi; echo "Procesador arrancado en modo $MODO"; sleep 3600';
const SONDA_WGET_API = {exec:{command:["sh","-c",'wget -qO- -T 2 "$API_URL" > /dev/null']}, periodSeconds:5, timeoutSeconds:3};

const MUNDOS = ["Primeros pasos","Pods que no arrancan","Tráfico y salud","Actualizaciones y configuración","Capacidad y escalado","Seguridad y permisos","Guardia","Bajo el capó"];

/* ---------- los niveles ---------- */
const NIVELES = [null,
/* ===================== MUNDO 1 · Primeros pasos ===================== */
{ id:1, mundo:1, t:"Tu primer kubectl", tipo:"pregunta",
  m:"¡Bienvenido! Cada nivel vive en su propio NAMESPACE (una «carpeta» del cluster)\nque se llama nivel-<número del nivel>. Este es el nivel 1, así que su namespace es nivel-1,\ny tus comandos llevarán  -n nivel-1  (sin -n, kubectl mira en «default», donde no hay nada).\n\n¿Cómo se llama el Deployment que hay en nivel-1?\n\nResponde con:  responder <nombre>",
  prep(){ mkNs("nivel-1"); mkDep("nivel-1","hola"); },
  resp:() => "hola",
  p:["kubectl get deployments -n nivel-1","Prueba también sin -n: kubectl get deployments  → «No resources found in default namespace»","El nombre es la primera columna, NAME"],
  a:"kubectl get <tipo> -n <namespace> lista objetos. Los tipos se pueden abreviar (deployments → deploy) y sin -n kubectl usa el namespace «default».",
  sol:"kubectl get deployments -n nivel-1\nresponder hola" },
{ id:2, mundo:1, t:"¿Y el Pod?", tipo:"pregunta",
  m:"Un Deployment no ejecuta nada por sí mismo: crea PODS, que son los que corren la aplicación.\n¿Cómo se llama el Pod que ha creado el Deployment «saludo» en nivel-2?\n\nResponde con:  responder <nombre-completo-del-pod>",
  prep(){ mkNs("nivel-2"); mkDep("nivel-2","saludo"); },
  resp:() => (S.pods.filter(p => p.ns === "nivel-2" && !p.borrando && !p.efimero && p.labels.app === "saludo").sort((a, b) => b.creado - a.creado)[0] || {}).name || "",
  p:["kubectl get pods -n nivel-2","El nombre del Pod es el del Deployment + dos trozos aleatorios: saludo-xxxxxxxxxx-yyyyy","Cópialo entero: doble clic sobre el nombre lo selecciona"],
  a:"Los Pods los crea el Deployment (a través de un ReplicaSet), por eso su nombre lleva el del Deployment y un sufijo aleatorio. Si un Pod muere, el nuevo tendrá OTRO nombre.",
  sol:"kubectl get pods -n nivel-2\nresponder <el nombre que salga: saludo-…-…>" },
{ id:3, mundo:1, t:"La puerta de entrada", tipo:"pregunta",
  m:"Los Pods cambian de nombre y de IP. Un SERVICE es la dirección fija que hay delante de ellos.\n¿Cómo se llama el Service de nivel-3?\n\nResponde con:  responder <nombre>",
  prep(){ mkNs("nivel-3"); mkDep("nivel-3","web",{ports:[{containerPort:80}]}); mkSvc("nivel-3","entrada",{selector:{app:"web"}}); },
  resp:() => "entrada",
  p:["kubectl get services -n nivel-3","Abreviado: kubectl get svc -n nivel-3","Ojo: el Service no tiene por qué llamarse como el Deployment"],
  a:"kubectl get svc muestra los Services: nombre, tipo, IP interna (CLUSTER-IP) y puertos. Los demás Pods del cluster llegan a la aplicación por el NOMBRE del Service.",
  sol:"kubectl get svc -n nivel-3\nresponder entrada" },
{ id:4, mundo:1, t:"¿Qué imagen usa?", tipo:"pregunta",
  m:"Cada Pod ejecuta una IMAGEN de contenedor (nombre:versión).\n¿Qué imagen usa el Deployment «tienda» de nivel-4?\n\nResponde con:  responder <imagen:tag>",
  prep(){ mkNs("nivel-4"); mkDep("nivel-4","tienda",{image:"nginx:1.26-alpine", cname:"nginx"}); },
  resp:() => "nginx:1.26-alpine",
  p:["kubectl describe deployment tienda -n nivel-4   → busca «Image:»","O en una línea: kubectl get deploy -n nivel-4 -o wide   → columna IMAGES","La respuesta lleva nombre y tag, separados por «:»"],
  a:"describe enseña el detalle de un objeto (y al final sus Events). -o wide añade columnas a get. La imagen es nombre:tag; el tag es la versión.",
  sol:"kubectl describe deployment tienda -n nivel-4\nresponder nginx:1.26-alpine" },
{ id:5, mundo:1, t:"¿Por qué puerto entro?", tipo:"pregunta",
  m:"¿En qué puerto escucha el Service «api» de nivel-5?\n\nResponde con:  responder <número>",
  prep(){ mkNs("nivel-5"); mkDep("nivel-5","api",{ports:[{containerPort:80}]}); mkSvc("nivel-5","api",{port:8080, targetPort:80}); },
  resp:() => "8080",
  p:["kubectl get svc -n nivel-5   → columna PORT(S)","«8080/TCP» = puerto 8080, protocolo TCP","kubectl describe svc api -n nivel-5 enseña también el TargetPort (el del contenedor)"],
  a:"Un Service tiene su puerto (port) y reenvía al puerto del contenedor (targetPort). No tienen por qué coincidir: aquí entras por el 8080 y nginx escucha en el 80.",
  sol:"kubectl get svc -n nivel-5\nresponder 8080" },
{ id:6, mundo:1, t:"Cuenta las copias", tipo:"pregunta",
  m:"Un Deployment mantiene N copias (RÉPLICAS) de su Pod.\n¿Cuántos Pods tiene el Deployment «contador» de nivel-6?\n\nResponde con:  responder <número>",
  prep(){ mkNs("nivel-6"); mkDep("nivel-6","contador",{replicas:4}); },
  resp:() => "4",
  p:["kubectl get deploy -n nivel-6   → READY 4/4 = 4 listos de 4 pedidos","O cuéntalos: kubectl get pods -n nivel-6","Truco: kubectl get pods -n nivel-6 --no-headers | wc -l"],
  a:"READY x/y = Pods listos / réplicas pedidas. Si borras un Pod, el Deployment crea otro para volver a tener las que pide.",
  sol:"kubectl get deploy -n nivel-6\nresponder 4" },
{ id:7, mundo:1, t:"Reconocimiento del terreno", tipo:"pregunta",
  m:"¿Cuántos Pods como máximo admite tu nodo?\n(lo que Kubernetes llama «allocatable pods»)\n\nResponde con:  responder <número>",
  prep(){}, resp:() => String(S.nodes[0].alloc.pods),
  p:["kubectl get nodes   → apunta el nombre del nodo","kubectl describe node <nombre>   → busca «Allocatable»","t3.medium: 3 ENIs × (6−1) IPs + 2 = ?"],
  a:"En EKS el máximo de Pods por nodo lo marca la RED (VPC CNI: cada Pod usa una IP de la VPC), no la CPU ni la RAM.",
  sol:"kubectl describe node <nodo>   → Allocatable → pods: 17\nresponder 17" },
{ id:8, mundo:1, t:"¿Dónde vive tu nodo?", tipo:"pregunta",
  m:"¿En qué zona de disponibilidad (AZ) está tu nodo?\n(si hay varios, el primero de kubectl get nodes)\n\nResponde con:  responder <zona>",
  prep(){}, resp:() => S.nodes.slice().sort((a, b) => a.name.localeCompare(b.name))[0].az,
  p:["Los nodos llevan labels que pone EKS: kubectl get nodes --show-labels","kubectl get nodes -L topology.kubernetes.io/zone  la muestra como columna","También en kubectl describe node <nodo> → Labels"],
  a:"La zona importa: un volumen EBS solo se monta en su zona, y se reparten réplicas entre zonas para sobrevivir a la caída de una.",
  sol:"kubectl get nodes -L topology.kubernetes.io/zone\nresponder eu-west-1a" },
{ id:9, mundo:1, t:"Tu propio espacio", tipo:"mision",
  m:"Crea un namespace llamado  mi-equipo .",
  prep(){ if (S.ns["mi-equipo"]) borrarNamespace("mi-equipo"); }, ok:() => !!S.ns["mi-equipo"],
  p:["kubectl get namespaces  muestra los que hay","kubectl create namespace --help","kubectl create namespace mi-equipo"],
  a:"Un namespace separa nombres, permisos (RBAC) y cuotas. NO aísla la red: para eso están las NetworkPolicies (nivel 50).",
  sol:"kubectl create namespace mi-equipo" },
{ id:10, mundo:1, t:"Tu primer despliegue", tipo:"mision",
  m:"En el namespace nivel-10 crea:\n• un Deployment «web» con la imagen nginx:1.27-alpine y 3 réplicas\n• un Service «web» (puerto 80) que apunte a ellas",
  prep(){ mkNs("nivel-10"); },
  ok:() => { const d = dObj("nivel-10","web"); return !!d && d.spec.template.spec.containers[0].image === "nginx:1.27-alpine" && listos("nivel-10","web") === 3 && eps("nivel-10","web") === 3; },
  p:["kubectl create deployment … --image=… --replicas=… -n nivel-10","El PUERTO va en el Service: kubectl expose deployment web --port=80 -n nivel-10","Comprueba con: kubectl get deploy,svc,endpoints -n nivel-10"],
  a:"El Deployment mantiene N copias; el Service les da una IP y un nombre DNS estables y reparte el tráfico entre las que están listas.",
  sol:"kubectl create deployment web --image=nginx:1.27-alpine --replicas=3 -n nivel-10\nkubectl expose deployment web --port=80 -n nivel-10" },
{ id:11, mundo:1, t:"Más copias", tipo:"mision",
  m:"En nivel-11 hay un Deployment «contador» con 1 réplica.\nEscálalo a 5 réplicas listas.",
  prep(){ mkNs("nivel-11"); mkDep("nivel-11","contador",{cname:"nginx"}); },
  ok:() => { const d = dObj("nivel-11","contador"); return !!d && d.spec.replicas === 5 && listos("nivel-11","contador") === 5; },
  p:["kubectl get deploy -n nivel-11","kubectl scale --help","kubectl scale deployment contador --replicas=5 -n nivel-11"],
  a:"Cambias el estado DESEADO y el ReplicaSet crea los Pods que faltan. Si borras uno, crea otro: así funciona todo en Kubernetes (reconciliación).",
  sol:"kubectl scale deployment contador --replicas=5 -n nivel-11" },
{ id:12, mundo:1, t:"Etiquetas", tipo:"pregunta",
  m:"¿Cuántos Pods de nivel-12 tienen la etiqueta  tier=backend ?\n\nResponde con:  responder <número>",
  prep(){ mkNs("nivel-12"); mkDep("nivel-12","api",{replicas:2, labels:{tier:"backend"}});
          mkDep("nivel-12","worker",{replicas:1, image:"busybox:1.37", cmd:["sleep","3600"], labels:{tier:"backend"}});
          mkDep("nivel-12","web",{replicas:2, labels:{tier:"frontend"}}); },
  resp:() => String(S.pods.filter(p => p.ns === "nivel-12" && p.labels.tier === "backend").length),
  p:["kubectl get pods -n nivel-12 --show-labels","Filtra con -l tier=backend","Para contar: kubectl get pods -n nivel-12 -l tier=backend --no-headers | wc -l"],
  a:"Labels y selectors son el «pegamento» de Kubernetes: Services, Deployments, NetworkPolicies y PDBs eligen Pods por labels.",
  sol:"kubectl get pods -n nivel-12 -l tier=backend --no-headers | wc -l\nresponder 3" },
{ id:13, mundo:1, t:"Mensaje en los logs", tipo:"pregunta",
  m:"El Deployment «emisor» (nivel-13) escribe un código de acceso en sus logs al arrancar.\n¿Cuál es?\n\nResponde con:  responder <código>",
  prep(){ mkNs("nivel-13"); mkDep("nivel-13","emisor",{image:"busybox:1.37", cmd:["sh","-c",'echo "Arrancando emisor..."; echo "Código de acceso: K8S-7319"; sleep 3600']}); },
  resp:() => "K8S-7319",
  p:["kubectl get pods -n nivel-13","kubectl logs <pod> -n nivel-13","Sin buscar el nombre del Pod: kubectl logs deploy/emisor -n nivel-13"],
  a:"kubectl logs muestra la salida estándar del contenedor. Si murió y se reinició, el log anterior está en --previous.",
  sol:"kubectl logs deploy/emisor -n nivel-13\nresponder K8S-7319" },

/* ===================== MUNDO 2 · Pods que no arrancan ===================== */
{ id:14, mundo:2, t:"La imagen fantasma", tipo:"mision",
  m:"En nivel-14, el Deployment «api» no arranca nunca.\nHaz que tenga 1 réplica lista, SIN borrarlo.",
  prep(){ mkNs("nivel-14"); S.datos.uid = mkDep("nivel-14","api",{image:"nginx:9.99-noexiste"}).metadata.uid; },
  ok:() => !!dObj("nivel-14","api") && dObj("nivel-14","api").metadata.uid === S.datos.uid && listos("nivel-14","api") === 1,
  p:["kubectl get pods -n nivel-14   → ¿qué STATUS ves?","kubectl describe pod <pod> -n nivel-14   → lee los Events","El tag no existe: kubectl set image deployment/api api=nginx:1.27-alpine -n nivel-14  (o kubectl edit deployment api -n nivel-14)"],
  a:"ErrImagePull = primer fallo al descargar; ImagePullBackOff = Kubernetes esperando cada vez más entre reintentos. Mira el mensaje: «not found» = el tag no existe.",
  sol:"kubectl set image deployment/api api=nginx:1.27-alpine -n nivel-14\n   (o: kubectl edit deployment api -n nivel-14 → cambia la línea image:)" },
{ id:15, mundo:2, t:"Error tipográfico", tipo:"mision",
  m:"Los Pods de «tienda» (nivel-15) no consiguen descargar su imagen. Arréglalo.",
  prep(){ mkNs("nivel-15"); S.datos.uid = mkDep("nivel-15","tienda",{image:"ngnix:1.27-alpine", replicas:2}).metadata.uid; },
  ok:() => { const d = dObj("nivel-15","tienda"); return !!d && d.metadata.uid === S.datos.uid && imagenInfo(d.spec.template.spec.containers[0].image).repo === "nginx" && listos("nivel-15","tienda") === 2; },
  p:["kubectl describe pod … -n nivel-15  → «pull access denied, repository does not exist»","Lee el nombre de la imagen letra a letra","ngnix → nginx: kubectl set image deployment/tienda tienda=nginx:1.27-alpine -n nivel-15"],
  a:"Si el REPOSITORIO no existe, el error dice «repository does not exist or may require authorization» (también sale cuando falta permiso a un registro privado). Si no existe el TAG, dice «not found».",
  sol:"kubectl set image deployment/tienda tienda=nginx:1.27-alpine -n nivel-15" },
{ id:16, mundo:2, t:"Falta la configuración", tipo:"mision",
  m:"En nivel-16, el Deployment «app» no arranca.\nAverigua qué le falta y dáselo SIN tocar el Deployment.",
  prep(){ mkNs("nivel-16"); mkDep("nivel-16","app",{image:"busybox:1.37", cmd:["sh","-c",'echo "Mensaje: $MENSAJE"; sleep 3600'], env:[{name:"MENSAJE", cm:["app-config","MENSAJE"]}]}); },
  ok:() => listos("nivel-16","app") === 1,
  p:["kubectl get pods -n nivel-16  → CreateContainerConfigError","kubectl describe pod … → ¿qué ConfigMap y qué clave busca?","kubectl create configmap app-config --from-literal=MENSAJE=hola -n nivel-16"],
  a:"CreateContainerConfigError casi siempre = falta un ConfigMap o Secret (o una clave dentro). El kubelet reintenta solo: en cuanto existe, arranca.",
  sol:"kubectl create configmap app-config --from-literal=MENSAJE=hola -n nivel-16" },
{ id:17, mundo:2, t:"Falta el secreto", tipo:"mision",
  m:"«bd-cliente» (nivel-17) necesita una contraseña que nadie le ha dado.\nDásela (invéntala) SIN tocar el Deployment.",
  prep(){ mkNs("nivel-17"); mkDep("nivel-17","bd-cliente",{image:"busybox:1.37", cmd:["sleep","3600"], env:[{name:"DB_PASSWORD", secret:["db-cred","password"]}]}); },
  ok:() => listos("nivel-17","bd-cliente") === 1,
  p:["Igual que el nivel 16, pero con un Secret (describe pod lo dice)","kubectl create secret generic --help","kubectl create secret generic db-cred --from-literal=password=lo-que-quieras -n nivel-17"],
  a:"Los Secrets se usan igual que los ConfigMaps (env o fichero). En el nivel 35 verás que NO están cifrados: solo en base64.",
  sol:"kubectl create secret generic db-cred --from-literal=password=MiClave123 -n nivel-17" },
{ id:18, mundo:2, t:"El devorador de RAM", tipo:"mision",
  m:"«tragon» (nivel-18) se reinicia sin parar.\nDescubre por qué muere y arréglalo cambiando SOLO sus recursos.",
  prep(){ mkNs("nivel-18"); mkDep("nivel-18","tragon",{image:"polinux/stress", cmd:["stress"], args:["--vm","1","--vm-bytes","150M","--vm-hang","1"], req:{memory:"64Mi", cpu:"50m"}, lim:{memory:"100Mi"}}); },
  ok:() => { const d = dObj("nivel-18","tragon"); return !!d && listos("nivel-18","tragon") === 1 && (memMi(((d.spec.template.spec.containers[0].resources || {}).limits || {}).memory) || Infinity) > 155; },
  p:["kubectl describe pod … -n nivel-18  → «Last State: Terminated · Reason: ??? · Exit Code: 137»","Intenta usar ~150 MB y su límite es 100Mi: el kernel lo mata (OOMKilled)","kubectl set resources deployment tragon --limits=memory=256Mi -n nivel-18"],
  a:"Superar limits.memory = OOMKilled (exit 137 = SIGKILL). La CPU no mata: se estrangula (throttling). Ajusta límites mirando el consumo real (kubectl top pod).",
  sol:"kubectl set resources deployment tragon --limits=memory=256Mi -n nivel-18" },
{ id:19, mundo:2, t:"Variable olvidada", tipo:"mision",
  m:"«procesador» (nivel-19) arranca y muere una y otra vez.\nLee qué le pasa y haz que arranque.",
  prep(){ mkNs("nivel-19"); mkDep("nivel-19","procesador",{image:"busybox:1.37", cmd:["sh","-c",SCRIPT_PROCESADOR]}); },
  ok:() => { const d = dObj("nivel-19","procesador"); const e = ((d && d.spec.template.spec.containers[0].env) || []).find(x => x.name === "MODO"); return listos("nivel-19","procesador") === 1 && !!e && ["normal","debug"].includes(e.value); },
  p:["kubectl logs <pod> -n nivel-19 --previous   (lo que dijo antes de morir)","Las variables de entorno se cambian con kubectl set env","kubectl set env deployment/procesador MODO=normal -n nivel-19"],
  a:"CrashLoopBackOff con Exit Code 1 = la aplicación decidió salir. Lo primero SIEMPRE: los logs (con --previous si ya se reinició).",
  sol:"kubectl set env deployment/procesador MODO=normal -n nivel-19" },
{ id:20, mundo:2, t:"Comando equivocado", tipo:"mision",
  m:"«reloj» (nivel-20) no llega ni a arrancar su proceso.\nEncuentra el error y corrígelo.",
  prep(){ mkNs("nivel-20"); mkDep("nivel-20","reloj",{image:"busybox:1.37", cmd:["slep","3600"]}); },
  ok:() => listos("nivel-20","reloj") === 1,
  p:["kubectl describe pod … -n nivel-20  → «executable file not found in $PATH»","Mira el campo command: kubectl get deploy reloj -n nivel-20 -o yaml","kubectl edit deployment reloj -n nivel-20  y corrige slep → sleep"],
  a:"StartError / RunContainerError = el contenedor ni siquiera pudo lanzar su proceso (comando inexistente, permisos…). No hay logs porque nunca arrancó.",
  sol:"kubectl edit deployment reloj -n nivel-20   → command: [\"sleep\",\"3600\"]\n   o: kubectl patch deployment reloj -n nivel-20 --type=json -p '[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/command\",\"value\":[\"sleep\",\"3600\"]}]'" },
{ id:21, mundo:2, t:"Atasco en el scheduler", tipo:"mision",
  m:"El Pod de «gigante» (nivel-21) no sale de Pending.\nHaz que arranque en los nodos que ya tienes (sin añadir nodos).",
  prep(){ mkNs("nivel-21"); mkDep("nivel-21","gigante",{req:{cpu:"64", memory:"64Mi"}}); S.datos.nodos = S.ng.desired; },
  ok:() => listos("nivel-21","gigante") === 1 && S.ng.desired <= S.datos.nodos,
  p:["kubectl describe pod … -n nivel-21  → «Insufficient cpu»","Pide 64 CPUs; tu nodo tiene ~1,9 allocatable (kubectl describe node)","kubectl set resources deployment gigante --requests=cpu=100m -n nivel-21"],
  a:"El scheduler coloca Pods según REQUESTS (lo reservado), no según el uso real. Pending + «Insufficient» = no cabe en ningún nodo.",
  sol:"kubectl set resources deployment gigante --requests=cpu=100m -n nivel-21" },
{ id:22, mundo:2, t:"Memoria imposible", tipo:"mision",
  m:"«analitica» (nivel-22) se queda en Pending.\nHaz que arranque sin añadir nodos.",
  prep(){ mkNs("nivel-22"); mkDep("nivel-22","analitica",{req:{cpu:"50m", memory:"16Gi"}}); S.datos.nodos = S.ng.desired; },
  ok:() => listos("nivel-22","analitica") === 1 && S.ng.desired <= S.datos.nodos,
  p:["kubectl describe pod … -n nivel-22  → «Insufficient memory»","Un t3.medium tiene 4 GiB (≈3,2 allocatable)","kubectl set resources deployment analitica --requests=memory=64Mi -n nivel-22"],
  a:"CPU y memoria se planifican igual. Pedir de más deja nodos «llenos» aunque estén ociosos: es la causa nº1 de clusters caros.",
  sol:"kubectl set resources deployment analitica --requests=memory=64Mi -n nivel-22" },

/* ===================== MUNDO 3 · Tráfico y salud ===================== */
{ id:23, mundo:3, t:"Nadie contesta al teléfono", tipo:"mision",
  m:"Los Pods de «tienda» (nivel-23) están perfectos, pero el Service «tienda»\nno les manda tráfico. Haz que tenga endpoints.",
  prep(){ mkNs("nivel-23"); mkDep("nivel-23","tienda",{replicas:2}); mkSvc("nivel-23","tienda",{selector:{app:"tiendaa"}}); },
  ok:() => eps("nivel-23","tienda") === 2,
  p:["kubectl get endpoints tienda -n nivel-23  → <none>. ¿Por qué?","Compara kubectl get svc tienda -o wide -n nivel-23  con  kubectl get pods --show-labels -n nivel-23","kubectl set selector service tienda app=tienda -n nivel-23   (o kubectl edit svc tienda -n nivel-23)"],
  a:"Un Service sin endpoints casi siempre es un selector que no casa con las labels de los Pods (o Pods que no están READY).",
  sol:"kubectl set selector service tienda app=tienda -n nivel-23" },
{ id:24, mundo:3, t:"Puerto equivocado", tipo:"mision",
  m:"El Service «web» (nivel-24) tiene endpoints, pero nadie le responde.\nCompruébalo con:\n  kubectl run prueba --rm -it --image=busybox:1.37 -n nivel-24 -- wget -qO- -T 3 http://web\ny arréglalo.",
  prep(){ mkNs("nivel-24"); mkDep("nivel-24","web",{replicas:2, ports:[{containerPort:80}]}); mkSvc("nivel-24","web",{port:80, targetPort:8080}); },
  ok:() => { const s = obj("Service","nivel-24","web"); return !!s && eps("nivel-24","web") >= 1 && endpointsDe(s).every(p => puertoContenedor(p, s.spec.ports[0].targetPort) === 80) && s.spec.ports[0].port === 80; },
  p:["kubectl describe svc web -n nivel-24  → mira TargetPort","nginx escucha en el 80 (kubectl describe pod → Port)","kubectl edit svc web -n nivel-24  y cambia targetPort: 8080 → 80"],
  a:"port = donde escucha el Service; targetPort = donde escucha el CONTENEDOR. Tener endpoints no garantiza que funcione: hay que probar la conexión.",
  sol:"kubectl edit svc web -n nivel-24   → targetPort: 80\n   o: kubectl patch svc web -n nivel-24 -p '{\"spec\":{\"ports\":[{\"port\":80,\"targetPort\":80}]}}'" },
{ id:25, mundo:3, t:"Nunca está listo", tipo:"mision",
  m:"Los Pods de «portal» (nivel-25) están Running pero 0/1 READY,\ny el Service no les manda tráfico. Arréglalo.",
  prep(){ mkNs("nivel-25"); mkDep("nivel-25","portal",{replicas:2, ports:[{containerPort:80}], readiness:{httpGet:{path:"/salud", port:80}, periodSeconds:5}}); mkSvc("nivel-25","portal"); },
  ok:() => listos("nivel-25","portal") === 2,
  p:["kubectl describe pod … -n nivel-25  → «Readiness probe failed: HTTP probe failed with statuscode: 404»","nginx solo responde en /","kubectl edit deployment portal -n nivel-25  y cambia path: /salud → path: /"],
  a:"La readiness decide si el Pod RECIBE TRÁFICO. Si falla, no se reinicia: sale de los endpoints del Service.",
  sol:"kubectl edit deployment portal -n nivel-25   → readinessProbe.httpGet.path: /" },
{ id:26, mundo:3, t:"Reinicios misteriosos", tipo:"mision",
  m:"«vigia» (nivel-26) funciona… un rato. Luego Kubernetes lo reinicia,\nuna y otra vez. Descubre por qué y arréglalo.",
  prep(){ mkNs("nivel-26"); mkDep("nivel-26","vigia",{ports:[{containerPort:80}], liveness:{httpGet:{path:"/", port:8080}, initialDelaySeconds:5, periodSeconds:5, failureThreshold:2}}); },
  ok:() => { const d = dObj("nivel-26","vigia"); const lv = d && d.spec.template.spec.containers[0].livenessProbe; const pod = S.pods.find(p => p.ns === "nivel-26" && p.listo); return listos("nivel-26","vigia") === 1 && !!lv && !!pod && !pod.fallaLiveness; },
  p:["RESTARTS sube; en kubectl describe pod busca «Liveness probe failed»","«connection refused» en el 8080… pero nginx escucha en el 80","kubectl edit deployment vigia -n nivel-26  y pon la liveness en port: 80"],
  a:"La liveness decide si el contenedor sigue VIVO: si falla, el kubelet lo mata y lo reinicia. Una liveness mal hecha tumba aplicaciones sanas.",
  sol:"kubectl edit deployment vigia -n nivel-26   → livenessProbe.httpGet.port: 80" },
{ id:27, mundo:3, t:"La web secreta", tipo:"pregunta",
  m:"El Service «boveda» (nivel-27) sirve una página con un código,\npero no tiene acceso desde fuera del cluster. ¿Cuál es el código?\n\nResponde con:  responder <código>",
  prep(){ mkNs("nivel-27"); mkCm("nivel-27","boveda-html",{"index.html":"<h1>Código: PF-4096</h1>\n"});
          mkDep("nivel-27","boveda",{ports:[{containerPort:80}], volumes:[{name:"html", configMap:{name:"boveda-html"}}], mounts:[{name:"html", mountPath:"/usr/share/nginx/html"}]}); mkSvc("nivel-27","boveda"); },
  resp:() => "PF-4096",
  p:["kubectl port-forward abre un túnel desde tu PC hasta el Service","kubectl port-forward svc/boveda 8080:80 -n nivel-27","Con el túnel abierto: curl http://localhost:8080   (en tu terminal real, desde OTRA ventana)"],
  a:"port-forward es la forma segura de probar algo interno sin publicarlo en Internet (no pasa por ningún balanceador).",
  sol:"kubectl port-forward svc/boveda 8080:80 -n nivel-27\ncurl http://localhost:8080\nresponder PF-4096" },
{ id:28, mundo:3, t:"Vecinos lejanos", tipo:"mision",
  m:"«tienda-web» (nivel-28) no llega al catálogo, que vive en OTRO namespace\n(nivel-28-api). Arregla su configuración para que lo encuentre.",
  prep(){ mkNs("nivel-28-api"); mkDep("nivel-28-api","catalogo",{ports:[{containerPort:80}]}); mkSvc("nivel-28-api","catalogo");
          mkNs("nivel-28"); mkDep("nivel-28","tienda-web",{image:"busybox:1.37", cmd:["sleep","3600"], env:[{name:"API_URL", value:"http://catalogo"}], readiness:SONDA_WGET_API}); },
  ok:() => listos("nivel-28","tienda-web") === 1,
  p:["El nombre corto «catalogo» solo se resuelve DENTRO del mismo namespace","Formato: <servicio>.<namespace>  (o el nombre completo …svc.cluster.local)","kubectl set env deployment/tienda-web API_URL=http://catalogo.nivel-28-api -n nivel-28"],
  a:"El DNS de Kubernetes busca primero en TU namespace (search en /etc/resolv.conf). Para otro namespace hay que nombrarlo.",
  sol:"kubectl set env deployment/tienda-web API_URL=http://catalogo.nivel-28-api -n nivel-28" },
{ id:29, mundo:3, t:"Nombre completo", tipo:"pregunta",
  m:"¿Cuál es el nombre DNS completo (FQDN) del Service «pagos» de nivel-29?\n\nResponde con:  responder <nombre>",
  prep(){ mkNs("nivel-29"); mkDep("nivel-29","pagos"); mkSvc("nivel-29","pagos"); },
  resp:() => "pagos.nivel-29.svc.cluster.local",
  p:["Formato: <servicio>.<namespace>.svc.<dominio-del-cluster>","kubectl run dns --rm -it --image=busybox:1.37 -n nivel-29 -- cat /etc/resolv.conf","kubectl run dns --rm -it --image=busybox:1.37 -n nivel-29 -- nslookup pagos"],
  a:"El dominio por defecto es cluster.local. Con el FQDN llegas a cualquier Service desde cualquier namespace.",
  sol:"responder pagos.nivel-29.svc.cluster.local" },
{ id:30, mundo:3, t:"Ábrete al mundo", tipo:"mision",
  m:"Publica «escaparate» (nivel-30) en Internet con un Service «escaparate»\nde tipo LoadBalancer en el puerto 80, y compruébalo tú con curl.\n(en AWS crearía un balanceador real: ~0,03 $/h; al superar el nivel se borra)",
  prep(){ mkNs("nivel-30"); mkDep("nivel-30","escaparate",{ports:[{containerPort:80}]}); S.datos.curlLB = false; },
  ok:() => { const s = obj("Service","nivel-30","escaparate"); return !!s && s.spec.type === "LoadBalancer" && externaTxt(s) !== "<pending>" && !!S.datos.curlLB; },
  alSuperar(){ const s = obj("Service","nivel-30","escaparate"); if (s){ borrarObjeto(s); nota("(el juego borra el Service LoadBalancer para que en AWS no siguiera costando: kubectl delete svc escaparate -n nivel-30)"); } },
  p:["kubectl expose deployment escaparate --type=LoadBalancer --port=80 -n nivel-30","kubectl get svc -n nivel-30  hasta que EXTERNAL-IP deje de ser <pending> (prueba «sleep 10»)","curl http://<hostname-del-EXTERNAL-IP>"],
  a:"type: LoadBalancer = AWS crea un balanceador que cuesta mientras exista. En producción se usa el AWS Load Balancer Controller (ALB/NLB) y casi siempre Ingress.",
  sol:"kubectl expose deployment escaparate --type=LoadBalancer --port=80 -n nivel-30\nkubectl get svc escaparate -n nivel-30\ncurl http://<EXTERNAL-IP>" },

/* ===================== MUNDO 4 · Actualizaciones y configuración ===================== */
{ id:31, mundo:4, t:"Nueva versión", tipo:"mision",
  m:"Actualiza «web» (nivel-31) a nginx:1.28-alpine sin cortar el servicio,\ny comprueba que el despliegue ha terminado.",
  prep(){ mkNs("nivel-31"); mkDep("nivel-31","web",{replicas:3, cname:"nginx"}); mkSvc("nivel-31","web"); },
  ok:() => { const d = dObj("nivel-31","web"); if (!d) return false; const e = estadoDeployment(d); return d.spec.template.spec.containers[0].image === "nginx:1.28-alpine" && e.updatedReplicas === 3 && e.actualizadosListos === 3 && e.replicas === 3; },
  p:["El contenedor se llama «nginx» (kubectl describe deploy web -n nivel-31)","kubectl set image deployment/web nginx=nginx:1.28-alpine -n nivel-31","kubectl rollout status deployment/web -n nivel-31"],
  a:"El rolling update crea Pods nuevos antes de quitar los viejos (maxSurge / maxUnavailable): cero cortes si las readiness están bien.",
  sol:"kubectl set image deployment/web nginx=nginx:1.28-alpine -n nivel-31\nkubectl rollout status deployment/web -n nivel-31" },
{ id:32, mundo:4, t:"Despliegue roto", tipo:"mision",
  m:"Alguien ha desplegado una versión rota de «web» (nivel-32).\nVuelve a la versión que funcionaba.",
  prep(){ mkNs("nivel-32"); const d = mkDep("nivel-32","web",{replicas:3, cname:"nginx"}); mkSvc("nivel-32","web"); reconciliar(); d.spec.template.spec.containers[0].image = "nginx:1.99-alpine"; reconciliar(); },
  ok:() => { const d = dObj("nivel-32","web"); if (!d) return false; const e = estadoDeployment(d); return d.spec.template.spec.containers[0].image === "nginx:1.27-alpine" && e.actualizadosListos === 3 && e.replicas === 3 && !S.pods.some(p => p.ns === "nivel-32" && p.estado !== "Running"); },
  p:["kubectl rollout status deployment/web -n nivel-32  se queda esperando","Fíjate: los Pods viejos SIGUEN funcionando (kubectl get pods)","kubectl rollout undo deployment/web -n nivel-32"],
  a:"Un despliegue roto no tumba el servicio gracias al rolling update (los viejos siguen). rollout undo vuelve a la revisión anterior al instante.",
  sol:"kubectl rollout undo deployment/web -n nivel-32" },
{ id:33, mundo:4, t:"Viaje en el tiempo", tipo:"mision",
  m:"Vuelve «app» (nivel-33) exactamente a su PRIMERA revisión.",
  prep(){ mkNs("nivel-33"); const d = mkDep("nivel-33","app",{image:"nginx:1.25-alpine", cname:"nginx", anot:{"kubernetes.io/change-cause":"versión inicial 1.25"}}); reconciliar();
          d.spec.template.spec.containers[0].image = "nginx:1.26-alpine"; d.metadata.annotations["kubernetes.io/change-cause"] = "actualizo a 1.26"; reconciliar();
          d.spec.template.spec.containers[0].image = "nginx:1.27-alpine"; d.metadata.annotations["kubernetes.io/change-cause"] = "actualizo a 1.27"; reconciliar(); },
  ok:() => { const d = dObj("nivel-33","app"); return !!d && d.spec.template.spec.containers[0].image === "nginx:1.25-alpine" && listos("nivel-33","app") === 1; },
  p:["kubectl rollout history deployment/app -n nivel-33","undo «a secas» solo vuelve a la anterior (la 2)","kubectl rollout undo deployment/app --to-revision=1 -n nivel-33"],
  a:"El historial vive en los ReplicaSets antiguos (revisionHistoryLimit, 10 por defecto). Al volver a la 1, esa pasa a ser la revisión 4.",
  sol:"kubectl rollout history deployment/app -n nivel-33\nkubectl rollout undo deployment/app --to-revision=1 -n nivel-33" },
{ id:34, mundo:4, t:"Configuración en caliente", tipo:"mision",
  m:"La app «saludo» (nivel-34) lee MENSAJE de un ConfigMap.\nCambia el mensaje a «Bienvenido» y consigue que la aplicación lo use DE VERDAD.",
  prep(){ mkNs("nivel-34"); mkCm("nivel-34","saludo-config",{MENSAJE:"Hola"});
          mkDep("nivel-34","saludo",{image:"busybox:1.37", cmd:["sh","-c",'while true; do echo "Mensaje: $MENSAJE"; sleep 10; done'], env:[{name:"MENSAJE", cm:["saludo-config","MENSAJE"]}]}); },
  ok:() => { const c = obj("ConfigMap","nivel-34","saludo-config"); const d = dObj("nivel-34","saludo"); if (!c || !d || (c.data || {}).MENSAJE !== "Bienvenido") return false; const ps = podsDeDeployment(d).filter(p => p.estado === "Running"); return ps.length >= 1 && ps.length === podsDeDeployment(d).length && ps.every(p => (p.envSnap || {}).MENSAJE === "Bienvenido"); },
  p:["Cambiar el ConfigMap no basta: mira kubectl logs deploy/saludo -n nivel-34","Las variables de entorno se leen SOLO al arrancar el contenedor","Tras kubectl edit configmap saludo-config -n nivel-34 →  kubectl rollout restart deployment/saludo -n nivel-34"],
  a:"Un ConfigMap usado como variable de entorno NO se refresca; montado como fichero sí (con retraso). Tras cambiarlo: rollout restart.",
  sol:"kubectl edit configmap saludo-config -n nivel-34   → MENSAJE: Bienvenido\nkubectl rollout restart deployment/saludo -n nivel-34" },
{ id:35, mundo:4, t:"Secretos que no lo son", tipo:"pregunta",
  m:"¿Cuál es la contraseña guardada en el Secret «credenciales» (nivel-35)?\n\nResponde con:  responder <contraseña>",
  prep(){ mkNs("nivel-35"); mkSecret("nivel-35","credenciales",{usuario:"admin", password:"S3cr3t0-EKS"}); },
  resp:() => "S3cr3t0-EKS", exacta:true,
  p:["kubectl get secret credenciales -n nivel-35 -o yaml  → los valores están en base64","echo <valor> | base64 -d","kubectl get secret credenciales -n nivel-35 -o jsonpath='{.data.password}' | base64 -d"],
  a:"base64 NO es cifrado: cualquiera que pueda LEER Secrets (RBAC) ve las contraseñas. En EKS etcd va cifrado con KMS, pero el día a día te lo protege el RBAC.",
  sol:"kubectl get secret credenciales -n nivel-35 -o jsonpath='{.data.password}' | base64 -d\nresponder S3cr3t0-EKS" },
{ id:36, mundo:4, t:"Tarea única", tipo:"mision",
  m:"Crea en nivel-36 un Job llamado «calculo», con imagen busybox:1.37,\nque ejecute  echo 42  y termine con éxito.",
  prep(){ mkNs("nivel-36"); },
  ok:() => { const j = obj("Job","nivel-36","calculo"); return !!j && (j.status || {}).succeeded >= 1 && imagenInfo(j.spec.template.spec.containers[0].image).repo === "busybox"; },
  p:["Un Job ejecuta algo hasta que termina bien (no es un Deployment)","kubectl create job --help   (el comando va detrás de --)","kubectl create job calculo --image=busybox:1.37 -n nivel-36 -- echo 42"],
  a:"Job = tareas que TERMINAN (migraciones, cálculos, backups). Su Pod acaba en Completed. La salida: kubectl logs job/calculo.",
  sol:"kubectl create job calculo --image=busybox:1.37 -n nivel-36 -- echo 42" },
{ id:37, mundo:4, t:"Tarea programada", tipo:"mision",
  m:"Crea en nivel-37 un CronJob «limpieza» (imagen busybox:1.37, comando\necho limpiando) que se ejecute TODOS LOS DÍAS A LAS 03:00.",
  prep(){ mkNs("nivel-37"); },
  ok:() => { const c = obj("CronJob","nivel-37","limpieza"); return !!c && String(c.spec.schedule).trim().split(/\s+/).join(" ") === "0 3 * * *"; },
  p:["Formato cron: minuto hora día-del-mes mes día-de-la-semana","«A las 03:00 todos los días» = 0 3 * * *","kubectl create cronjob limpieza --image=busybox:1.37 --schedule=\"0 3 * * *\" -n nivel-37 -- echo limpiando"],
  a:"Un CronJob crea un Job en cada disparo. La hora es UTC salvo que pongas spec.timeZone.",
  sol:"kubectl create cronjob limpieza --image=busybox:1.37 --schedule=\"0 3 * * *\" -n nivel-37 -- echo limpiando" },
{ id:38, mundo:4, t:"Un Pod en cada nodo", tipo:"pregunta",
  m:"¿Cuántos Pods del DaemonSet «kube-proxy» hay ahora mismo en el cluster?\n\nResponde con:  responder <número>",
  prep(){}, resp:() => String(S.pods.filter(p => p.owner && p.owner.kind === "DaemonSet" && p.owner.name === "kube-proxy").length),
  p:["kubectl get daemonsets -n kube-system","Columnas DESIRED / READY","kubectl get pods -n kube-system -o wide | grep kube-proxy"],
  a:"Un DaemonSet pone un Pod en CADA nodo. Así funcionan aws-node (la red) y kube-proxy en EKS: al añadir un nodo, aparece su copia sola.",
  sol:"kubectl get ds kube-proxy -n kube-system   → DESIRED\nresponder <ese número>" },

/* ===================== MUNDO 5 · Capacidad y escalado ===================== */
{ id:39, mundo:5, t:"Calidad de servicio", tipo:"pregunta",
  m:"En nivel-39 hay tres Deployments: oro, plata y bronce.\n¿Qué clase QoS (QoS Class) tiene el Pod de «plata»?\n\nResponde con:  responder <clase>",
  prep(){ mkNs("nivel-39"); mkDep("nivel-39","oro",{req:{cpu:"100m", memory:"64Mi"}, lim:{cpu:"100m", memory:"64Mi"}}); mkDep("nivel-39","plata",{req:{cpu:"50m", memory:"32Mi"}, lim:{memory:"128Mi"}}); mkDep("nivel-39","bronce"); },
  resp:() => "Burstable",
  p:["Hay 3 clases: Guaranteed, Burstable y BestEffort","kubectl describe pod <pod-de-plata> -n nivel-39  → «QoS Class»","kubectl get pods -n nivel-39 -l app=plata -o jsonpath='{.items[0].status.qosClass}'"],
  a:"Guaranteed: requests = limits. Burstable: algún request. BestEffort: nada. Si el nodo se queda sin memoria, se desaloja primero BestEffort.",
  sol:"kubectl describe pod -l app=plata -n nivel-39 | grep QoS\nresponder Burstable" },
{ id:40, mundo:5, t:"Autoescalado", tipo:"mision",
  m:"Crea un HorizontalPodAutoscaler «web» en nivel-40 (mínimo 1, máximo 4,\nobjetivo 50 % de CPU) y consigue que muestre la CPU real.",
  prep(){ mkNs("nivel-40"); mkDep("nivel-40","web",{req:{cpu:"50m", memory:"32Mi"}}); },
  ok:() => { const h = obj("HorizontalPodAutoscaler","nivel-40","web"); return !!h && (h.spec.scaleTargetRef || {}).name === "web" && (h.spec.minReplicas || 1) === 1 && h.spec.maxReplicas === 4 && objetivoHPA(h) === 50 && !metricaHPA(h).error; },
  p:["kubectl autoscale deployment … -n nivel-40","Flags: --min=1 --max=4 --cpu-percent=50   (kubectl 1.36 también: --cpu=50%)","kubectl get hpa -n nivel-40  → TARGETS debe mostrar cpu: X%/50%"],
  a:"El HPA cambia el nº de Pods según métricas que da metrics-server (addon en EKS). Sin metrics-server, TARGETS = <unknown>.",
  sol:"kubectl autoscale deployment web --min=1 --max=4 --cpu-percent=50 -n nivel-40" },
{ id:41, mundo:5, t:"Autoescalado a ciegas", tipo:"mision",
  m:"El HPA «api» (nivel-41) no consigue medir la CPU (TARGETS <unknown>).\nArréglalo sin borrar el HPA.",
  prep(){ mkNs("nivel-41"); mkDep("nivel-41","api");
          guardarObj({apiVersion:"autoscaling/v2", kind:"HorizontalPodAutoscaler", metadata:metaNueva("api","nivel-41"), spec:{scaleTargetRef:{apiVersion:"apps/v1", kind:"Deployment", name:"api"}, minReplicas:1, maxReplicas:5, metrics:[{type:"Resource", resource:{name:"cpu", target:{type:"Utilization", averageUtilization:60}}}]}}); },
  ok:() => { const h = obj("HorizontalPodAutoscaler","nivel-41","api"); return !!h && h.spec.maxReplicas === 5 && (h.spec.minReplicas || 1) === 1 && !metricaHPA(h).error; },
  p:["kubectl describe hpa api -n nivel-41  → «missing request for cpu»","El % de CPU se calcula sobre los REQUESTS","kubectl set resources deployment api --requests=cpu=50m -n nivel-41"],
  a:"HPA por % de CPU = uso ÷ requests. Sin requests no hay porcentaje posible.",
  sol:"kubectl set resources deployment api --requests=cpu=50m -n nivel-41" },
{ id:42, mundo:5, t:"Cuota agotada", tipo:"mision",
  m:"El Deployment «fila» (nivel-42) quiere 4 Pods pero solo tiene 2.\nConsigue los 4 sin reducir réplicas.",
  prep(){ mkNs("nivel-42"); guardarObj({apiVersion:"v1", kind:"ResourceQuota", metadata:metaNueva("limite-pods","nivel-42"), spec:{hard:{pods:"2"}}}); mkDep("nivel-42","fila",{replicas:4}); },
  ok:() => { const d = dObj("nivel-42","fila"); return !!d && d.spec.replicas === 4 && listos("nivel-42","fila") === 4; },
  p:["kubectl get events -n nivel-42  → «exceeded quota» (los Pods que faltan ni existen)","kubectl describe resourcequota -n nivel-42","kubectl edit resourcequota limite-pods -n nivel-42  y sube pods a \"4\""],
  a:"Las cuotas limitan lo que consume un namespace. El fallo no está en ningún Pod (no llegan a existir): se ve en los eventos del ReplicaSet.",
  sol:"kubectl edit resourcequota limite-pods -n nivel-42   → pods: \"4\"\n   o: kubectl patch resourcequota limite-pods -n nivel-42 -p '{\"spec\":{\"hard\":{\"pods\":\"4\"}}}'" },
{ id:43, mundo:5, t:"Sin hueco", tipo:"mision",
  m:"Algunos Pods de «relleno» (nivel-43) no caben en ningún nodo.\nHaz que arranquen TODOS sin reducir réplicas.\n(en AWS añadir un nodo cuesta 0,0456 $/h)",
  prep(){ mkNs("nivel-43"); reconciliar();
          const libres = S.nodes.filter(n => n.ready && !n.unsched && !n.terminando).reduce((a, n) => a + n.alloc.pods - usoNodo(n).pods, 0);
          S.datos.relleno = libres + 3; mkDep("nivel-43","relleno",{replicas:libres + 3}); },
  ok:() => { const d = dObj("nivel-43","relleno"); return !!d && d.spec.replicas >= S.datos.relleno && listos("nivel-43","relleno") === d.spec.replicas; },
  p:["kubectl describe pod <uno-Pending> -n nivel-43  → «Too many pods»","Hacen falta más nodos: eso es el node group de AWS, no kubectl","aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego --scaling-config minSize=1,maxSize=2,desiredSize=2   (si ya tienes 2: maxSize=3,desiredSize=3)"],
  a:"Cuando no caben Pods se añaden nodos: a mano (node group), con Cluster Autoscaler o con Karpenter (lo hace solo en segundos).",
  sol:"aws eks update-nodegroup-config --cluster-name eks-juego --nodegroup-name ng-juego --scaling-config minSize=1,maxSize=2,desiredSize=2" },
{ id:44, mundo:5, t:"Nodo vetado", tipo:"mision",
  m:"Nadie puede arrancar Pods nuevos y «urgente» (nivel-44) necesita\narrancar YA. Haz que arranque.",
  prep(){ for (const n of S.nodes) if (!n.taints.some(t => t.key === "mantenimiento")) n.taints.push({key:"mantenimiento", value:"si", effect:"NoSchedule"}); mkNs("nivel-44"); mkDep("nivel-44","urgente"); },
  ok:() => listos("nivel-44","urgente") === 1,
  p:["kubectl describe pod … -n nivel-44  → «had untolerated taint {mantenimiento: si}»","kubectl describe nodes | grep Taints","Quita el taint: kubectl taint nodes --all mantenimiento-   ·  o añade una toleration a urgente (kubectl edit)"],
  a:"Los taints repelen Pods; las tolerations les dejan pasar. Así se reservan nodos (GPU, sistema…) o se sacan de servicio.",
  sol:"kubectl taint nodes --all mantenimiento-\n   o en el Deployment: tolerations: [{key: mantenimiento, operator: Exists}]" },
{ id:45, mundo:5, t:"Etiqueta que falta", tipo:"mision",
  m:"«gpu-app» (nivel-45) solo puede ir a nodos con  hardware=gpu .\nHaz que arranque SIN modificar el Deployment.",
  prep(){ mkNs("nivel-45"); mkDep("nivel-45","gpu-app",{nodeSelector:{hardware:"gpu"}}); },
  ok:() => { const d = dObj("nivel-45","gpu-app"); return !!d && (d.spec.template.spec.nodeSelector || {}).hardware === "gpu" && listos("nivel-45","gpu-app") === 1; },
  p:["kubectl describe pod … -n nivel-45  → «didn't match Pod's node affinity/selector»","Si no puedes cambiar el Pod, cambia el NODO","kubectl label node <nodo> hardware=gpu"],
  a:"nodeSelector / affinity = el Pod elige nodos por labels. En EKS esas labels se ponen en el node group o en el NodePool de Karpenter.",
  sol:"kubectl get nodes\nkubectl label node <nodo> hardware=gpu" },
{ id:46, mundo:5, t:"Mantenimiento", tipo:"mision",
  m:"Hay que parchear un nodo. Sácalo de servicio: no planificable y sin\nPods de aplicación (los de DaemonSet pueden quedarse).\n(el juego te pone 2 nodos para este nivel)",
  prep(){ asegurarNodos(2); mkNs("nivel-46"); mkDep("nivel-46","web",{replicas:2}); },
  ok:() => S.nodes.some(n => n.unsched && !n.terminando && !S.pods.some(p => p.node === n.name && !esDS(p) && !["Succeeded","Failed"].includes(p.fase))),
  alSuperar(){ nota("(cuando termines de «parchear»: kubectl uncordon <nodo>)"); },
  p:["Con un solo nodo, los Pods no tendrían a dónde ir: por eso hay 2","kubectl cordon marca el nodo; kubectl drain lo marca Y lo vacía","kubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data"],
  a:"drain desaloja respetando los PDB (nivel 53). Antes de parchear, actualizar o terminar un nodo: SIEMPRE drain. Y después, uncordon.",
  sol:"kubectl get nodes\nkubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data" },

/* ===================== MUNDO 6 · Seguridad y permisos ===================== */
{ id:47, mundo:6, t:"¿Quién soy?", tipo:"pregunta",
  m:"¿Cuál es el número de cuenta AWS (12 dígitos) en la que vive el cluster?\n\nResponde con:  responder <cuenta>",
  prep(){}, resp:() => CUENTA,
  p:["aws sts get-caller-identity","El ARN del cluster la lleva: aws eks describe-cluster --name eks-juego --query cluster.arn","También sale en kubectl config get-contexts"],
  a:"EKS autentica con IAM. Ante un «Unauthorized», lo PRIMERO es aws sts get-caller-identity: ¿con qué identidad y en qué cuenta estoy?",
  sol:"aws sts get-caller-identity --query Account --output text\nresponder 123456789012" },
{ id:48, mundo:6, t:"Permisos mínimos", tipo:"mision",
  m:"Haz que la ServiceAccount «lector» (nivel-48) pueda VER (get, list, watch)\nlos Pods de nivel-48… y NADA más.",
  prep(){ mkNs("nivel-48"); guardarObj({apiVersion:"v1", kind:"ServiceAccount", metadata:metaNueva("lector","nivel-48")}); mkDep("nivel-48","web"); },
  ok:() => { const sa = "system:serviceaccount:nivel-48:lector"; return puede(sa,"list","pods","nivel-48") && puede(sa,"get","pods","nivel-48") && puede(sa,"watch","pods","nivel-48") && !puede(sa,"delete","pods","nivel-48") && !puede(sa,"list","secrets","nivel-48") && !puede(sa,"create","deployments","nivel-48") && !puede(sa,"list","deployments","nivel-48") && !puede(sa,"list","services","nivel-48"); },
  p:["Pruébalo: kubectl auth can-i list pods -n nivel-48 --as=system:serviceaccount:nivel-48:lector","Hacen falta un Role (QUÉ se puede hacer) y un RoleBinding (A QUIÉN se le da)","kubectl create role ver-pods --verb=get,list,watch --resource=pods -n nivel-48  y luego  kubectl create rolebinding lector-ver-pods --role=ver-pods --serviceaccount=nivel-48:lector -n nivel-48"],
  a:"RBAC = Role (verbos sobre recursos) + RoleBinding (a quién). Mínimo privilegio: da solo lo necesario y compruébalo con auth can-i --as.",
  sol:"kubectl create role ver-pods --verb=get,list,watch --resource=pods -n nivel-48\nkubectl create rolebinding lector-ver-pods --role=ver-pods --serviceaccount=nivel-48:lector -n nivel-48" },
{ id:49, mundo:6, t:"Demasiados permisos", tipo:"mision",
  m:"La ServiceAccount «bot» puede borrar cualquier cosa de nivel-49.\nDéjala en solo LECTURA.",
  prep(){ mkNs("nivel-49"); guardarObj({apiVersion:"v1", kind:"ServiceAccount", metadata:metaNueva("bot","nivel-49")}); mkDep("nivel-49","web");
          guardarObj({apiVersion:"rbac.authorization.k8s.io/v1", kind:"RoleBinding", metadata:metaNueva("bot-todo","nivel-49"), roleRef:{apiGroup:"rbac.authorization.k8s.io", kind:"ClusterRole", name:"admin"}, subjects:[{kind:"ServiceAccount", name:"bot", namespace:"nivel-49"}]}); },
  ok:() => { const sa = "system:serviceaccount:nivel-49:bot"; return puede(sa,"list","deployments","nivel-49") && puede(sa,"get","pods","nivel-49") && !puede(sa,"delete","deployments","nivel-49") && !puede(sa,"create","pods","nivel-49") && !puede(sa,"delete","pods","nivel-49"); },
  p:["kubectl get rolebindings -n nivel-49 -o wide","Existen ClusterRoles predefinidos: view, edit, admin","Borra bot-todo y crea un RoleBinding con --clusterrole=view para la ServiceAccount"],
  a:"Un RoleBinding a un ClusterRole da esos permisos SOLO en ese namespace. «view» no deja leer Secrets; «edit» sí; «admin» además gestiona RBAC.",
  sol:"kubectl delete rolebinding bot-todo -n nivel-49\nkubectl create rolebinding bot-lectura --clusterrole=view --serviceaccount=nivel-49:bot -n nivel-49" },
{ id:50, mundo:6, t:"Muro de fuego", tipo:"mision",
  m:"Una NetworkPolicy bloquea todo el tráfico entrante en nivel-50.\nPermite SOLO que «cliente» hable con «web», sin borrar «denegar-todo».",
  prep(){ mkNs("nivel-50"); mkDep("nivel-50","web",{ports:[{containerPort:80}]}); mkSvc("nivel-50","web");
          mkDep("nivel-50","cliente",{image:"busybox:1.37", cmd:["sleep","3600"], readiness:{exec:{command:["wget","-qO-","-T","2","http://web"]}, periodSeconds:5, timeoutSeconds:3}});
          guardarObj({apiVersion:"networking.k8s.io/v1", kind:"NetworkPolicy", metadata:metaNueva("denegar-todo","nivel-50"), spec:{podSelector:{}, policyTypes:["Ingress"]}}); },
  ok:() => !!obj("NetworkPolicy","nivel-50","denegar-todo") && listos("nivel-50","cliente") === 1,
  p:["kubectl get networkpolicy -n nivel-50   y   kubectl describe networkpolicy denegar-todo -n nivel-50","Las políticas se SUMAN: añade otra que permita de app=cliente a app=web","kubectl apply -f -  con una NetworkPolicy «permitir-cliente»: podSelector app=web, ingress from podSelector app=cliente"],
  a:"Por defecto todo Pod habla con todo Pod. «Denegar todo» + permisos explícitos = red de mínimo privilegio. En EKS hace falta activar enableNetworkPolicy en la VPC CNI.",
  sol:"kubectl apply -f -   (y pega:)\napiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: permitir-cliente\n  namespace: nivel-50\nspec:\n  podSelector:\n    matchLabels:\n      app: web\n  policyTypes: [\"Ingress\"]\n  ingress:\n  - from:\n    - podSelector:\n        matchLabels:\n          app: cliente" },
{ id:51, mundo:6, t:"Pod Security", tipo:"mision",
  m:"nivel-51 solo admite Pods «restricted» (Pod Security Admission).\nHaz que «inseguro» tenga 1 Pod listo, SIN quitar esa etiqueta del namespace.",
  prep(){ mkNs("nivel-51", {"pod-security.kubernetes.io/enforce":"restricted"}); S.ns["nivel-51"].labels["pod-security.kubernetes.io/enforce"] = "restricted"; mkDep("nivel-51","inseguro"); },
  ok:() => (S.ns["nivel-51"] || {labels:{}}).labels["pod-security.kubernetes.io/enforce"] === "restricted" && listos("nivel-51","inseguro") === 1,
  p:["kubectl get events -n nivel-51   (o kubectl describe rs -n nivel-51)  → «violates PodSecurity \"restricted\"»","El mensaje enumera lo que falta: allowPrivilegeEscalation, capabilities, runAsNonRoot, seccompProfile","nginx normal corre como ROOT: usa nginxinc/nginx-unprivileged:1.28-alpine (puerto 8080) + securityContext. Con kubectl apply -f - (ver solución si te atascas)"],
  a:"Pod Security Admission bloquea Pods inseguros por namespace (labels pod-security.kubernetes.io/*). Una imagen que corre como root no pasa runAsNonRoot.",
  sol:"kubectl apply -f -   (y pega:)\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: inseguro\n  namespace: nivel-51\nspec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app: inseguro\n  template:\n    metadata:\n      labels:\n        app: inseguro\n    spec:\n      securityContext:\n        runAsNonRoot: true\n        seccompProfile:\n          type: RuntimeDefault\n      containers:\n      - name: inseguro\n        image: nginxinc/nginx-unprivileged:1.28-alpine\n        ports:\n        - containerPort: 8080\n        securityContext:\n          allowPrivilegeEscalation: false\n          capabilities:\n            drop: [\"ALL\"]" },

/* ===================== MUNDO 7 · Guardia ===================== */
{ id:52, mundo:7, t:"Ficha del cluster", tipo:"pregunta",
  m:"¿Qué versión de Kubernetes tiene el control plane? (formato 1.XX)\n\nResponde con:  responder <versión>",
  prep(){}, resp:() => K8S_MINOR,
  p:["kubectl version  → Server Version","aws eks describe-cluster --name eks-juego --query cluster.version","Solo el minor: 1.XX"],
  a:"La versión marca el soporte (14 meses estándar) y el precio: en soporte extendido el control plane pasa de 0,10 a 0,60 $/h.",
  sol:"aws eks describe-cluster --name eks-juego --query cluster.version --output text\nresponder 1.36" },
{ id:53, mundo:7, t:"Presupuesto de interrupción", tipo:"mision",
  m:"Vacía (drain) un nodo que tenga un Pod de «pagos» (nivel-53),\nSIN borrar ni modificar su PodDisruptionBudget.\n(el juego te pone 2 nodos para este nivel)",
  prep(){ asegurarNodos(2); mkNs("nivel-53"); mkDep("nivel-53","pagos",{replicas:2});
          guardarObj({apiVersion:"policy/v1", kind:"PodDisruptionBudget", metadata:metaNueva("pagos-pdb","nivel-53"), spec:{minAvailable:2, selector:{matchLabels:{app:"pagos"}}}});
          reconciliar(); S.datos.nodosPagos = [...new Set(S.pods.filter(p => p.ns === "nivel-53" && p.labels.app === "pagos" && p.node).map(p => p.node))]; },
  ok:() => { const pdb = obj("PodDisruptionBudget","nivel-53","pagos-pdb"); if (!pdb || String(pdb.spec.minAvailable) !== "2") return false;
             return listos("nivel-53","pagos") >= 2 && (S.datos.nodosPagos || []).some(nm => { const n = S.nodes.find(x => x.name === nm); return n && n.unsched && !S.pods.some(p => p.node === nm && !esDS(p) && !["Succeeded","Failed"].includes(p.fase)); }); },
  alSuperar(){ nota("(al acabar: kubectl uncordon <nodo>)"); },
  p:["El drain se queda en «Cannot evict pod as it would violate the pod's disruption budget»","kubectl get pdb -n nivel-53  → ALLOWED DISRUPTIONS = 0. ¿Cómo conseguir margen sin tocar el PDB?","Sube pagos a 3 réplicas (kubectl scale) y repite el drain"],
  a:"El PDB protege la disponibilidad en drains, upgrades y Karpenter. Un PDB imposible (minAvailable = réplicas) bloquea el mantenimiento: problema muy real en upgrades de EKS.",
  sol:"kubectl get pods -n nivel-53 -o wide    (mira en qué nodo están)\nkubectl scale deployment pagos --replicas=3 -n nivel-53\nkubectl drain <nodo> --ignore-daemonsets --delete-emptydir-data" },
{ id:54, mundo:7, t:"Nodo caído", tipo:"mision",
  m:"Un nodo está NotReady. En EKS los nodos rotos no se arreglan:\nse SUSTITUYEN. Sustitúyelo por uno sano.",
  prep(){ const n = S.nodes[0]; n.roto = true; n.ready = false; n.rotoDesde = ahora(); S.datos.roto = n.id; },
  ok:() => !S.nodes.some(n => n.id === S.datos.roto) && S.nodes.length === S.ng.desired && S.nodes.every(n => n.ready && !n.terminando) && !S.uniendo.length,
  p:["kubectl get nodes  → ¿cuál está NotReady?","kubectl describe node <nodo>  → el ProviderID acaba en el ID de la instancia EC2 (i-…)","aws ec2 terminate-instances --instance-ids <i-…>   (el node group lanza otro)"],
  a:"Los nodos son ganado, no mascotas: el ASG del node group mantiene desiredSize, así que terminar la instancia mala es el arreglo normal. (Reiniciar el kubelet también lo «arreglaría», pero no sabes qué más está roto.)",
  sol:"kubectl describe node <nodo-NotReady> | grep ProviderID\naws ec2 terminate-instances --instance-ids <i-…>\nkubectl get nodes   (espera al nuevo: «sleep 10»)" },
{ id:55, mundo:7, t:"El DNS ha caído", tipo:"mision",
  m:"🚨 «cliente» (nivel-55) no resuelve nombres y nada en el cluster encuentra\na nadie. La causa NO está en nivel-55. Encuéntrala y deja «cliente» listo.",
  prep(){ mkNs("nivel-55"); obj("Deployment","kube-system","coredns").spec.replicas = 0;
          mkDep("nivel-55","cliente",{image:"busybox:1.37", cmd:["sleep","3600"], readiness:{exec:{command:["nslookup","kubernetes.default.svc.cluster.local"]}, periodSeconds:5, timeoutSeconds:3}}); },
  ok:() => listos("nivel-55","cliente") === 1 && corednsListos() >= 1,
  p:["Prueba: kubectl run dns --rm -it --image=busybox:1.37 -n nivel-55 -- nslookup kubernetes.default","¿Quién resuelve los nombres DENTRO del cluster? Mira kubectl get deploy -n kube-system","kubectl scale deployment coredns --replicas=2 -n kube-system"],
  a:"CoreDNS es crítico: sin él nada encuentra a nada. Si «falla todo a la vez», mira primero kube-system.",
  sol:"kubectl get deploy -n kube-system\nkubectl scale deployment coredns --replicas=2 -n kube-system" },
{ id:56, mundo:7, t:"JEFE DE GUARDIA: la tienda caída", tipo:"mision",
  m:"🔥 La tienda online (nivel-56) no carga los precios.\nHay MÁS DE UN fallo. Encuéntralos todos y arréglalo.",
  prep(){ mkNs("nivel-56"); mkDep("nivel-56","api-precios",{replicas:2, image:"nginx:1.27-alpne", cname:"nginx", ports:[{containerPort:80}]});
          mkSvc("nivel-56","api-precios",{selector:{app:"api-precio"}});
          mkDep("nivel-56","tienda-web",{image:"busybox:1.37", cmd:["sleep","3600"], env:[{name:"API_URL", value:"http://api-precios:8080"}], readiness:SONDA_WGET_API}); },
  ok:() => listos("nivel-56","api-precios") === 2 && listos("nivel-56","tienda-web") === 1,
  p:["Ve de abajo arriba: ¿están bien los Pods de api-precios? (kubectl get pods / describe)","Después: ¿tiene endpoints el Service api-precios?","Por último: ¿a qué URL y PUERTO llama tienda-web? (kubectl set env deployment/tienda-web --list -n nivel-56)"],
  a:"En producción los fallos vienen en cadena. Método: de abajo arriba (Pods → Service → quien llama), un fallo cada vez, comprobando entre medias.",
  sol:"kubectl set image deployment/api-precios nginx=nginx:1.27-alpine -n nivel-56\nkubectl set selector service api-precios app=api-precios -n nivel-56\nkubectl set env deployment/tienda-web API_URL=http://api-precios -n nivel-56" },
/* ===================== MUNDO 8 · Bajo el capó ===================== */
{ id:57, mundo:8, t:"¿Quién es el PID 1?", tipo:"pregunta",
  m:"Un contenedor no es una máquina virtual: es un PROCESO del nodo, aislado.\nEntra en el contenedor de «web» (nivel-57) y averigua qué programa es su PID 1.\n\nResponde con el nombre del programa:  responder <programa>",
  prep(){ mkNs("nivel-57"); mkDep("nivel-57","web",{cname:"nginx", ports:[{containerPort:80}]}); },
  resp:() => "nginx", acepta:v => /nginx/i.test(v),
  p:["kubectl exec -it deploy/web -n nivel-57 -- sh   (y dentro: ps)","Sin entrar: kubectl exec deploy/web -n nivel-57 -- cat /proc/1/cmdline","El PID 1 es el proceso que arranca la imagen (su CMD/ENTRYPOINT)"],
  a:"Dentro del contenedor tu programa es el PID 1 porque vive en su propio «PID namespace» de Linux. Si el PID 1 muere, el contenedor muere: por eso nginx corre con «daemon off» (en primer plano). En el nodo, ese mismo proceso tiene otro PID normal y corriente.",
  sol:"kubectl exec -it deploy/web -n nivel-57 -- sh\nps\nexit\nresponder nginx" },
{ id:58, mundo:8, t:"El límite de memoria, visto por el kernel", tipo:"pregunta",
  m:"Los «limits» del YAML acaban escritos en un fichero del kernel: el cgroup v2 del contenedor.\n¿Qué número EXACTO ve el kernel como límite de memoria del contenedor de «api» (nivel-58)?\n\nResponde en bytes:  responder <número>",
  prep(){ mkNs("nivel-58"); mkDep("nivel-58","api",{image:"busybox:1.37", cmd:["sleep","3600"], req:{cpu:"100m", memory:"96Mi"}, lim:{cpu:"500m", memory:"192Mi"}}); },
  resp:() => String(192 * 1048576),
  p:["Entra: kubectl exec -it deploy/api -n nivel-58 -- sh","Los ficheros del cgroup están en /sys/fs/cgroup/ (ls /sys/fs/cgroup)","cat /sys/fs/cgroup/memory.max   (y compáralo con kubectl get deploy api -n nivel-58 -o yaml)"],
  a:"El kubelet traduce limits.memory a /sys/fs/cgroup/memory.max (192Mi = 192 × 1024 × 1024 = 201326592 bytes). Si el proceso pasa de ahí, el kernel lo mata: OOMKilled, exit 137. memory.current es lo que usa ahora mismo y memory.events cuenta los OOM.",
  sol:"kubectl exec deploy/api -n nivel-58 -- cat /sys/fs/cgroup/memory.max\nresponder 201326592" },
{ id:59, mundo:8, t:"CPU: cuota y periodo", tipo:"pregunta",
  m:"La CPU no se «reserva»: se reparte en periodos de 100 ms.\n¿Cuántos MICROSEGUNDOS de CPU puede gastar el contenedor de «calc» (nivel-59) en cada periodo?\n\nResponde con el número:  responder <microsegundos>",
  prep(){ mkNs("nivel-59"); mkDep("nivel-59","calc",{image:"busybox:1.37", cmd:["sleep","3600"], req:{cpu:"100m", memory:"32Mi"}, lim:{cpu:"300m", memory:"64Mi"}}); },
  resp:() => "30000", acepta:v => String(v).trim().split(/\s+/)[0] === "30000",
  p:["kubectl exec -it deploy/calc -n nivel-59 -- sh","cat /sys/fs/cgroup/cpu.max   → dos números: «cuota periodo»","300m = 0,3 CPU → ¿cuánto es el 30 % de 100000 µs?"],
  a:"cpu.max = «cuota periodo»: 300m son 30000 µs de cada 100000 (30 ms de cada 100 ms). Si los gasta antes, el kernel lo FRENA hasta el siguiente periodo (throttling: nr_throttled en cpu.stat). Pasarse de CPU ralentiza; pasarse de memoria mata. Los requests van a cpu.weight (el reparto cuando hay competencia).",
  sol:"kubectl exec deploy/calc -n nivel-59 -- cat /sys/fs/cgroup/cpu.max\nresponder 30000" },
{ id:60, mundo:8, t:"Capabilities: los superpoderes de root", tipo:"pregunta",
  m:"«root» dentro de un contenedor no tiene todos los poderes: tiene un juego de CAPABILITIES.\nEn nivel-60 hay dos Deployments: «normal» y «blindado».\n¿Qué CapEff (capabilities efectivas) tiene el PID 1 de «normal»?\n\nResponde con el valor hexadecimal:  responder <hex>",
  prep(){ mkNs("nivel-60"); mkDep("nivel-60","normal",{cname:"nginx", ports:[{containerPort:80}]});
          mkDep("nivel-60","blindado",{image:"nginxinc/nginx-unprivileged:1.28-alpine", cname:"nginx", ports:[{containerPort:8080}],
            csc:{allowPrivilegeEscalation:false, capabilities:{drop:["ALL"]}, runAsNonRoot:true}, psc:{seccompProfile:{type:"RuntimeDefault"}}}); },
  resp:() => "00000000a80425fb", acepta:v => { const x = String(v).trim().replace(/^0x/i, ""); return /^[0-9a-f]+$/i.test(x) && parseInt(x, 16) === 0xa80425fb; },
  p:["kubectl exec deploy/normal -n nivel-60 -- cat /proc/1/status","Busca la línea CapEff:","Haz lo mismo con «blindado»: ¿por qué sale todo a ceros? (mira su securityContext)"],
  a:"CapEff es una máscara de bits: a80425fb son las 14 capabilities que containerd da por defecto (CHOWN, NET_BIND_SERVICE, KILL, SETUID…). Con capabilities.drop: [\"ALL\"] y un usuario que no es root, el proceso se queda en 0000000000000000: aunque alguien entre, no puede hacer casi nada. Es lo que exige la Pod Security «restricted».",
  sol:"kubectl exec deploy/normal -n nivel-60 -- cat /proc/1/status\n(CapEff: 00000000a80425fb)\nresponder 00000000a80425fb" },
{ id:61, mundo:8, t:"Un token que nadie usa", tipo:"mision",
  m:"Cada Pod lleva montado, por defecto, un TOKEN de su ServiceAccount para hablar con la API de Kubernetes.\n«web» (nivel-61) no usa la API para nada… pero el token está ahí: quien entre en el contenedor se lo lleva.\n\nHaz que los Pods de «web» NO monten el token (y que «web» siga funcionando).",
  prep(){ mkNs("nivel-61"); mkDep("nivel-61","web",{cname:"nginx", replicas:2, ports:[{containerPort:80}]}); },
  ok:() => { const d = dObj("nivel-61","web"); if (!d) return false; const ps = podsDeDeployment(d).filter(p => !p.borrando);
             return ps.length >= 2 && ps.every(p => p.listo && p.tokenMontado === false) && S.pods.filter(p => p.ns === "nivel-61" && !p.borrando && p.fase === "Running").every(p => p.tokenMontado === false); },
  p:["Míralo dentro: kubectl exec deploy/web -n nivel-61 -- ls /var/run/secrets/kubernetes.io/serviceaccount","El campo es automountServiceAccountToken: false (en la ServiceAccount o en el spec del Pod)","El token se decide AL CREAR el Pod: si cambias la ServiceAccount, los Pods que ya existen siguen con él → kubectl rollout restart"],
  a:"Mínimo privilegio también dentro del Pod: si la aplicación no llama a la API de Kubernetes, no le des credenciales. automountServiceAccountToken: false en la ServiceAccount (vale para todos sus Pods) o en el Pod. Ojo: se aplica a los Pods NUEVOS.",
  sol:"kubectl patch serviceaccount default -n nivel-61 -p '{\"automountServiceAccountToken\":false}'\nkubectl rollout restart deployment web -n nivel-61\n(o en el Deployment: kubectl patch deployment web -n nivel-61 -p '{\"spec\":{\"template\":{\"spec\":{\"automountServiceAccountToken\":false}}}}')" },
{ id:62, mundo:8, t:"Esperando a la base de datos", tipo:"mision",
  m:"La aplicación «app» de nivel-62 lleva un buen rato en Init:0/1 y no arranca.\nAveriguar a qué espera es parte del trabajo.\n\nArréglalo SIN tocar el Deployment «app».",
  prep(){ mkNs("nivel-62"); mkDep("nivel-62","bd",{cname:"bd", ports:[{containerPort:80}]});
          mkDep("nivel-62","app",{cname:"nginx", ports:[{containerPort:80}],
            inits:[{name:"espera-bd", image:"busybox:1.37", command:["sh","-c","until nslookup bd; do echo esperando a bd; sleep 2; done"]}]}); },
  ok:() => { const d = dObj("nivel-62","app"); const ic = d && (d.spec.template.spec.initContainers || [])[0];
             return !!ic && ic.name === "espera-bd" && /until nslookup bd/.test((ic.command || []).join(" ")) && listos("nivel-62","app") === 1; },
  p:["kubectl get pods -n nivel-62   → ¿qué significa Init:0/1?","Los init containers tienen sus propios logs: kubectl logs deploy/app -c espera-bd -n nivel-62","Espera a que el NOMBRE «bd» resuelva por DNS… y en Kubernetes los nombres los dan los Services"],
  a:"Los init containers se ejecutan en orden y cada uno debe terminar bien antes de que arranque el contenedor principal: son el sitio para «esperar a la base de datos» o preparar ficheros. Init:0/1 = el primero aún no ha terminado. Se depuran con logs -c <init>.",
  sol:"kubectl logs deploy/app -c espera-bd -n nivel-62\nkubectl expose deployment bd --port=80 -n nivel-62" },
{ id:63, mundo:8, t:"Credenciales de AWS sin claves", tipo:"mision",
  m:"El Deployment «subidor» (nivel-63, ServiceAccount «subidor») tiene que escribir en S3 con el rol IAM:\n  arn:aws:iam::123456789012:role/eks-quest-s3-subidor\n\nDáselo con EKS Pod Identity (nada de access keys en Secrets) y comprueba DENTRO del Pod que le llegan las credenciales.",
  prep(){ mkNs("nivel-63"); guardarObj({apiVersion:"v1", kind:"ServiceAccount", metadata:metaNueva("subidor","nivel-63")});
          mkDep("nivel-63","subidor",{image:"busybox:1.37", cmd:["sleep","3600"], sa:"subidor"}); },
  ok:() => (S.podIdentity || []).some(a => a.ns === "nivel-63" && a.sa === "subidor" && a.role === "arn:aws:iam::123456789012:role/eks-quest-s3-subidor")
           && S.pods.some(p => p.ns === "nivel-63" && p.listo && p.spec.serviceAccountName === "subidor" && (p.spec.containers[0].env || []).some(e => e.name === "AWS_CONTAINER_CREDENTIALS_FULL_URI")),
  p:["La asociación se crea en AWS (no en kubectl): aws eks create-pod-identity-association --cluster-name eks-juego --namespace … --service-account … --role-arn …","El agente (DaemonSet eks-pod-identity-agent en kube-system) entrega las credenciales; las VARIABLES se inyectan al CREAR el Pod","kubectl rollout restart deployment subidor -n nivel-63   y luego   kubectl exec deploy/subidor -n nivel-63 -- env | grep AWS_"],
  a:"Pod Identity = asociación (namespace + ServiceAccount → rol IAM) + agente en cada nodo. El Pod recibe AWS_CONTAINER_CREDENTIALS_FULL_URI y un token; los SDK de AWS lo usan solos. Sin claves que caduquen ni Secrets que se filtren. Los Pods ya creados no la ven: hay que recrearlos.",
  sol:"aws eks create-pod-identity-association --cluster-name eks-juego --namespace nivel-63 --service-account subidor --role-arn arn:aws:iam::123456789012:role/eks-quest-s3-subidor\nkubectl rollout restart deployment subidor -n nivel-63\nkubectl exec deploy/subidor -n nivel-63 -- env | grep AWS_" },
{ id:64, mundo:8, t:"Un contenedor sin shell", tipo:"pregunta",
  m:"«minimo» (nivel-64) usa una imagen mínima: no trae ni sh, ni ps, ni cat. «kubectl exec» no sirve.\n¿Cuál es el comando de su PID 1?\n\nResponde:  responder <comando>",
  prep(){ mkNs("nivel-64"); mkDep("nivel-64","minimo",{image:"registry.k8s.io/pause:3.10"}); },
  resp:() => "/pause", acepta:v => /^\/?pause$/i.test(String(v).trim()),
  p:["Prueba: kubectl exec deploy/minimo -n nivel-64 -- sh   (falla: no hay shell)","Un contenedor EFÍMERO de depuración se mete en el Pod con sus propias herramientas: kubectl debug","kubectl debug -it deploy/minimo -n nivel-64 --image=busybox:1.37 --target=minimo   y dentro: ps"],
  a:"kubectl debug añade un contenedor efímero al Pod. Con --target comparte el espacio de PROCESOS del contenedor objetivo, así que ves su PID 1 (/pause) y su /proc/1/root aunque la imagen no tenga nada. Imágenes «distroless» = menos superficie de ataque, y así se depuran.",
  sol:"kubectl debug -it deploy/minimo -n nivel-64 --image=busybox:1.37 --target=minimo\nps\nexit\nresponder /pause" },
{ id:65, mundo:8, t:"Un auditor para todo el cluster", tipo:"mision",
  m:"La ServiceAccount «auditor» (nivel-65) alimenta un panel de inventario.\nTiene que poder VER y LISTAR los Pods de TODOS los namespaces.\nY nada más: ni borrar, ni Secrets, ni Deployments.",
  prep(){ mkNs("nivel-65"); guardarObj({apiVersion:"v1", kind:"ServiceAccount", metadata:metaNueva("auditor","nivel-65")}); },
  ok:() => { const sa = "system:serviceaccount:nivel-65:auditor";
             return puede(sa,"list","pods",null) && puede(sa,"get","pods",null) && puede(sa,"list","pods","kube-system")
               && !puede(sa,"delete","pods",null) && !puede(sa,"list","secrets","kube-system") && !puede(sa,"list","deployments",null) && !puede(sa,"create","pods","default"); },
  p:["Un Role + RoleBinding vale para UN namespace. Para todos: ClusterRole + ClusterRoleBinding","kubectl create clusterrole ver-pods-global --verb=get,list,watch --resource=pods","Compruébalo: kubectl auth can-i list pods -A --as=system:serviceaccount:nivel-65:auditor   (y list secrets, list deployments…)"],
  a:"ClusterRole = permisos sin namespace; ClusterRoleBinding = dárselos a alguien en TODO el cluster. Cuidado con el atajo de enlazar el ClusterRole «view»: también deja ver Deployments, Services, ConfigMaps… Mínimo privilegio = tu propio ClusterRole.",
  sol:"kubectl create clusterrole ver-pods-global --verb=get,list,watch --resource=pods\nkubectl create clusterrolebinding auditor-ver-pods --clusterrole=ver-pods-global --serviceaccount=nivel-65:auditor" },
{ id:66, mundo:8, t:"JEFE FINAL: el servicio blindado", tipo:"mision",
  m:"🔥 «pedidos» (nivel-66) corre en un namespace con Pod Security «restricted»: todo debe ir como no-root y sin capabilities.\nNo hay forma de que se ponga en marcha. Hay VARIOS fallos, y unos esconden a otros.\n\nDeja los 2 Pods de «pedidos» listos SIN rebajar la seguridad del namespace.",
  prep(){ mkNs("nivel-66", {"pod-security.kubernetes.io/enforce":"restricted"});
          const seg = {allowPrivilegeEscalation:false, capabilities:{drop:["ALL"]}};
          const psc = {runAsNonRoot:true, seccompProfile:{type:"RuntimeDefault"}};
          mkDep("nivel-66","cola",{image:"nginxinc/nginx-unprivileged:1.28-alpine", cname:"cola", ports:[{containerPort:8080}], csc:seg, psc});
          mkDep("nivel-66","pedidos",{image:"nginxinc/nginx-unprivileged:1.28-alpine", cname:"pedidos", replicas:2, ports:[{containerPort:8080}], csc:seg, psc,
            env:[{name:"COLA_PASSWORD", secret:["cola-cred","password"]}],
            readiness:{httpGet:{path:"/healthz", port:8080}, periodSeconds:5},
            inits:[{name:"espera-cola", image:"busybox:1.37", command:["sh","-c","until nslookup cola; do echo esperando a cola; sleep 2; done"], securityContext:Object.assign({runAsUser:1000}, seg)}]}); },
  ok:() => { const d = dObj("nivel-66","pedidos"); const ns = S.ns["nivel-66"];
             return !!d && (d.spec.template.spec.initContainers || []).length === 1 && ns && ns.labels["pod-security.kubernetes.io/enforce"] === "restricted"
               && listos("nivel-66","pedidos") === 2; },
  p:["De fuera adentro: kubectl get pods -n nivel-66  → ¿Init? ¿Config? ¿0/1?  Y kubectl logs <pod> -c espera-cola -n nivel-66","Cuando pase el init: kubectl describe pod … → ¿falta un Secret? (créalo: kubectl create secret generic …)","Al final: Running pero 0/1 → la readiness. ¿Responde nginx en /healthz? (kubectl exec … -- wget -qO- http://localhost:8080/healthz)"],
  a:"Los fallos vienen en capas: el init container tapa el Secret que falta, y el Secret tapa la sonda mal puesta. Método: arregla el primero, MIRA otra vez, y sigue. Y en un namespace «restricted» la solución nunca es quitar la seguridad.",
  sol:"kubectl logs deploy/pedidos -c espera-cola -n nivel-66\nkubectl expose deployment cola --port=8080 -n nivel-66\nkubectl create secret generic cola-cred --from-literal=password=s3cret0 -n nivel-66\nkubectl patch deployment pedidos -n nivel-66 --type=json -p '[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/readinessProbe/httpGet/path\",\"value\":\"/\"}]'" },
];
const MAX = NIVELES.length - 1;

/* estado base antes de cada nivel */
function estadoBase(){
  for (const n of Object.keys(S.ns)) if (/^nivel-\d+/.test(n) || n === "mi-equipo") borrarNamespace(n);
  for (const n of S.nodes.slice()){
    n.unsched = false; n.taints = n.taints.filter(t => t.key !== "mantenimiento"); delete n.extra.hardware;
    if (n.roto || n.terminando){ S.nodes = S.nodes.filter(x => x !== n); S.pods = S.pods.filter(p => p.node !== n.name); S.nodes.push(nuevoNodo(n.az)); }
  }
  S.uniendo = [];
  while (S.nodes.length > S.ng.desired) { const n = S.nodes.pop(); S.pods = S.pods.filter(p => p.node !== n.name); }
  while (S.nodes.length < S.ng.desired) S.nodes.push(nuevoNodo(S.nodes.length % 2 ? "eu-west-1b" : "eu-west-1a"));
  for (const nombre of ["coredns","metrics-server"]){ const d = obj("Deployment","kube-system",nombre); if (!d || (d.spec.replicas ?? 0) < 2){ if (d) d.spec.replicas = 2; else { const x = clusterNuevoParcial(nombre); if (x) guardarObj(x); } } }
  S.objs = S.objs.filter(o => o.kind !== "ClusterRole" && o.kind !== "ClusterRoleBinding");   // los ClusterRoles predefinidos viven aparte (CLUSTERROLES)
  S.podIdentity = [];
  S.pf = {}; S.datos = {};
  if (S.defNs){ S.defNs = null; }
  reconciliar();
}
function clusterNuevoParcial(nombre){
  const img = nombre === "coredns" ? `${ECR}/eks/coredns:v1.14.7-eksbuild.35` : `${ECR}/eks/metrics-server:v0.9.1-eksbuild.2`;
  return {apiVersion:"apps/v1", kind:"Deployment", metadata:metaNueva(nombre, "kube-system", {labels:{"k8s-app":nombre}}),
    spec:{replicas:2, selector:{matchLabels:{"k8s-app":nombre}}, template:{metadata:{labels:{"k8s-app":nombre}}, spec:{priorityClassName:"system-cluster-critical", tolerations:[{operator:"Exists"}], containers:[{name:nombre, image:img, resources:{requests:{cpu:"100m", memory:nombre === "coredns" ? "70Mi" : "200Mi"}}}]}}}};
}
