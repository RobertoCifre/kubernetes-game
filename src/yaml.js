/* ============================================================================
   yaml.js — lector y escritor de YAML (el subconjunto que usa Kubernetes)
   Soporta: mapas y listas en bloque, "- clave: valor", escalares con y sin
   comillas, números/booleanos/null, listas y mapas en línea ([a, b] {a: b}),
   bloques literales | y |-, comentarios. Errores con número de línea.
   ========================================================================== */
"use strict";

function quitarComentario(s){
  let q=null;
  for (let i=0;i<s.length;i++){
    const c=s[i];
    if (q){ if (c===q && s[i-1]!=="\\") q=null; continue; }
    if (c==='"'||c==="'"){ q=c; continue; }
    if (c==="#" && (i===0 || /\s/.test(s[i-1]))) return s.slice(0,i).replace(/\s+$/,"");
  }
  return s.replace(/\s+$/,"");
}

function partirEnLinea(s, sep){           // parte "a, [b, c], 'd,e'" respetando comillas y anidamiento
  const r=[]; let prof=0, q=null, act="";
  for (const c of s){
    if (q){ act+=c; if (c===q) q=null; continue; }
    if (c==='"'||c==="'"){ q=c; act+=c; continue; }
    if (c==="["||c==="{") prof++;
    if (c==="]"||c==="}") prof--;
    if (c===sep && prof===0){ r.push(act.trim()); act=""; continue; }
    act+=c;
  }
  if (act.trim()!=="") r.push(act.trim());
  return r;
}

