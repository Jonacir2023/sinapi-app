'use strict';

const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];
const DB_URL = "sinapi_nacional_202605.db.gz";
const BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const NUM = (n,d=4)=>Number(n).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});

let db=null, uf='MG', orc={nome:'',uf:'MG',bdi:0,itens:[]}, searchTimer=null;

// ---------- boot ----------
const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800);}

// UF selector
const ufSel=$('#ufSel');
UFS.forEach(u=>{const o=document.createElement('option');o.value=u;o.textContent=u;if(u==='MG')o.selected=true;ufSel.appendChild(o);});
ufSel.onchange=()=>{uf=ufSel.value;orc.uf=uf;$('#orcUf').textContent=uf;renderResults();renderConsulta();recalcOrc();toast('UF: '+uf);};
$('#orcUf').textContent=uf;

// tabs
$$('.tab').forEach(t=>t.onclick=()=>{
  $$('.tab').forEach(x=>x.classList.remove('on'));t.classList.add('on');
  $$('.view').forEach(v=>v.classList.remove('on'));
  $('#v-'+t.dataset.view).classList.add('on');
  const showTot=(t.dataset.view==='orcamento'&&orc.itens.length>0);
  $('#totbar').style.display=showTot?'block':'none';
  if(t.dataset.view==='salvos')renderSaved();
});

// ---------- load DB ----------
async function loadDB(){
  try{
    const SQL=await initSqlJs({locateFile:f=>`https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`});
    const resp=await fetch(DB_URL);
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    const total=+resp.headers.get('Content-Length')||11000000;
    const reader=resp.body.getReader();
    let chunks=[],received=0;
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      chunks.push(value);received+=value.length;
      const pct=Math.min(100,Math.round(received/total*100));
      $('#dlBar').style.width=pct+'%';
      $('#dlText').textContent=`${(received/1048576).toFixed(1)} MB`;
    }
    const gz=new Uint8Array(received);let pos=0;
    for(const c of chunks){gz.set(c,pos);pos+=c.length;}
    $('#dlText').textContent='descomprimindo…';
    const raw=pako.ungzip(gz);
    db=new SQL.Database(raw);
    const ref=db.exec("SELECT valor FROM meta WHERE chave='referencia'")[0].values[0][0];
    $('#refLabel').textContent='Ref. '+ref+' · 27 UFs';
    // popular filtro de grupos
    const grps=db.exec("SELECT DISTINCT TRIM(REPLACE(grupo,' - continuação','')) g FROM composicoes WHERE grupo IS NOT NULL ORDER BY g")[0].values;
    const gf=$('#grpFilter');
    grps.forEach(([g])=>{const o=document.createElement('option');o.value=g;o.textContent=g;gf.appendChild(o);});
    $('#dbLoading').style.display='none';
    $('#searchUI').style.display='block';
    loadDraft();
  }catch(e){
    $('#dbLoading').innerHTML=`<div class="empty"><b>Falha ao carregar base</b>${e.message}<br><br>Verifique se <span class="mono">${DB_URL}</span> está no mesmo diretório e servido via HTTPS (GitHub Pages).</div>`;
  }
}

// ---------- search ----------
$('#q').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderResults,180);});
$('#grpFilter').addEventListener('change',renderResults);

