/* HanYuMatiz P7: no dependencies, browser + Node parity tests.
 * Heuristic practice scheduler, NOT a validated SRS or HSK placement test. */
(function(root){
'use strict';
const CAPS={initial:{inicial:4,intermedio:3,avanzado:1},returning:{inicial:3,intermedio:3,avanzado:2}};
const intervals=[1,3,7,14,30];
function isoToday(date=new Date()){
 const z=n=>String(n).padStart(2,'0');
 return `${date.getFullYear()}-${z(date.getMonth()+1)}-${z(date.getDate())}`;
}
function dayAdd(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function validDay(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s}
function validateEntry(p,today){
 if(!p||typeof p!=='object'||Array.isArray(p))return false;
 if(Object.keys(p).sort().join()!=='attempts,correct,due_day,last_day,streak')return false;
 if(!['attempts','correct','streak'].every(k=>Number.isSafeInteger(p[k])&&p[k]>=0&&p[k]<=100000))return false;
 if(p.correct>p.attempts||p.streak>p.correct)return false;
 if(p.attempts===0)return p.due_day===null&&p.last_day===null;
 if(!validDay(p.last_day)||!validDay(p.due_day)||p.last_day>today||p.due_day<p.last_day)return false;
 const n=(Date.parse(p.due_day+'T12:00:00Z')-Date.parse(p.last_day+'T12:00:00Z'))/86400000;
 return n<=30;
}
function validateHistory(history,exercises,today){
 if(!history||typeof history!=='object'||Array.isArray(history))return false;
 const ids=new Set(exercises.map(e=>e.scenario_id));
 return Object.entries(history).length<=ids.size&&Object.entries(history).every(([id,p])=>ids.has(id)&&validateEntry(p,today));
}
function update(previous,correct,day){
 if(typeof correct!=='boolean'||!validDay(day))throw new Error('Resultado o fecha inválidos');
 const p=previous||{attempts:0,correct:0,streak:0,last_day:null,due_day:null};
 if(!validateEntry(p,day))throw new Error('Registro de progreso inválido');
 const streak=correct?p.streak+1:0;
 return {attempts:p.attempts+1,correct:p.correct+(correct?1:0),streak,last_day:day,
         due_day:dayAdd(day,correct?intervals[Math.min(streak-1,4)]:0)};
}
function schedule(exercises,history,day,{limit=8,early=false}={}){
 if(!validDay(day)||!Number.isInteger(limit)||limit<1||limit>8||typeof early!=='boolean')throw new Error('Solicitud de sesión inválida');
 if(!validateHistory(history,exercises,day))throw new Error('Historial no válido');
 const groups=new Map();
 exercises.forEach(e=>{if(!groups.has(e.scenario_id))groups.set(e.scenario_id,[]);groups.get(e.scenario_id).push(e)});
 if(!groups.size)throw new Error('Banco de ejercicios vacío');
 const seen=Object.keys(history).length>0;
 const caps=seen?CAPS.returning:CAPS.initial;
 const candidates=[];
 for(const [sid,arr] of groups){
  const p=history[sid];if(p&&p.due_day>day&&!early)continue;
  const e=arr[p?p.attempts%arr.length:0];const pair=[e.word_a,e.word_b].sort().join('/');
  const priority=p&&p.due_day<=day?0:!p?1:3;
  candidates.push({scenario_id:sid,exercise_id:e.id,kind:e.kind,difficulty:e.difficulty,
                   word_pair:pair,priority,miss:p?p.attempts-p.correct:0,due:p?p.due_day:'',});
 }
 candidates.sort((a,b)=>a.priority-b.priority||b.miss-a.miss||a.due.localeCompare(b.due)||a.scenario_id.localeCompare(b.scenario_id));
 const chosen=[],used=new Set(),tierCount={},pairCount={};
 for(const [enforceCap,pairLimit] of [[true,1],[true,2],[false,2],[false,999]]){
  for(const e of candidates){
   if(chosen.length>=limit)break;
   if(used.has(e.scenario_id)||(tierCount[e.difficulty]||0)>=caps[e.difficulty]&&enforceCap)continue;
   if((pairCount[e.word_pair]||0)>=pairLimit)continue;
   chosen.push({scenario_id:e.scenario_id,exercise_id:e.exercise_id,kind:e.kind,difficulty:e.difficulty,word_pair:e.word_pair});
   used.add(e.scenario_id);tierCount[e.difficulty]=(tierCount[e.difficulty]||0)+1;
   pairCount[e.word_pair]=(pairCount[e.word_pair]||0)+1;
  }
  if(chosen.length>=limit)break;
 }
 return {date:day,exercises:chosen,eligible_count:candidates.length,not_due_count:groups.size-candidates.length,session_limit:limit};
}
const api={isoToday,dayAdd,validDay,validateEntry,validateHistory,update,schedule};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.HanYuScheduler=api;
})(typeof window!=='undefined'?window:globalThis);

// Module adapter only: the P7 scheduling algorithm above remains unchanged.
export const scheduler = globalThis.HanYuScheduler;