function yEscalar(v){
  v=v.trim();
  if (v==="") return null;
  if (v.startsWith('"')){
    if (!v.endsWith('"') || v.length<2) throw new Error(`comillas sin cerrar: ${v}`);
    return v.slice(1,-1).replace(/\\n/g,"\n").replace(/\\t/g,"\t").replace(/\\"/g,'"').replace(/\\\\/g,"\\");
  }
  if (v.startsWith("'")){
    if (!v.endsWith("'") || v.length<2) throw new Error(`comillas sin cerrar: ${v}`);
    return v.slice(1,-1).replace(/''/g,"'");
  }
  if (v.startsWith("[")){
    if (!v.endsWith("]")) throw new Error(`corchete sin cerrar: ${v}`);
    const dentro=v.slice(1,-1).trim(); return dentro===""?[]:partirEnLinea(dentro,",").map(yEscalar);
  }
  if (v.startsWith("{")){
    if (!v.endsWith("}")) throw new Error(`llave sin cerrar: ${v}`);
    const o={}; const dentro=v.slice(1,-1).trim(); if (dentro==="") return o;
    for (const par of partirEnLinea(dentro,",")){
      const m=par.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(.*)$/); if (!m) throw new Error(`par «clave: valor» inválido: ${par}`);
      o[yEscalar(m[1])] = yEscalar(m[2]);
    }
    return o;
  }
  if (/^(true|True|TRUE)$/.test(v)) return true;
  if (/^(false|False|FALSE)$/.test(v)) return false;
  if (/^(null|Null|NULL|~)$/.test(v)) return null;
  if (/^-?\d+$/.test(v)) return parseInt(v,10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

function yamlParse(texto){
  const crudas=texto.replace(/\r/g,"").split("\n");
  const L=[];
  crudas.forEach((raw,idx)=>{
    if (!raw.trim() || /^\s*#/.test(raw)) { L.push({vacia:true,raw,n:idx+1}); return; }
    const sangria=raw.match(/^[ \t]*/)[0];
    if (sangria.includes("\t")) throw new Error(`línea ${idx+1}: YAML no admite tabuladores para sangrar (usa espacios)`);
    L.push({ind:sangria.length, txt:quitarComentario(raw.trim()), raw, n:idx+1});
  });
  const util=L.filter(l=>!l.vacia);
  let i=0;
  const esItem = t => t==="-" || t.startsWith("- ");
  const esClave = t => /^("[^"]*"|'[^']*'|[^\s"'\[{][^:]*?):(\s|$)/.test(t);

  function bloqueLiteral(idxRaw, indPadre, modo){
    const lineas=[]; let k=idxRaw+1;
    while (k<L.length){ const l=L[k]; if (!l.vacia && l.ind<=indPadre) break; lineas.push(l.raw); k++; }
    while (lineas.length && !lineas[lineas.length-1].trim()) lineas.pop();
    const min=Math.min(...lineas.filter(x=>x.trim()).map(x=>x.match(/^ */)[0].length));
    const txt=lineas.map(x=>x.slice(isFinite(min)?min:0)).join("\n");
    // saltar en `util` las líneas consumidas
    while (i<util.length && util[i].n<= (L[k-1]?L[k-1].n:0)) i++;
    return modo==="|-" ? txt : txt+"\n";
  }

  function nodo(ind){
    if (i>=util.length) return null;
    return esItem(util[i].txt) ? lista(util[i].ind) : mapa(util[i].ind);
  }
  function lista(ind){
    const arr=[];
    while (i<util.length && util[i].ind===ind && esItem(util[i].txt)){
      const l=util[i]; const resto=l.txt==="-"?"":l.txt.slice(1).trim();
      if (!resto){ i++; arr.push(i<util.length && util[i].ind>ind ? nodo(util[i].ind) : null); continue; }
      if (esClave(resto)){
        const despl = l.txt.length - l.txt.slice(1).trimStart().length;   // posición del contenido tras "- "
        util[i]={ind:ind+despl, txt:resto, raw:l.raw, n:l.n};
        arr.push(mapa(ind+despl)); continue;
      }
      i++; arr.push(yEscalar(resto));
    }
    return arr;
  }
  function mapa(ind){
    const obj={};
    while (i<util.length && util[i].ind===ind && !esItem(util[i].txt)){
      const l=util[i];
      const m=l.txt.match(/^("[^"]*"|'[^']*'|[^:]+?):(?:\s+(.*))?$/);
      if (!m) throw new Error(`línea ${l.n}: se esperaba «clave: valor» y hay «${l.txt}»`);
      const clave=String(yEscalar(m[1].trim())); const val=m[2];
      if (clave in obj) throw new Error(`línea ${l.n}: la clave «${clave}» está repetida`);
      i++;
      if (val===undefined || val===""){
        if (i<util.length && (util[i].ind>ind || (util[i].ind===ind && esItem(util[i].txt)))) obj[clave]=nodo(util[i].ind);
        else obj[clave]=null;
      } else if (val==="|" || val==="|-" || val===">" || val===">-"){
        const idxRaw=L.findIndex(x=>x.n===l.n);
        obj[clave]=bloqueLiteral(idxRaw, ind, val);
      } else obj[clave]=yEscalar(val);
    }
    if (i<util.length && util[i].ind>ind) throw new Error(`línea ${util[i].n}: sangría inesperada (¿espacios de más?)`);
    return obj;
  }
  const r = nodo(util.length?util[0].ind:0);
  if (i<util.length) throw new Error(`línea ${util[i].n}: sangría incoherente («${util[i].txt}»)`);
  return r;
}

/* documentos separados por --- */
function yamlParseTodos(texto){
  return texto.split(/^---\s*$/m).map(t=>t.trim()).filter(t=>t && t.split("\n").some(l=>l.trim() && !l.trim().startsWith("#"))).map(yamlParse);
}

function yStr(v){
  if (v===null || v===undefined) return "null";
  if (typeof v==="number" || typeof v==="boolean") return String(v);
  const s=String(v);
  if (s==="") return '""';
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s) || /^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s) || /: |\s#|^\s|\s$/.test(s) || s.includes('"'))
    return '"'+s.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n")+'"';
  return s;
}
function yamlDump(v, ind=0){
  const pad=" ".repeat(ind);
  if (Array.isArray(v)){
    if (!v.length) return "[]";
    return v.map(x=>{
      if (x && typeof x==="object" && !Array.isArray(x)){
        const claves=Object.keys(x); if (!claves.length) return pad+"- {}";
        const cuerpo=yamlDump(x, ind+2).split("\n");
        cuerpo[0]=pad+"- "+cuerpo[0].slice(ind+2);
        return cuerpo.join("\n");
      }
      if (Array.isArray(x)) return pad+"- "+(x.length?"\n"+yamlDump(x,ind+2):"[]");
      return pad+"- "+yStr(x);
    }).join("\n");
  }
  if (v && typeof v==="object"){
    const claves=Object.keys(v); if (!claves.length) return "{}";
    return claves.map(k=>{
      const x=v[k]; const kk=/^[\w.\/-]+$/.test(k)?k:yStr(k);
      if (x && typeof x==="object"){
        if (Array.isArray(x)) return x.length? `${pad}${kk}:\n${yamlDump(x,ind)}` : `${pad}${kk}: []`;
        return Object.keys(x).length? `${pad}${kk}:\n${yamlDump(x,ind+2)}` : `${pad}${kk}: {}`;
      }
      if (typeof x==="string" && x.includes("\n")) return `${pad}${kk}: |\n`+x.replace(/\n$/,"").split("\n").map(l=>pad+"  "+l).join("\n");
      return `${pad}${kk}: ${yStr(x)}`;
    }).join("\n");
  }
  return pad+yStr(v);
}

/* ---------------- JSONPath (lo que usa kubectl -o jsonpath) ---------------- */
function jpSegmentos(expr){
  const s=[]; let i=0; expr=expr.trim();
  if (expr.startsWith("$")) i=1;
  while (i<expr.length){
    if (expr[i]==="."){ i++; if (expr[i]==="."){ i++; } let m=expr.slice(i).match(/^(?:\\\.|[\w\-\/])+/); if (m){ s.push({t:"k",v:m[0].replace(/\\\./g,".")}); i+=m[0].length; } continue; }
    if (expr[i]==="["){
      const fin=expr.indexOf("]",i); const dentro=expr.slice(i+1,fin).trim(); i=fin+1;
      if (dentro==="*") s.push({t:"*"});
      else if (/^-?\d+$/.test(dentro)) s.push({t:"i",v:parseInt(dentro,10)});
      else if (/^['"].*['"]$/.test(dentro)) s.push({t:"k",v:dentro.slice(1,-1)});
      else if (dentro.startsWith("?(")){
        const m=dentro.match(/^\?\(@\.([\w.\-\/]+)\s*(==|!=)\s*['"]?([^'")]*)['"]?\)$/);
        if (m) s.push({t:"f",ruta:m[1].split("."),op:m[2],v:m[3]});
      }
      continue;
    }
    if (expr[i]==="@"){ i++; continue; }
    const m=expr.slice(i).match(/^[\w\-\/]+/); if (m){ s.push({t:"k",v:m[0]}); i+=m[0].length; } else i++;
  }
  return s;
}
function jpEval(obj, expr){
  let act=[obj];
  for (const seg of jpSegmentos(expr)){
    const sig=[];
    for (const o of act){
      if (o===undefined || o===null) continue;
      if (seg.t==="k"){ if (typeof o==="object" && seg.v in o) sig.push(o[seg.v]); }
      else if (seg.t==="i"){ if (Array.isArray(o)){ const x=o[seg.v<0?o.length+seg.v:seg.v]; if (x!==undefined) sig.push(x); } }
      else if (seg.t==="*"){ if (Array.isArray(o)) sig.push(...o); else if (typeof o==="object") sig.push(...Object.values(o)); }
      else if (seg.t==="f"){ if (Array.isArray(o)) for (const x of o){ let v=x; for (const r of seg.ruta) v=v&&v[r]; const ok = String(v)===seg.v; if (seg.op==="=="?ok:!ok) sig.push(x); } }
    }
    act=sig;
  }
  return act;
}
function jpFormatear(v){ return (v!==null && typeof v==="object") ? JSON.stringify(v) : String(v); }
function jsonpath(obj, plantilla){
  plantilla=plantilla.replace(/^['"]|['"]$/g,"");
  if (!plantilla.includes("{")) plantilla="{"+plantilla+"}";
  const trozos=[]; const re=/\{([^}]*)\}/g; let m, ult=0;
  while ((m=re.exec(plantilla))){ if (m.index>ult) trozos.push({lit:plantilla.slice(ult,m.index)}); trozos.push({exp:m[1].trim()}); ult=re.lastIndex; }
  if (ult<plantilla.length) trozos.push({lit:plantilla.slice(ult)});
  function correr(lista, ctx){
    let salida=""; let k=0;
    while (k<lista.length){
      const t=lista[k];
      if (t.lit!==undefined){ salida+=t.lit; k++; continue; }
      if (t.exp.startsWith("range ")){
        let prof=1, j=k+1; for (; j<lista.length; j++){ const e=lista[j].exp; if (e&&e.startsWith("range ")) prof++; if (e==="end" && --prof===0) break; }
        const cuerpo=lista.slice(k+1,j); for (const x of jpEval(ctx, t.exp.slice(6))) salida+=correr(cuerpo, x);
        k=j+1; continue;
      }
      if (t.exp==="end"){ k++; continue; }
      if (/^".*"$/.test(t.exp)){ salida+=t.exp.slice(1,-1).replace(/\\n/g,"\n").replace(/\\t/g,"\t"); k++; continue; }
      salida+=jpEval(ctx, t.exp).map(jpFormatear).join(" "); k++;
    }
    return salida;
  }
  return correr(trozos, obj);
}

/* ---------------- JMESPath mínimo (aws --query) ---------------- */
function jmes(obj, expr){
  expr=expr.trim().replace(/^['"]|['"]$/g,"");
  const toks=[]; let i=0;
  while (i<expr.length){
    const c=expr[i];
    if (c==="."){ i++; continue; }
    if (c==="["){
      const fin=expr.indexOf("]",i); const d=expr.slice(i+1,fin).trim(); i=fin+1;
      if (d===""||d==="*") toks.push({t:"proy"}); else if (/^-?\d+$/.test(d)) toks.push({t:"idx",v:+d});
      else if (d.startsWith("?")) { const m=d.match(/^\?\s*([\w.]+)\s*==\s*[`'"]([^`'"]*)[`'"]$/); if (m) toks.push({t:"filtro",ruta:m[1],v:m[2]}); }
      else toks.push({t:"multi",v:partirEnLinea(d,",")});
      continue;
    }
    const m=expr.slice(i).match(/^[\w\-]+/); if (m){ toks.push({t:"k",v:m[0]}); i+=m[0].length; } else i++;
  }
  function aplicar(v, ts){
    for (let k=0;k<ts.length;k++){
      const t=ts[k]; if (v===undefined||v===null) return null;
      if (t.t==="k") v=v[t.v];
      else if (t.t==="idx") v=Array.isArray(v)?v[t.v<0?v.length+t.v:t.v]:null;
      else if (t.t==="multi") v=t.v.map(e=>jmes(v,e));
      else if (t.t==="filtro" || t.t==="proy"){
        if (!Array.isArray(v)) return null;
        let arr=v; if (t.t==="filtro") arr=arr.filter(x=>String(jmes(x,t.ruta))===t.v);
        const resto=ts.slice(k+1); const r=[];
        for (const x of arr){ const y=aplicar(x,resto); if (y===null||y===undefined) continue; if (Array.isArray(y) && resto.some(z=>z.t==="proy")) r.push(...y); else r.push(y); }
        return r;
      }
    }
    return v===undefined?null:v;
  }
  return aplicar(obj,toks);
}