function renderResults(){
  if(!db)return;
  const raw=$('#q').value.trim();
  const grp=$('#grpFilter').value;
  const box=$('#results');
  if(raw.length<2&&!grp){box.innerHTML='<div class="empty"><b>Buscar composição</b>Digite código ou 2+ letras da descrição.</div>';return;}
  let sql,params;
  const isCode=/^\d+$/.test(raw);
  let where=[],p=[];
  if(isCode){where.push("c.codigo LIKE ?");p.push(raw+'%');}
  else if(raw){
    const terms=raw.toUpperCase().split(/\s+/).filter(Boolean);
    terms.forEach(t=>{where.push("UPPER(c.descricao) LIKE ?");p.push('%'+t+'%');});
  }
  if(grp){where.push("TRIM(REPLACE(c.grupo,' - continuação',''))=?");p.push(grp);}
  sql=`SELECT c.codigo,c.descricao,c.unidade,TRIM(REPLACE(c.grupo,' - continuação','')) grp,cu.custo
       FROM composicoes c
       LEFT JOIN custos_uf cu ON cu.codigo=c.codigo AND cu.uf='${uf}'
       ${where.length?'WHERE '+where.join(' AND '):''}
       ORDER BY (cu.custo IS NULL), c.codigo LIMIT 30`;
  const res=db.exec(sql,p);
  if(!res.length||!res[0].values.length){box.innerHTML='<div class="empty"><b>Nada encontrado</b>Ajuste o termo ou o grupo.</div>';return;}
  box.innerHTML=res[0].values.map(([cod,desc,un,g,custo])=>{
    const inOrc=orc.itens.some(i=>i.codigo===cod);
    const costHtml=custo!=null?`<span class="cost">${BRL.format(custo)}<small> /${un}</small></span>`:`<span class="no-cost">SEM CUSTO · ${uf}</span>`;
    return `<div class="result" data-cod="${cod}">
      <div class="top"><span class="cod">${cod}</span><span class="un">${un}</span></div>
      <div class="desc">${desc}</div>
      <div class="grp">${g||''}</div>
      <button class="toggle-exp" data-cod="${cod}">▼ ver composição</button>
      <div class="expand" data-exp="${cod}"></div>
      <div class="foot">${costHtml}
        <button class="btn-add ${inOrc?'done':''}" data-cod="${cod}" ${custo==null?'disabled style="opacity:.4"':''}>${inOrc?'✓ no orç.':'+ Adicionar'}</button>
      </div></div>`;
  }).join('');
  box.querySelectorAll('.btn-add:not([disabled])').forEach(b=>b.onclick=()=>addItem(+b.dataset.cod));
  box.querySelectorAll('.toggle-exp').forEach(b=>b.onclick=()=>{
    const cod=+b.dataset.cod;
    const exp=box.querySelector(`.expand[data-exp="${cod}"]`);
    if(exp.classList.contains('on')){exp.classList.remove('on');b.textContent='▼ ver composição';return;}
    if(!exp.dataset.loaded){
      const rows=getItens(cod);
      exp.innerHTML=rows.length?`<table><thead><tr><th>T</th><th>Cód</th><th>Descrição</th><th>Coef</th><th>Unit</th><th>Parc</th></tr></thead><tbody>${rows.map(([tp,ci,di,ui,co,unit])=>{const parc=unit!=null?co*unit:null;return `<tr><td class="ti">${tp[0]}</td><td>${ci}</td><td class="d">${di}<span class="ti"> ${ui}</span></td><td>${NUM(co)}</td><td>${unit!=null?NUM(unit,2):'—'}</td><td>${parc!=null?NUM(parc,2):'—'}</td></tr>`;}).join('')}</tbody></table>`:'<div class="ti" style="padding:6px">Sem itens detalhados.</div>';
      exp.dataset.loaded='1';
    }
    exp.classList.add('on');b.textContent='▲ ocultar composição';
  });
}

// ---------- orçamento ----------
function addItem(cod){
  if(orc.itens.some(i=>i.codigo===cod)){toast('Já está no orçamento');return;}
  const r=db.exec(`SELECT c.codigo,c.descricao,c.unidade,cu.custo FROM composicoes c LEFT JOIN custos_uf cu ON cu.codigo=c.codigo AND cu.uf='${uf}' WHERE c.codigo=?`,[cod]);
  if(!r.length)return;
  const [codigo,desc,un,custo]=r[0].values[0];
  orc.itens.push({codigo,desc,un,custoRef:custo,custoUnit:custo,qtd:1,edited:false});
  saveDraft();renderOrc();recalcOrc();toast('Adicionado '+codigo);
  updateCount();renderResults();
}

function rmItem(cod){orc.itens=orc.itens.filter(i=>i.codigo!==cod);saveDraft();renderOrc();recalcOrc();updateCount();renderResults();}

