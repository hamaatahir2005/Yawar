import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {desktopDataDirectory,dataIdentity,cliDataDirectory} from '../scripts/desktop-config.js';

test('registration/treatment dates and role changes preserve administrator access and invalidate old permissions',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'yawar-v3-'));let child;
 try{
  child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir,TZ:'Pacific/Kiritimati'},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);child.on('error',reject);child.stdout.on('data',b=>{const m=b.toString().match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});});
  let cookie='',csrf='';
  async function call(route,body,method=body?'POST':'GET'){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return{status:r.status,body:await r.json()};}
  await call('/api/setup',{username:'admin',name:'Admin',password:'test-password-123'});csrf=(await call('/api/auth')).body.csrf;const adminCookie=cookie,adminCsrf=csrf;
  const patient=await call('/api/patients',{name:'Synthetic',phone:'0000'});assert.equal(patient.status,201);
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Pacific/Kiritimati',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=t=>parts.find(p=>p.type===t).value,expected=`${get('year')}-${get('month')}-${get('day')}`;
  let state=(await call('/api/state')).body;assert.equal(state.patients[0].registered_date,expected);
  const treatment=await call('/api/treatments',{patient_id:patient.body.id,tooth:11,kind:'Test',doctor:'Test',cost:1000,paid:0});assert.equal(treatment.status,201);state=(await call('/api/state')).body;assert.equal(state.treatments[0].date,expected);
  assert.equal((await call('/api/patients',{name:'Bad date',phone:'0',registered_date:'2026-02-30'})).status,400);
  assert.equal((await call('/api/patients/'+patient.body.id,{name:'Synthetic',phone:'0',registered_date:'2025-06-01'},'PATCH')).status,200);
  const staff=(await call('/api/users',{name:'Doctor',username:'doctor',password:'test-password-123',role:'doctor'})).body.id;
  assert.equal((await call('/api/users/1',{role:'doctor'},'PATCH')).status,400);assert.equal((await call('/api/users/1',{active:0},'PATCH')).status,400);
  await call('/api/login',{username:'doctor',password:'test-password-123'});csrf=(await call('/api/auth')).body.csrf;const oldStaffCookie=cookie;
  assert.equal((await call('/api/users/'+staff,{role:'admin'},'PATCH')).status,403);
  cookie=adminCookie;csrf=adminCsrf;
  assert.equal((await call('/api/users/'+staff,{name:'Reception Name',username:'reception',role:'reception',active:1},'PATCH')).status,200);
  assert.equal((await fetch(base+'/api/state',{headers:{Cookie:oldStaffCookie}})).status,401);
  await call('/api/login',{username:'reception',password:'test-password-123'});csrf=(await call('/api/auth')).body.csrf;state=(await call('/api/state')).body;assert.equal(state.user.role,'reception');assert.equal(state.user.name,'Reception Name');
  assert.equal((await call('/api/treatments',{patient_id:patient.body.id,tooth:12,kind:'Blocked',doctor:'Test',cost:0,paid:0})).status,403);
  cookie=adminCookie;csrf=adminCsrf;
  assert.equal((await call('/api/users/'+staff,{role:'invalid'},'PATCH')).status,400);
  assert.equal((await call('/api/users/'+staff,{username:'admin'},'PATCH')).status,400);
  const other=(await call('/api/users',{name:'Other Admin',username:'other',password:'test-password-123',role:'admin'})).body.id;
  assert.equal((await call('/api/users/1',{role:'doctor'},'PATCH')).status,200);assert.equal((await call('/api/state')).status,401);
  await call('/api/login',{username:'other',password:'test-password-123'});csrf=(await call('/api/auth')).body.csrf;
  assert.equal((await call('/api/users/'+other,{role:'reception'},'PATCH')).status,400);
  state=(await call('/api/state')).body;assert.equal(state.patients[0].registered_date,'2025-06-01');assert.ok(state.revisions.some(r=>r.entity==='users'));
  const health=(await call('/healthz')).body;assert.equal(health.storage,dataIdentity(dir));
 }finally{if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}rmSync(dir,{recursive:true,force:true});}
});

test('desktop uses recovered or explicitly selected databases without copying or deleting records',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'yawar-data-selection-'));
 try{
  const local=path.join(root,'LocalAppData'),app=path.join(root,'program');mkdirSync(app,{recursive:true});
  assert.equal(desktopDataDirectory({LOCALAPPDATA:local},app),path.join(local,'YawarClinic','data'));
  const legacy=path.join(app,'data');mkdirSync(legacy);writeFileSync(path.join(legacy,'clinic.sqlite'),'legacy marker');assert.equal(desktopDataDirectory({LOCALAPPDATA:local},app),legacy);
  const recovered=path.join(local,'YawarClinic','data');mkdirSync(recovered,{recursive:true});writeFileSync(path.join(recovered,'clinic.sqlite'),'recovered marker');assert.equal(desktopDataDirectory({LOCALAPPDATA:local},app),recovered);
  const selected=path.join(root,'existing data');mkdirSync(selected);writeFileSync(path.join(local,'YawarClinic','desktop-config.json'),'\uFEFF'+JSON.stringify({dataDirectory:selected}));assert.equal(desktopDataDirectory({LOCALAPPDATA:local},app),selected);assert.equal(cliDataDirectory({LOCALAPPDATA:local},app,'win32'),legacy);const installed=path.join(root,'new-install');mkdirSync(installed);assert.equal(cliDataDirectory({LOCALAPPDATA:local},installed,'win32'),selected);
  assert.equal(desktopDataDirectory({LOCALAPPDATA:local,DATA_DIR:legacy},app),legacy);
  assert.equal(readFileSync(path.join(legacy,'clinic.sqlite'),'utf8'),'legacy marker');assert.equal(readFileSync(path.join(recovered,'clinic.sqlite'),'utf8'),'recovered marker');
 }finally{rmSync(root,{recursive:true,force:true});}
});
