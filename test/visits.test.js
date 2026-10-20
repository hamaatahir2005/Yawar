import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';

async function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'yawar-finance-'));let child,base,cookie='',csrf='';
 async function start(){child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);child.on('error',reject);child.stdout.on('data',b=>{const m=b.toString().match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});});}
 async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
 async function call(route,body,method=body?'POST':'GET'){
  const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return{status:r.status,body:await r.json(),setCookie:r.headers.get('set-cookie')};
 }
 await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 const setup=await call('/api/setup',{username:'admin',name:'Admin',password:'test-password-123',remember:true});assert.equal(setup.status,200);csrf=(await call('/api/auth')).body.csrf;
 return{call,state:async()=>(await call('/api/state')).body,restart:async()=>{await stop();await start();},setup};
}
const date='2026-10-20';
const baseVisit={date,doctor:'Test Doctor',payment_mode:'cash',paid:30000,new_patient:{name:'Synthetic Patient',phone:'0000',history:'Keep clinical history'},items:[{tooth:11,kind:'Filling',cost:10000},{tooth:21,kind:'Cleaning',cost:20000}]};
function checkSchedule(state,id){const treatments=state.treatments.filter(t=>t.visit_id===id),remaining=treatments.reduce((n,t)=>n+t.cost-t.paid,0),rows=state.installments.filter(r=>r.visit_id===id&&r.status==='active');assert.equal(rows.reduce((n,r)=>n+r.amount-r.paid,0),remaining,'schedule balance must equal actual treatment debt');for(const r of rows){const payments=state.payments.filter(p=>p.installment_id===r.id).reduce((n,p)=>n+p.amount,0),refunds=state.refundAllocations.filter(a=>a.installment_id===r.id).reduce((n,a)=>n+a.amount,0);assert.equal(r.paid,payments-refunds);}}

test('quick entry is atomic, creates an existing/new patient visit, and separates cash/debt',async t=>{
 const f=await fixture(t);
 assert.equal((await f.call('/api/visits',{...baseVisit,payment_mode:'installments',paid:1000,schedule:[{due_date:date,amount:1}]})).status,400);
 let s=await f.state();assert.equal(s.patients.length,0);assert.equal(s.treatments.length,0);assert.equal(s.visits.length,0);assert.equal(s.installments.length,0);
 const visit=await f.call('/api/visits',baseVisit);assert.equal(visit.status,201);s=await f.state();assert.equal(s.patients.length,1);assert.equal(s.patients[0].history,'Keep clinical history');assert.equal(s.treatments.length,2);assert.equal(s.treatments.reduce((n,t)=>n+t.paid,0),30000);assert.ok(s.treatments.every(t=>t.visit_id===visit.body.id));
 assert.equal((await f.call('/api/visits',baseVisit)).status,409);s=await f.state();assert.equal(s.patients.length,1);assert.equal(s.visits.length,1);
 const debt={...baseVisit,new_patient:undefined,patient_id:s.patients[0].id,payment_mode:'debt',paid:1000};assert.equal((await f.call('/api/visits',debt)).status,201);
 assert.equal((await f.call('/api/visits',{...debt,payment_mode:'cash',paid:1000})).status,400);
 assert.equal((await f.call('/api/visits',{...debt,payment_mode:'debt',paid:30000})).status,400);
 await f.restart();s=await f.state();assert.equal(s.patients.length,1);assert.equal(s.treatments.length,4);assert.equal(s.visits.length,2);assert.equal(s.patients[0].history,'Keep clinical history');
});