function getItens(cod){
  const r=db.exec(`
    SELECT i.tipo_item,i.codigo_item,i.descricao_item,i.unidade_item,i.coeficiente,
      CASE WHEN i.tipo_item='INSUMO' THEN p.preco ELSE cu.custo END unit
    FROM itens_composicao i
    LEFT JOIN precos_uf p ON p.codigo=i.codigo_item AND p.uf='${uf}' AND i.tipo_item='INSUMO'
    LEFT JOIN custos_uf cu ON cu.codigo=i.codigo_item AND cu.uf='${uf}' AND i.tipo_item='COMPOSICAO'
    WHERE i.codigo_composicao=? ORDER BY (i.coeficiente*unit) DESC`,[cod]);
  return r.length?r[0].values:[];
}

function renderOrc(){
  $('#orcNome').value=orc.nome;
  $('#orcUf').textContent=orc.uf;
  $('#bdi').value=orc.bdi;
  const box=$('#orcItems');
  const empty=$('#orcEmpty');
  if(!orc.itens.length){box.innerHTML='';empty.style.display='block';$('#totbar').style.display='none';return;}
  empty.style.display='none';
  if($('.tab.on').dataset.view==='orcamento')$('#totbar').style.display='block';
  box.innerHTML=orc.itens.map((it,idx)=>{
    const sub=it.custoUnit*it.qtd;
    return `<div class="item" data-idx="${idx}">
      <div class="top">
        <span class="cod">${it.codigo} <span class="un-tag">/${it.un}</span></span>
        <button class="rm" data-cod="${it.codigo}">✕</button>
      </div>
      <div class="desc">${it.desc}</div>
      <div class="grid">
        <div class="cell"><label>Quant.</label><input type="number" class="q-qtd" data-idx="${idx}" value="${it.qtd}" min="0" step="0.01" inputmode="decimal"></div>
        <div class="cell ${it.edited?'edited':''}"><label>Custo unit.</label><input type="number" class="q-unit" data-idx="${idx}" value="${it.custoUnit}" min="0" step="0.01" inputmode="decimal"></div>
        <div class="cell tot"><label>Subtotal</label><div class="v">${BRL.format(sub)}</div></div>
      </div>
      <button class="toggle-exp" data-cod="${it.codigo}" data-idx="${idx}">▼ ver desdobramento</button>
      <div class="expand" id="exp-${idx}"></div>
    </div>`;
  }).join('');
  box.querySelectorAll('.rm').forEach(b=>b.onclick=()=>rmItem(+b.dataset.cod));
  box.querySelectorAll('.q-qtd').forEach(inp=>inp.oninput=()=>{orc.itens[+inp.dataset.idx].qtd=parseFloat(inp.value)||0;updateSub(+inp.dataset.idx);recalcOrc();saveDraft();});
  box.querySelectorAll('.q-unit').forEach(inp=>inp.oninput=()=>{const i=+inp.dataset.idx;orc.itens[i].custoUnit=parseFloat(inp.value)||0;orc.itens[i].edited=(orc.itens[i].custoUnit!==orc.itens[i].custoRef);inp.closest('.cell').classList.toggle('edited',orc.itens[i].edited);updateSub(i);recalcOrc();saveDraft();});
  box.querySelectorAll('.toggle-exp').forEach(b=>b.onclick=()=>{
    const exp=$('#exp-'+b.dataset.idx);
    if(exp.classList.contains('on')){exp.classList.remove('on');b.textContent='▼ ver desdobramento';return;}
    const rows=getItens(+b.dataset.cod);
    exp.innerHTML=`<table><thead><tr><th>Tipo</th><th>Cód</th><th>Descrição</th><th>Coef</th><th>Unit</th><th>Parc</th></tr></thead><tbody>${
      rows.map(([tp,ci,di,ui,co,un])=>{const parc=un!=null?co*un:null;return `<tr><td class="ti">${tp[0]}</td><td>${ci}</td><td class="d">${di}<span class="ti"> ${ui}</span></td><td>${NUM(co)}</td><td>${un!=null?NUM(un,2):'—'}</td><td>${parc!=null?NUM(parc,2):'—'}</td></tr>`;}).join('')
    }</tbody></table>`;
    exp.classList.add('on');b.textContent='▲ ocultar';
  });
}

function updateSub(idx){
  const it=orc.itens[idx];const el=$(`.item[data-idx="${idx}"] .cell.tot .v`);
  if(el)el.textContent=BRL.format(it.custoUnit*it.qtd);
}

