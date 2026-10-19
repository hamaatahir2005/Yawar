import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {scryptSync} from 'node:crypto';
import {once} from 'node:events';
import {createBackup} from '../scripts/backup.js';

test('upgrades original clinic records without losing history or payments',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'yawar-legacy-'));let child;
 try{
  const db=new DatabaseSync(path.join(dir,'clinic.sqlite'));
  db.exec(`CREATE TABLE patients(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,history TEXT NOT NULL DEFAULT '',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE treatments(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),tooth INTEGER NOT NULL,kind TEXT NOT NULL,doctor TEXT NOT NULL,cost INTEGER NOT NULL,paid INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',date TEXT NOT NULL);
  CREATE TABLE appointments(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),date TEXT NOT NULL,time TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',UNIQUE(date,time));
  INSERT INTO patients(id,name,phone,history) VALUES(7,'Legacy Patient','0000','Preserve medical history');
  INSERT INTO treatments VALUES(9,7,11,'Filling','Test Doctor',50000,20000,'Preserve note','2026-10-01');
  INSERT INTO appointments VALUES(3,7,'2026-10-20','09:00','Review','scheduled');`);db.close();
  child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);child.on('error',reject);child.stdout.on('data',b=>{const m=b.toString().match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});});
  assert.equal((await fetch(base+'/healthz')).status,200);
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',name:'Admin',password:'test-password-123'})});assert.equal(setup.status,200);
  const response=await fetch(base+'/api/state',{headers:{Cookie:setup.headers.get('set-cookie').split(';')[0]}});const s=await response.json();
  assert.equal(s.patients[0].id,7);assert.equal(s.patients[0].history,'Preserve medical history');assert.equal(s.treatments[0].id,9);assert.equal(s.treatments[0].paid,20000);assert.equal(s.treatments[0].notes,'Preserve note');assert.equal(s.appointments[0].duration,30);
  const exit=once(child,'exit');child.kill();await exit;
  execFileSync(process.execPath,['scripts/reset-admin.js','admin','--server-stopped','--password-stdin'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:dir},input:'recovered-password-123\n'});const check=new DatabaseSync(path.join(dir,'clinic.sqlite'));const [salt,hash]=check.prepare("SELECT password FROM users WHERE username='admin'").get().password.split(':');assert.equal(scryptSync('recovered-password-123',salt,64).toString('hex'),hash);assert.equal(check.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(),[]);check.close();
 }finally{if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}rmSync(dir,{recursive:true,force:true});}
});

test('backup retention removes only old clinic snapshots and leaves unrelated files',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'yawar-backups-'));const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE records(value TEXT); INSERT INTO records VALUES(\'Synthetic\')');
 try{writeFileSync(path.join(dir,'keep.txt'),'unrelated');await createBackup(db,dir,2);await new Promise(r=>setTimeout(r,5));await createBackup(db,dir,2);await new Promise(r=>setTimeout(r,5));await createBackup(db,dir,2);const entries=readdirSync(dir);assert.ok(entries.includes('keep.txt'));const files=entries.filter(n=>n.endsWith('.sqlite'));assert.equal(files.length,2);for(const name of files){const copy=new DatabaseSync(path.join(dir,name),{readOnly:true});assert.equal(copy.prepare('SELECT value FROM records').get().value,'Synthetic');copy.close();}}
 finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