test('installment receipts, manual payments, refunds and cost corrections keep a balanced immutable ledger',async t=>{
 const f=await fixture(t);const v=await f.call('/api/visits',{...baseVisit,payment_mode:'installments',paid:50,items:[{tooth:11,kind:'Filling',cost:100},{tooth:11,kind:'Cleaning',cost:200}],schedule:[{due_date:'2026-11-01',amount:100},{due_date:'2026-12-01',amount:150}]});assert.equal(v.status,201);
 let s=await f.state();checkSchedule(s,v.body.id);const rows=s.installments,first=rows[0].id;const treatments=s.treatments.filter(t=>t.visit_id===v.body.id).sort((a,b)=>a.id-b.id),[one,two]=treatments;
 assert.equal((await f.call('/api/installmentpayments',{installment_id:first,amount:80,date})).status,201);s=await f.state();assert.equal(s.payments.length,2);assert.equal(s.installments[0].paid,80);checkSchedule(s,v.body.id);
 assert.equal((await f.call('/api/installmentpayments',{installment_id:first,amount:21,date})).status,400);assert.equal((await f.state()).payments.length,2);
 assert.equal((await f.call('/api/installmentpayments',{installment_id:first,amount:20,date})).status,201);
 assert.equal((await f.call('/api/payments',{treatment_id:two.id,amount:40,date})).status,201);s=await f.state();checkSchedule(s,v.body.id);assert.equal(s.installments[1].paid,40);
 assert.equal((await f.call('/api/refunds',{treatment_id:two.id,amount:60,date,reason:'Synthetic refund'})).status,201);s=await f.state();checkSchedule(s,v.body.id);assert.equal(s.refundAllocations.reduce((n,a)=>n+a.amount,0),60);
 assert.equal((await f.call('/api/refunds',{treatment_id:one.id,amount:80,date,reason:'Return scheduled and upfront money'})).status,201);s=await f.state();checkSchedule(s,v.body.id);assert.ok(s.installments.length>2,'upfront refund needs an explicit new balance row');
 assert.equal((await f.call('/api/treatments/'+two.id,{cost:150,change_reason:'Price correction'},'PATCH')).status,200);s=await f.state();checkSchedule(s,v.body.id);assert.ok(s.installments.some(r=>r.status==='cancelled'));
 assert.equal((await f.call('/api/treatments/'+two.id,{cost:200,change_reason:'Additional price correction'},'PATCH')).status,200);s=await f.state();checkSchedule(s,v.body.id);
 for(const row of s.installments.filter(r=>r.status==='active'&&r.amount>r.paid))assert.equal((await f.call('/api/installmentpayments',{installment_id:row.id,amount:row.amount-row.paid,date})).status,201);
 s=await f.state();checkSchedule(s,v.body.id);assert.ok(s.treatments.every(t=>t.paid===t.cost));assert.ok(s.installments.filter(r=>r.status==='active').every(r=>r.paid===r.amount));assert.equal((await f.call('/api/installmentpayments',{installment_id:first,amount:1,date})).status,400);
 await f.restart();s=await f.state();checkSchedule(s,v.body.id);assert.equal(s.refunds.length,2);assert.equal(s.patients.length,1);
});

test('remembered sessions survive restart and logout still invalidates them',async t=>{
 const f=await fixture(t);assert.match(f.setup.setCookie,/Max-Age=2592000/);await f.restart();assert.equal((await f.call('/api/auth')).body.user.username,'admin');
 await f.call('/api/logout',{});assert.equal((await f.call('/api/auth')).body.user,null);assert.equal((await f.call('/api/state')).status,401);
 const login=await f.call('/api/login',{username:'admin',password:'test-password-123',remember:false});assert.match(login.setCookie,/Max-Age=28800/);
});

test('existing debt can receive an installment schedule without duplicating patients or treatments',async t=>{
 const f=await fixture(t);await f.call('/api/visits',{...baseVisit,payment_mode:'debt',paid:5000});let s=await f.state();const treatment=s.treatments[0];
 assert.equal((await f.call('/api/financing',{treatment_id:treatment.id,schedule:[{due_date:date,amount:1}]})).status,400);s=await f.state();assert.equal(s.visits[0].payment_mode,'debt');assert.equal(s.installments.length,0);
 assert.equal((await f.call('/api/financing',{treatment_id:treatment.id,schedule:[{due_date:'2026-11-01',amount:10000},{due_date:'2026-12-01',amount:15000}]})).status,201);s=await f.state();assert.equal(s.patients.length,1);assert.equal(s.treatments.length,2);assert.equal(s.visits.length,1);checkSchedule(s,s.visits[0].id);
 assert.equal((await f.call('/api/financing',{treatment_id:treatment.id,schedule:[{due_date:date,amount:25000}]})).status,400);
 const legacy=(await f.call('/api/treatments',{patient_id:s.patients[0].id,tooth:31,kind:'Legacy separate treatment',doctor:'Test',cost:10000,paid:2000,date})).body.id;
 assert.equal((await f.call('/api/financing',{treatment_id:legacy,schedule:[{due_date:date,amount:8000}]})).status,201);s=await f.state();assert.equal(s.treatments.length,3);assert.equal(s.patients.length,1);const visit=s.visits.find(v=>v.id===s.treatments.find(t=>t.id===legacy).visit_id);checkSchedule(s,visit.id);
});