function recalcOrc(){
  orc.bdi=parseFloat($('#bdi').value)||0;
  const direto=orc.itens.reduce((s,i)=>s+i.custoUnit*i.qtd,0);
  const bdiV=direto*orc.bdi/100;
  $('#tDireto').textContent=BRL.format(direto);
  $('#tBdiPct').textContent=orc.bdi+'%';
  $('#tBdi').textContent=BRL.format(bdiV);
  $('#tGrand').textContent=BRL.format(direto+bdiV);
}
$('#bdi').oninput=()=>{recalcOrc();saveDraft();};
$('#orcNome').oninput=()=>{orc.nome=$('#orcNome').value;saveDraft();};

function updateCount(){const n=orc.itens.length;$('#itemCount').textContent=n?`(${n})`:'';}

// ---------- consulta técnica ----------
let ctTimer=null;
if($('#qc'))$('#qc').addEventListener('input',()=>{clearTimeout(ctTimer);ctTimer=setTimeout(renderConsulta,220);});

function renderConsulta(){
  if(!db||!$('#qc'))return;
  const raw=$('#qc').value.trim();
  const out=$('#consultaOut');
  if(raw.length<2){out.innerHTML='<div class="empty"><b>Consulta técnica</b>Digite código ou descrição.</div>';return;}
  const isCode=/^\d+$/.test(raw);
  let where=[],p=[];
  if(isCode){where.push("c.codigo LIKE ?");p.push(raw+'%');}
  else{raw.toUpperCase().split(/\s+/).filter(Boolean).forEach(t=>{where.push("UPPER(c.descricao) LIKE ?");p.push('%'+t+'%');});}
  const sql=`SELECT c.codigo,c.descricao,c.unidade,TRIM(REPLACE(c.grupo,' - continuação','')) grp,c.situacao,cu.custo
    FROM composicoes c LEFT JOIN custos_uf cu ON cu.codigo=c.codigo AND cu.uf='${uf}'
    WHERE ${where.join(' AND ')} ORDER BY (cu.custo IS NULL),c.codigo LIMIT 8`;
  const res=db.exec(sql,p);
  if(!res.length||!res[0].values.length){out.innerHTML='<div class="empty"><b>Não encontrado</b>Ajuste o termo.</div>';return;}
  out.innerHTML=res[0].values.map(([cod,desc,un,g,situ,custo])=>{
    const rows=getItens(cod).map(([tp,ci,di,ui,co,unit])=>({tp,ci,di,ui,co,unit,parc:unit!=null?co*unit:null}))
      .sort((a,b)=>(b.parc||0)-(a.parc||0));
    const soma=rows.reduce((s,r)=>s+(r.parc||0),0);
    const semPreco=rows.filter(r=>r.parc==null).length;
    const diff=custo!=null?Math.abs(soma-custo):null;
    const validHtml=custo==null
      ?`<div class="valid warn">SEM CUSTO oficial em ${uf} — soma calculada: ${BRL.format(soma)}</div>`
      :(diff<=Math.max(0.05,custo*0.01)
        ?`<div class="valid ok">Σ itens ${BRL.format(soma)} ≈ oficial ${BRL.format(custo)} · validado${semPreco?` · ${semPreco} item(ns) sem preço`:''}</div>`
        :`<div class="valid warn">Σ itens ${BRL.format(soma)} ≠ oficial ${BRL.format(custo)}${semPreco?` · ${semPreco} item(ns) sem preço`:''}</div>`);
    return `<div class="ct-card">
      <div class="head">
        <span class="cod">${cod}</span><span class="un">${un}</span>
        <div class="desc">${desc}</div>
        <div class="grp">${g||''} · ${uf}</div>
        <div class="custo-big">${custo!=null?BRL.format(custo):'SEM CUSTO'}<small> /${un} · ref. 05/2026</small></div>
      </div>
      <table>
        <thead><tr><th>T</th><th>Cód</th><th>Descrição</th><th>Und</th><th>Coef.</th><th>Preço Unit.</th><th>C. Parcial</th></tr></thead>
        <tbody>
          ${rows.map(r=>`<tr><td class="ti">${r.tp[0]}</td><td>${r.ci}</td><td class="d">${r.di}</td><td>${r.ui}</td><td>${NUM(r.co)}</td><td>${r.unit!=null?NUM(r.unit,2):'—'}</td><td>${r.parc!=null?NUM(r.parc,2):'—'}</td></tr>`).join('')}
          <tr class="soma"><td colspan="6">Σ CUSTO TOTAL /${un}</td><td>${NUM(soma,2)}</td></tr>
        </tbody>
      </table>
      ${validHtml}
    </div>`;
  }).join('');
}

