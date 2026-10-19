import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

test('authenticated clinic lifecycle, financial integrity, permissions, backups and persistence',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'yawar-test-'));let child,base,cookie='',csrf='';
 async function start(){child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timeout '+errors)),10000);child.once('error',reject);child.once('exit',()=>{clearTimeout(timeout);reject(Error('Server exited '+errors));});child.stdout.on('data',b=>{const m=b.toString().match(/port (\d+)/);if(m){clearTimeout(timeout);resolve('http://127.0.0.1:'+m[1]);}});});}
 async function stop(){const exit=once(child,'exit');child.kill();await exit;}
 async function request(route,body,method=body?'POST':'GET',headers={}){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...headers},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return{status:r.status,body:await r.json()};}
 async function login(username,password){const r=await request('/api/login',{username,password});assert.equal(r.status,200);csrf=(await request('/api/auth')).body.csrf;}
 try{
  await start();assert.equal((await fetch(base)).status,200);assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/api/auth')).body.setup,true);
  assert.equal((await request('/api/setup',{username:'admin',name:'Admin',password:'short'})).status,400);
  assert.equal((await request('/api/setup',{username:'admin',name:'Admin',password:'test-password-123',clinic_name:'Test Clinic'})).status,200);
  csrf=(await request('/api/auth')).body.csrf;
  assert.equal((await request('/api/setup',{username:'other',name:'Other',password:'test-password-123'})).status,409);
  assert.equal((await request('/api/patients',{name:'X',phone:'123'},'POST',{'X-CSRF-Token':''})).status,403);
  assert.equal((await request('/api/patients',{name:'X',phone:'123'},'POST',{Origin:'https://evil.example'})).status,403);
  assert.equal((await request('/api/patients',{name:'',phone:'123'})).status,400);
  const p=await request('/api/patients',{name:'Synthetic Patient',phone:'000000000',history:'Synthetic only',allergies:'Test allergy'});assert.equal(p.status,201);const id=p.body.id;
  assert.equal((await request('/api/patients/'+id,{name:'Updated Patient',phone:'12345',history:'Updated'},'PATCH')).status,200);
  const treatment={patient_id:id,tooth:11,kind:'Filling',doctor:'Test',cost:100000,paid:25000,date:'2026-10-18'};
  assert.equal((await request('/api/treatments',{...treatment,paid:100001})).status,400);
  assert.equal((await request('/api/treatments',{...treatment,tooth:99})).status,400);
  assert.equal((await request('/api/treatments',{...treatment,patient_id:999})).status,400);
  const t=await request('/api/treatments',treatment);assert.equal(t.status,201);
  const pay={treatment_id:t.body.id,amount:50000,date:'2026-10-19'};assert.equal((await request('/api/payments',pay)).status,201);assert.equal((await request('/api/payments',pay)).status,400);
  let s=(await request('/api/state')).body;assert.equal(s.treatments[0].paid,75000);assert.equal(s.payments.length,1);
  const appointment={patient_id:id,date:'2026-10-19',time:'10:00',reason:'Checkup'};const a=await request('/api/appointments',appointment);assert.equal(a.status,201);assert.equal((await request('/api/appointments',appointment)).status,400);
  assert.equal((await request('/api/appointments/'+a.body.id,{status:'cancelled'},'PATCH')).status,200);assert.equal((await request('/api/appointments',appointment)).status,201);
  assert.equal((await request('/api/prescriptions',{patient_id:id,doctor:'Test',medicine:'Test medicine',instructions:'Synthetic instructions',date:'2026-10-19'})).status,201);
  assert.equal((await request('/api/expenses',{title:'Supplies',amount:10000,date:'2026-10-19'})).status,201);
  const stock=await request('/api/inventory',{name:'Gloves',quantity:20,minimum:5});assert.equal(stock.status,201);assert.equal((await request('/api/inventory/'+stock.body.id,{name:'Gloves',quantity:4,minimum:5},'PATCH')).status,200);
  assert.equal((await request('/api/attachments',{patient_id:id,name:'x.html',mime:'text/html',content:Buffer.from('<script>').toString('base64')})).status,400);
  const f=await request('/api/attachments',{patient_id:id,name:'test.pdf',mime:'application/pdf',content:Buffer.from('%PDF-1.4\nsynthetic').toString('base64')});assert.equal(f.status,201);assert.equal((await fetch(base+'/api/attachments/'+f.body.id,{headers:{Cookie:cookie}})).status,200);
  assert.equal((await request('/api/settings',{name:'Updated Clinic',phone:'123',address:'Test'},'PATCH')).status,200);
  for(const role of ['doctor','reception'])assert.equal((await request('/api/users',{name:role,username:role,password:'test-password-123',role})).status,201);
  const backup=await fetch(base+'/api/backup',{headers:{Cookie:cookie}});assert.equal(backup.status,200);const backupPath=path.join(dir,'verify.sqlite');writeFileSync(backupPath,Buffer.from(await backup.arrayBuffer()));const copy=new DatabaseSync(backupPath);assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM patients').get().n,1);copy.close();const restoreDir=path.join(dir,'restored');execFileSync(process.execPath,['scripts/restore.js',backupPath,'--server-stopped'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:restoreDir}});const restored=new DatabaseSync(path.join(restoreDir,'clinic.sqlite'));assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM patients').get().n,1);restored.close();
  await request('/api/logout',{});assert.equal((await request('/api/state')).status,401);
  await login('doctor','test-password-123');assert.equal((await request('/api/expenses',{title:'No',amount:1,date:'2026-10-19'})).status,403);assert.equal((await request('/api/users',{name:'No'})).status,403);assert.equal((await fetch(base+'/api/backup',{headers:{Cookie:cookie}})).status,403);assert.equal((await request('/api/state')).body.users,undefined);
  await request('/api/logout',{});await login('reception','test-password-123');const receptionState=(await request('/api/state')).body;assert.equal(receptionState.patients[0].history,'');assert.deepEqual(receptionState.prescriptions,[]);assert.equal((await fetch(base+'/api/attachments/'+f.body.id,{headers:{Cookie:cookie}})).status,403);assert.equal((await request('/api/treatments',treatment)).status,403);assert.equal((await request('/api/payments',{...pay,amount:25000})).status,201);
  await request('/api/logout',{});await login('admin','test-password-123');s=(await request('/api/state')).body;const receptionist=s.users.find(u=>u.role==='reception');assert.equal((await request('/api/users/'+receptionist.id,{active:0},'PATCH')).status,200);assert.equal((await request('/api/users/1',{active:0},'PATCH')).status,400);
  assert.equal((await request('/api/password',{current:'wrong',password:'new-password-123'})).status,400);assert.equal((await request('/api/password',{current:'test-password-123',password:'new-password-123'})).status,200);assert.equal((await request('/api/state')).status,401);
  await login('admin','new-password-123');await stop();await start();s=(await request('/api/state')).body;assert.equal(s.patients[0].name,'Updated Patient');assert.equal(s.treatments[0].paid,100000);assert.equal(s.settings.name,'Updated Clinic');assert.ok(s.audit.length>15);
 }finally{if(child&&child.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});

