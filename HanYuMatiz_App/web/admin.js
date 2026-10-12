const $=selector=>document.querySelector(selector);
const state={status:'pending',offset:0,limit:25,csrfToken:null,generation:0};
const statusNames={pending:'Pendiente',reviewing:'En revisión',resolved:'Resuelto',dismissed:'Descartado'};
const reasonNames={meaning:'Significado o matiz',naturalness:'Uso natural',grammar:'Gramática',translation:'Traducción',answer:'Respuesta del ejercicio',other:'Otra observación'};
const typeNames={word:'Palabra',contrast:'Comparación',exercise:'Ejercicio'};
function node(tag,className='',text){const value=document.createElement(tag);value.className=className;if(text!==undefined)value.textContent=text;return value;}
function date(value){return new Date(value).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'});}
async function jsonFetch(url,options={}){const response=await fetch(url,{credentials:'same-origin',...options});let value;try{value=await response.json();}catch{throw new Error('El servidor no respondió correctamente.');}if(!response.ok)throw new Error(value.error||'No se pudo completar la operación.');return value;}
async function csrf(){if(!state.csrfToken)state.csrfToken=(await jsonFetch('/api/csrf')).csrfToken;return state.csrfToken;}
function reportTitle(report){const value=report.target||{};return value.zh||[value.a,value.b].filter(Boolean).join(' / ')||value.title||value.prompt_es||value.intent_es||report.targetId;}
function field(label,input,className=''){const wrapper=node('label',`field ${className}`,label);wrapper.append(input);return wrapper;}
function reportCard(report){
  const article=node('article','report');article.dataset.reportId=report.id;
  const header=node('div','report-header'),left=node('div');
  const title=node('h2','zh',reportTitle(report));title.lang='zh-Hans';
  left.append(node('p','meta',`${typeNames[report.targetType]} · ${reasonNames[report.reason]}`),title);
  header.append(left,node('span','status-pill',statusNames[report.status]));article.append(header);
  article.append(node('p','meta',`${date(report.receivedAt)} · ${report.targetId} · Versión ${report.contentVersion}`));
  const target=report.target||{};
  const context=target.explanation_es||target.explanation||target.translation_es||target.translation||target.senses?.map(s=>s.gloss||s.gloss_es).join('; ');
  if(context)article.append(node('p','context',context));
  article.append(node('p','comment',report.comment));
  if(report.contact)article.append(node('p','contact',`Contacto proporcionado: ${report.contact}`));
  const form=node('form','review-form');form.setAttribute('aria-label',`Revisar reporte ${report.targetId}`);
  const status=node('select');status.name='status';for(const[value,label]of Object.entries(statusNames)){const option=node('option','',label);option.value=value;status.append(option);}status.value=report.status;
  const version=node('input');version.name='correctionVersion';version.maxLength=128;version.placeholder='Opcional: versión del contenido corregido';version.value=report.history?.findLast(item=>item.correctionVersion)?.correctionVersion||'';
  const note=node('textarea');note.name='ownerNote';note.maxLength=4000;note.rows=3;note.value=report.ownerNote||'';note.placeholder='Tu evaluación y, si corresponde, la corrección realizada.';
  form.append(field('Estado',status),field('Versión corregida',version),field('Nota privada',note,'wide'));
  const row=node('div','save-row'),save=node('button','','Guardar decisión'),message=node('span','save-message');save.type='submit';message.setAttribute('role','status');row.append(save,message);form.append(row);
  form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;message.textContent='Guardando…';
    try{await jsonFetch(`/api/admin/reports/${report.id}`,{method:'PATCH',headers:{'Content-Type':'application/json','X-CSRF-Token':await csrf()},body:JSON.stringify({status:status.value,ownerNote:note.value,...(version.value.trim()?{correctionVersion:version.value.trim()}:{})})});message.textContent='Decisión guardada.';await load();}
    catch(error){message.textContent=error.message;state.csrfToken=null;}finally{save.disabled=false;}
  });article.append(form);
  if(report.history?.length){const details=node('details','history');details.append(node('summary','',`Historial · ${report.history.length} registros`));const list=node('ol');for(const item of report.history){list.append(node('li','',`${date(item.changedAt)} · ${statusNames[item.status]}${item.previousStatus?` (antes: ${statusNames[item.previousStatus]})`:''}${item.ownerNote?`\n${item.ownerNote}`:''}${item.correctionVersion?`\nCorrección: ${item.correctionVersion}`:''}`));}details.append(list);article.append(details);}
  return article;
}
async function load(){const generation=++state.generation;$('#adminStatus').textContent='Cargando reportes…';$('#refresh').disabled=true;
  try{const result=await jsonFetch(`/api/admin/reports?status=${state.status}&limit=${state.limit}&offset=${state.offset}`);if(generation!==state.generation)return;
    for(const label of document.querySelectorAll('[data-count]'))label.textContent=String(result.totals[label.dataset.count]||0);
    const total=state.status==='all'?Object.values(result.totals).reduce((a,b)=>a+b,0):(result.totals[state.status]||0);
    const cards=result.reports.map(reportCard);$('#reports').replaceChildren(...(cards.length?cards:[node('p','empty','No hay reportes en este estado.')]));
    $('#adminStatus').textContent=total?`${total} reportes ${state.status==='all'?'recibidos':statusNames[state.status].toLowerCase()}.`:'Bandeja al día.';
    $('#range').textContent=total?`${state.offset+1}–${state.offset+result.reports.length} de ${total}`:'';
    $('#previous').disabled=state.offset===0;$('#next').disabled=state.offset+result.reports.length>=total;
  }catch(error){$('#adminStatus').textContent=error.message;}finally{$('#refresh').disabled=false;}
}
for(const control of document.querySelectorAll('[data-status]'))control.addEventListener('click',()=>{state.status=control.dataset.status;state.offset=0;document.querySelectorAll('[data-status]').forEach(item=>item.setAttribute('aria-pressed',String(item===control)));load();});
$('#refresh').addEventListener('click',load);$('#previous').addEventListener('click',()=>{state.offset=Math.max(0,state.offset-state.limit);load();});$('#next').addEventListener('click',()=>{state.offset+=state.limit;load();});
load();