// ---------- IndexedDB (salvos + draft) ----------
let idb=null;
function openIDB(){return new Promise((res,rej)=>{const r=indexedDB.open('sinapi_orc',1);r.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains('orcamentos'))d.createObjectStore('orcamentos',{keyPath:'id'});if(!d.objectStoreNames.contains('draft'))d.createObjectStore('draft',{keyPath:'k'});};r.onsuccess=e=>{idb=e.target.result;res();};r.onerror=e=>rej(e);});}
function saveDraft(){if(!idb)return;const tx=idb.transaction('draft','readwrite');tx.objectStore('draft').put({k:'current',orc});}
function loadDraft(){if(!idb)return;const tx=idb.transaction('draft','readonly');const rq=tx.objectStore('draft').get('current');rq.onsuccess=()=>{if(rq.result&&rq.result.orc&&rq.result.orc.itens.length){orc=rq.result.orc;uf=orc.uf;ufSel.value=uf;renderOrc();recalcOrc();updateCount();}};}

function doSave(){
  if(!orc.itens.length){toast('Orçamento vazio');return;}
  const id='orc_'+Date.now();
  const direto=orc.itens.reduce((s,i)=>s+i.custoUnit*i.qtd,0);
  const total=direto*(1+orc.bdi/100);
  const rec={id,nome:orc.nome||'Sem título',uf:orc.uf,bdi:orc.bdi,itens:JSON.parse(JSON.stringify(orc.itens)),total,data:new Date().toISOString()};
  const tx=idb.transaction('orcamentos','readwrite');tx.objectStore('orcamentos').put(rec);
  tx.oncomplete=()=>toast('Orçamento salvo');
}

// preview antes de salvar
function openPreview(){
  if(!orc.itens.length){toast('Orçamento vazio');return;}
  const direto=orc.itens.reduce((s,i)=>s+i.custoUnit*i.qtd,0);
  const total=direto*(1+orc.bdi/100);
  $('#pvMeta').textContent=`${orc.uf} · ${orc.itens.length} comp · ${BRL.format(total)}`;
  $('#pvBody').innerHTML=orc.itens.map(it=>{
    const rows=getItens(it.codigo);
    const sub=it.custoUnit*it.qtd;
    return `<div class="pv-comp">
      <div class="h"><span class="c">${it.codigo} <span class="ti">/${it.un}</span></span><span class="s">${BRL.format(sub)}</span></div>
      <div class="d">${it.desc}</div>
      <div class="ti mono" style="font-size:10px;margin-bottom:4px">Qtd ${it.qtd} × ${BRL.format(it.custoUnit)}${it.edited?' (editado)':''}</div>
      <table><tbody>${rows.map(([tp,ci,di,ui,co,unit])=>{const parc=unit!=null?co*unit:null;return `<tr><td class="ti">${tp[0]}</td><td>${ci}</td><td class="d">${di}</td><td>${NUM(co)}</td><td>${unit!=null?NUM(unit,2):'—'}</td><td>${parc!=null?NUM(parc,2):'—'}</td></tr>`;}).join('')}</tbody></table>
    </div>`;
  }).join('');
  $('#previewModal').classList.add('on');
}
function closePreview(){$('#previewModal').classList.remove('on');}