test('plans, rescheduling, duration conflicts, refunds and audited corrections',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'yawar-extended-'));let child;
 try{
  child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timeout')),10000);child.on('error',reject);child.stdout.on('data',b=>{const m=b.toString().match(/port (\d+)/);if(m){clearTimeout(timeout);resolve('http://127.0.0.1:'+m[1]);}});});
  let cookie='',csrf='';const request=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return{status:r.status,body:await r.json()};};
  await request('/api/setup',{name:'Admin',username:'admin',password:'test-password-123'});csrf=(await request('/api/auth')).body.csrf;
  const p=(await request('/api/patients',{name:'نەخۆشی تاقیکردنەوە',phone:'0000'})).body.id;
  const appointment={patient_id:p,date:'2026-10-20',time:'09:00',duration:60,doctor:'Test Doctor',reason:'Test'};
  const a=await request('/api/appointments',appointment);assert.equal(a.status,201);
  assert.equal((await request('/api/appointments',{...appointment,time:'09:30'})).status,400);
  assert.equal((await request('/api/appointments',{...appointment,time:'08:30'})).status,400);
  assert.equal((await request('/api/appointments',{...appointment,time:'10:00',duration:30})).status,201);
  assert.equal((await request('/api/appointments',{...appointment,time:'23:45',duration:30})).status,400);
  assert.equal((await request('/api/appointments/'+a.body.id,{...appointment,time:'10:15'},'PATCH')).status,400);
  assert.equal((await request('/api/appointments/'+a.body.id,{...appointment,time:'11:00'},'PATCH')).status,200);
  const plan={patient_id:p,tooth:11,kind:'پڕکردنەوە',doctor:'Test Doctor',estimate:100000,date:'2026-10-20',notes:'Stage 1'};
  const planId=(await request('/api/plans',plan)).body.id;
  const treatment={patient_id:p,plan_id:planId,tooth:11,kind:plan.kind,doctor:plan.doctor,cost:100000,paid:80000,date:'2026-10-20'};
  const t=await request('/api/treatments',treatment);assert.equal(t.status,201);
  assert.equal((await request('/api/treatments',treatment)).status,400);
  let state=(await request('/api/state')).body;assert.equal(state.plans[0].status,'completed');assert.equal(state.treatments.length,1);
  assert.equal((await request('/api/plans/'+planId,{status:'cancelled'},'PATCH')).status,400);
  assert.equal((await request('/api/refunds',{treatment_id:t.body.id,amount:80001,reason:'Error',date:'2026-10-21'})).status,400);
  assert.equal((await request('/api/refunds',{treatment_id:t.body.id,amount:30000,reason:'Correction',date:'2026-10-21'})).status,201);
  state=(await request('/api/state')).body;assert.equal(state.treatments[0].paid,50000);assert.equal(state.refunds.length,1);
  assert.equal((await request('/api/treatments/'+t.body.id,{cost:49999,change_reason:'Too low'},'PATCH')).status,400);
  assert.equal((await request('/api/treatments/'+t.body.id,{cost:70000,kind:'Corrected',notes:'Clinical update',change_reason:'Price correction'},'PATCH')).status,200);
  assert.equal((await request('/api/treatments/'+t.body.id,{notes:'Missing reason'},'PATCH')).status,400);
  const prescription=(await request('/api/prescriptions',{patient_id:p,doctor:'Test',medicine:'Original',instructions:'Synthetic',date:'2026-10-20'})).body.id;
  assert.equal((await request('/api/prescriptions/'+prescription,{doctor:'Test',medicine:'Corrected',instructions:'New synthetic',change_reason:'Correction'},'PATCH')).status,200);
  const expense=(await request('/api/expenses',{title:'Test',amount:100,date:'2026-10-20'})).body.id;
  assert.equal((await request('/api/expenses/'+expense,{title:'Updated',amount:200,date:'2026-10-21',change_reason:'Correction'},'PATCH')).status,200);
  const doctor=(await request('/api/users',{username:'doctor',name:'Doctor',role:'doctor',password:'test-password-123'})).body.id;
  assert.equal((await request('/api/users/'+doctor,{password:'new-password-123'},'PATCH')).status,200);
  assert.equal((await request('/api/attachments',{patient_id:p,mime:'toString',name:'bad',content:Buffer.from('html').toString('base64')})).status,400);
  assert.equal((await request('/api/patients',null,'POST')).status,400);
  state=(await request('/api/state')).body;assert.equal(state.treatments[0].cost,70000);assert.ok(state.revisions.length>=4);assert.equal(state.patients[0].name,'نەخۆشی تاقیکردنەوە');
  // A real scheduled snapshot is verified, not just timer registration.
  await new Promise(r=>setTimeout(r,5200));state=(await request('/api/state')).body;assert.ok(state.backupStatus.last?.bytes>0);assert.equal(state.backupStatus.error,null);
 }finally{if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}rmSync(dir,{recursive:true,force:true});}
});