$('#btnSalvar').onclick=openPreview;
$('#pvVoltar').onclick=closePreview;
$('#pvSalvar').onclick=()=>{doSave();closePreview();};
function renderSaved(){
  const tx=idb.transaction('orcamentos','readonly');const rq=tx.objectStore('orcamentos').getAll();
  rq.onsuccess=()=>{
    const list=rq.result.sort((a,b)=>b.data.localeCompare(a.data));
    const box=$('#savedList');const empty=$('#savedEmpty');
    if(!list.length){box.innerHTML='';empty.style.display='block';return;}
    empty.style.display='none';
    box.innerHTML=list.map(r=>`<div class="saved-card">
      <div class="info"><b>${r.nome}</b><small>${r.uf} · ${r.itens.length} itens · ${new Date(r.data).toLocaleDateString('pt-BR')}</small></div>
      <div class="val">${BRL.format(r.total)}</div>
      <div class="acts"><button data-open="${r.id}">Abrir</button><button class="del" data-del="${r.id}">✕</button></div>
    </div>`).join('');
    box.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{
      const rec=list.find(x=>x.id===b.dataset.open);
      orc={nome:rec.nome,uf:rec.uf,bdi:rec.bdi,itens:JSON.parse(JSON.stringify(rec.itens))};
      uf=rec.uf;ufSel.value=uf;saveDraft();renderOrc();recalcOrc();updateCount();
      $$('.tab').forEach(x=>x.classList.remove('on'));document.querySelector('[data-view="orcamento"]').classList.add('on');
      $$('.view').forEach(v=>v.classList.remove('on'));$('#v-orcamento').classList.add('on');$('#totbar').style.display='block';
      toast('Aberto: '+rec.nome);
    });
    box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{const tx2=idb.transaction('orcamentos','readwrite');tx2.objectStore('orcamentos').delete(b.dataset.del);tx2.oncomplete=()=>{renderSaved();toast('Excluído');};});
  };
}

// ---------- export ----------
function buildRows(){
  // linha por composição + linhas de itens (analítico)
  const rows=[];
  orc.itens.forEach(it=>{
    rows.push({tipo:'COMPOSICAO',cod:it.codigo,desc:it.desc,un:it.un,coef:'',unit:it.custoUnit,qtd:it.qtd,sub:it.custoUnit*it.qtd,edited:it.edited});
    getItens(it.codigo).forEach(([tp,ci,di,ui,co,un])=>{
      rows.push({tipo:tp,cod:ci,desc:di,un:ui,coef:co,unit:un,qtd:'',sub:un!=null?co*un:null,item:true});
    });
  });
  return rows;
}

$('#btnXlsx').onclick=async()=>{
  if(!orc.itens.length){toast('Orçamento vazio');return;}
  const direto=orc.itens.reduce((s,i)=>s+i.custoUnit*i.qtd,0);
  const wb=new ExcelJS.Workbook();
  const ws=wb.addWorksheet('Orçamento');
  ws.columns=[{width:12},{width:9},{width:60},{width:7},{width:12},{width:14},{width:10},{width:14}];

  const fillYellow={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFF00'}};
  const fillBlue={type:'pattern',pattern:'solid',fgColor:{argb:'FF00B0F0'}};
  const fillGreen={type:'pattern',pattern:'solid',fgColor:{argb:'FF92D050'}};
  const bold={bold:true};

  // L1 titulo
  ws.addRow(['ORÇAMENTO SINAPI — '+(orc.nome||'Sem título')]);
  // L2 uf
  ws.addRow(['UF: '+orc.uf,'Ref. 05/2026 não desonerado','BDI: '+orc.bdi+'%']);
  ws.addRow([]);
  // L4 cabecalho
  ws.addRow(['Tipo','Código','Descrição','Unid.','Coef.','Custo Unit. (R$)','Quant.','Subtotal (R$)']);

  const compRows=[];
  buildRows().forEach(r=>{
    const row=ws.addRow([
      r.item?('  '+r.tipo[0]):r.tipo, r.cod,
      (r.item?'   ':'')+r.desc+(r.edited?' [preço editado]':''), r.un,
      r.coef===''?'':+(+r.coef).toFixed(7),
      r.unit==null?'':+(+r.unit).toFixed(2),
      r.qtd===''?'':r.qtd,
      r.sub==null?'':+r.sub.toFixed(2)
    ]);
    if(!r.item)compRows.push(row.number);
  });
  ws.addRow([]);
  ws.addRow(['','','','','','','Custo direto',+direto.toFixed(2)]);
  ws.addRow(['','','','','','','BDI '+orc.bdi+'%',+(direto*orc.bdi/100).toFixed(2)]);
  const totalRow=ws.addRow(['','','','','','','TOTAL',+(direto*(1+orc.bdi/100)).toFixed(2)]);

  const last=ws.rowCount;
  // grade continua A1:H(last) + borda media
  for(let r=1;r<=last;r++){
    for(let c=1;c<=8;c++){
      ws.getCell(r,c).border={top:{style:'thin'},left:{style:'thin'},bottom:{style:'thin'},right:{style:'thin'}};
    }
  }
  // L1 amarelo + negrito
  for(let c=1;c<=8;c++){ws.getCell(1,c).fill=fillYellow;ws.getCell(1,c).font=bold;}
  // L2 azul + negrito
  for(let c=1;c<=8;c++){ws.getCell(2,c).fill=fillBlue;ws.getCell(2,c).font=bold;}
  // L4 cabecalho negrito
  for(let c=1;c<=8;c++)ws.getCell(4,c).font=bold;
  // linhas de composicao verde + negrito
  compRows.forEach(rn=>{for(let c=1;c<=8;c++){ws.getCell(rn,c).fill=fillGreen;ws.getCell(rn,c).font=bold;}});
  // total negrito
  for(let c=1;c<=8;c++)ws.getCell(totalRow.number,c).font=bold;

  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=(orc.nome||'orcamento').replace(/[^\w]/g,'_')+'_'+orc.uf+'.xlsx';a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast('XLSX gerado');
};

$('#btnPdf').onclick=()=>{
  if(!orc.itens.length){toast('Orçamento vazio');return;}
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const direto=orc.itens.reduce((s,i)=>s+i.custoUnit*i.qtd,0);
  doc.setFontSize(14);doc.text('Orçamento SINAPI — '+(orc.nome||'Sem título'),14,15);
  doc.setFontSize(9);doc.setTextColor(100);
  doc.text('UF: '+orc.uf+'   |   Ref. 05/2026 não desonerado   |   BDI: '+orc.bdi+'%   |   '+new Date().toLocaleDateString('pt-BR'),14,21);
  const body=buildRows().map(r=>[
    r.item?r.tipo[0]:r.tipo, r.cod, (r.item?'    ':'')+r.desc+(r.edited?' [editado]':''), r.un,
    r.coef===''?'':NUM(r.coef), r.unit==null?'—':NUM(r.unit,2), r.qtd===''?'':r.qtd, r.sub==null?'—':NUM(r.sub,2)
  ]);
  doc.autoTable({
    startY:26,head:[['T','Código','Descrição','Un','Coef','Unit R$','Qtd','Subtotal R$']],body,
    styles:{fontSize:7,cellPadding:1.2,font:'courier'},
    headStyles:{fillColor:[26,34,48],textColor:[245,166,35],fontSize:7},
    columnStyles:{0:{cellWidth:8},1:{cellWidth:16},2:{cellWidth:130},3:{cellWidth:12},4:{cellWidth:22,halign:'right'},5:{cellWidth:22,halign:'right'},6:{cellWidth:16,halign:'right'},7:{cellWidth:24,halign:'right'}},
    didParseCell:d=>{if(d.row.raw[0]==='COMPOSICAO'&&d.section==='body'){d.cell.styles.fillColor=[240,240,240];d.cell.styles.fontStyle='bold';}}
  });
  let y=doc.lastAutoTable.finalY+6;
  doc.setFontSize(9);doc.setTextColor(0);
  doc.text('Custo direto:',200,y);doc.text(BRL.format(direto),285,y,{align:'right'});
  doc.text('BDI '+orc.bdi+'%:',200,y+5);doc.text(BRL.format(direto*orc.bdi/100),285,y+5,{align:'right'});
  doc.setFontSize(11);doc.text('TOTAL:',200,y+11);doc.text(BRL.format(direto*(1+orc.bdi/100)),285,y+11,{align:'right'});
  doc.save((orc.nome||'orcamento').replace(/[^\w]/g,'_')+'_'+orc.uf+'.pdf');
  toast('PDF gerado');
};

// ---------- init ----------
(async()=>{await openIDB();loadDB();})();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
