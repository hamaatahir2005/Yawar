import http from 'node:http';
import { dataIdentity } from './scripts/desktop-config.js';
import { createBackup } from './scripts/backup.js';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.DATA_DIR||path.join(root,'data');
mkdirSync(dataDir,{recursive:true,mode:0o700});
const db=new DatabaseSync(path.join(dataDir,'clinic.sqlite'));
chmodSync(path.join(dataDir,'clinic.sqlite'),0o600);
// Take a consistent, private recovery snapshot before upgrading an existing clinic.
if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patients'").get()&&db.prepare('PRAGMA user_version').get().user_version<4){
 const recovery=path.join(dataDir,'before-v4-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
 await backup(db,recovery);chmodSync(recovery,0o600);
}
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS patients(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,history TEXT NOT NULL DEFAULT '',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS treatments(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),tooth INTEGER NOT NULL,kind TEXT NOT NULL,doctor TEXT NOT NULL,cost INTEGER NOT NULL CHECK(cost>=0),paid INTEGER NOT NULL CHECK(paid>=0 AND paid<=cost),notes TEXT NOT NULL DEFAULT '',date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS appointments(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),date TEXT NOT NULL,time TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',UNIQUE(date,time));
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY,treatment_id INTEGER NOT NULL REFERENCES treatments(id),amount INTEGER NOT NULL CHECK(amount>0),date TEXT NOT NULL,note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS prescriptions(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),doctor TEXT NOT NULL,medicine TEXT NOT NULL,instructions TEXT NOT NULL,date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY,title TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory(id INTEGER PRIMARY KEY,name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>=0),minimum INTEGER NOT NULL CHECK(minimum>=0));
CREATE TABLE IF NOT EXISTS attachments(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),name TEXT NOT NULL,mime TEXT NOT NULL,content BLOB NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT NOT NULL,entity TEXT NOT NULL,record_id INTEGER,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS treatments_patient ON treatments(patient_id);
CREATE INDEX IF NOT EXISTS appointments_date ON appointments(date);
`);
// Migrate original appointment table without discarding existing records.
if(db.prepare("SELECT sql FROM sqlite_master WHERE name='appointments'").get().sql.includes('UNIQUE(date,time)')){
 db.exec(`BEGIN; ALTER TABLE appointments RENAME TO appointments_old;
 CREATE TABLE appointments(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),date TEXT NOT NULL,time TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled');
 INSERT INTO appointments SELECT * FROM appointments_old; DROP TABLE appointments_old;
 CREATE INDEX appointments_date ON appointments(date); COMMIT;`);
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot ON appointments(date,time) WHERE status!='cancelled'");
const cols=db.prepare('PRAGMA table_info(patients)').all().map(c=>c.name);
for(const [name,type] of [['birth_date',"TEXT NOT NULL DEFAULT ''"],['gender',"TEXT NOT NULL DEFAULT ''"],['address',"TEXT NOT NULL DEFAULT ''"],['allergies',"TEXT NOT NULL DEFAULT ''"]])if(!cols.includes(name))db.exec(`ALTER TABLE patients ADD COLUMN ${name} ${type}`);
// Additive upgrades preserve clinical and financial history.
function addColumn(table,name,type){if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);}
addColumn('patients','registered_date',"TEXT NOT NULL DEFAULT ''");
db.exec("UPDATE patients SET registered_date=substr(created,1,10) WHERE registered_date=''");
addColumn('appointments','duration','INTEGER NOT NULL DEFAULT 30');
addColumn('appointments','doctor',"TEXT NOT NULL DEFAULT ''");
addColumn('treatments','plan_id','INTEGER REFERENCES plans(id)');
db.exec(`CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),tooth INTEGER NOT NULL,kind TEXT NOT NULL,doctor TEXT NOT NULL,estimate INTEGER NOT NULL CHECK(estimate>=0),notes TEXT NOT NULL DEFAULT '',date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'planned');
CREATE TABLE IF NOT EXISTS refunds(id INTEGER PRIMARY KEY,treatment_id INTEGER NOT NULL REFERENCES treatments(id),amount INTEGER NOT NULL CHECK(amount>0),reason TEXT NOT NULL,date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,entity TEXT NOT NULL,record_id INTEGER NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
transactionMigration();
function transactionMigration(){
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(`CREATE TABLE IF NOT EXISTS visits(id INTEGER PRIMARY KEY,patient_id INTEGER NOT NULL REFERENCES patients(id),date TEXT NOT NULL,doctor TEXT NOT NULL,payment_mode TEXT NOT NULL CHECK(payment_mode IN ('cash','debt','installments')),notes TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS installments(id INTEGER PRIMARY KEY,visit_id INTEGER NOT NULL REFERENCES visits(id),due_date TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),paid INTEGER NOT NULL DEFAULT 0 CHECK(paid>=0 AND paid<=amount),status TEXT NOT NULL DEFAULT 'active',note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS refund_allocations(id INTEGER PRIMARY KEY,refund_id INTEGER NOT NULL REFERENCES refunds(id),payment_id INTEGER NOT NULL REFERENCES payments(id),installment_id INTEGER NOT NULL REFERENCES installments(id),amount INTEGER NOT NULL CHECK(amount>0));
  CREATE INDEX IF NOT EXISTS installment_visit ON installments(visit_id,due_date);`);
  addColumn('treatments','visit_id','INTEGER REFERENCES visits(id)');
  addColumn('payments','installment_id','INTEGER REFERENCES installments(id)');
  db.exec('PRAGMA user_version=4; COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
let backupStatus={enabled:true,last:null,error:null};
let backupRunning=false;
const backupDir=process.env.BACKUP_DIR||path.join(dataDir,'backups');
async function scheduledBackup(){
 if(backupRunning)return;backupRunning=true;
 try{backupStatus.last=await createBackup(db,backupDir);backupStatus.error=null;}catch{backupStatus.error='پاشەکەوت سەرکەوتوو نەبوو؛ شوێنی دیسک و دەسەڵاتی بوخچەکە بپشکنە';console.error('Scheduled clinic backup failed; check disk space and BACKUP_DIR permissions.');}finally{backupRunning=false;}
}
const firstBackup=setTimeout(scheduledBackup,5000);firstBackup.unref();
const backupTimer=setInterval(scheduledBackup,24*60*60*1000);backupTimer.unref();
const clean=(v,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const int=v=>Number.isSafeInteger(v)&&v>=0;
const fail=(message,status=400)=>{const e=Error(message);e.status=status;throw e;};
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const requireDate=v=>{if(!validDate(v))fail('بەروار دروست نییە');return v;};
const required=(v,max=500)=>{const t=clean(v,max);if(!t)fail('تکایە خانە پێویستەکان پڕ بکەرەوە');return t;};
const hashPassword=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex');};
const verifyPassword=(p,h)=>{const [salt,digest]=h.split(':');const actual=scryptSync(p,salt,64);return timingSafeEqual(actual,Buffer.from(digest,'hex'));};
function password(p){if(typeof p!=='string'||p.length<12||p.length>128)fail('وشەی نهێنی دەبێت لە ١٢ بۆ ١٢٨ پیت بێت');return hashPassword(p);}
const sessionHash=t=>createHash('sha256').update(t).digest('hex');
const audit=(u,action,entity,id=null)=>db.prepare('INSERT INTO audit(user_id,action,entity,record_id) VALUES(?,?,?,?)').run(u?.id||null,action,entity,id);
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}
function getTreatment(id){if(!Number.isSafeInteger(id)||id<1)fail('چارەسەر هەڵبژێرە');const t=db.prepare('SELECT * FROM treatments WHERE id=?').get(id);if(!t)fail('چارەسەر نەدۆزرایەوە',404);return t;}
const teeth=[...Array.from({length:4},(_,q)=>Array.from({length:8},(_,i)=>(q+1)*10+i+1)).flat(),...Array.from({length:4},(_,q)=>Array.from({length:5},(_,i)=>(q+5)*10+i+1)).flat()];
function appointmentValues(b,id=0){
 if(!Number.isInteger(b.patient_id)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time||''))fail('نەخۆش یان کات دروست نییە');
 const date=requireDate(b.date),duration=b.duration??30;
 if(!Number.isInteger(duration)||duration<5||duration>480)fail('ماوە دەبێت لە ٥ بۆ ٤٨٠ خولەک بێت');
 const [h,m]=b.time.split(':').map(Number),start=h*60+m;
 if(start+duration>1440)fail('مەوعید نابێت لە نیوەشەو تێپەڕێت');
 const overlap=db.prepare(`SELECT id FROM appointments WHERE date=? AND id!=? AND status!='cancelled' AND (CAST(substr(time,1,2) AS INTEGER)*60+CAST(substr(time,4,2) AS INTEGER))<? AND (CAST(substr(time,1,2) AS INTEGER)*60+CAST(substr(time,4,2) AS INTEGER)+duration)>? LIMIT 1`).get(date,id,start+duration,start);
 if(overlap)fail('ئەم ماوەیە لەگەڵ مەوعیدێکی تر تێکەڵە');
 return[b.patient_id,date,b.time,required(b.reason,300),duration,clean(b.doctor,100)];
}
function saveRevision(user,entity,id,before,after,reason){
 db.prepare('INSERT INTO revisions(user_id,entity,record_id,before_json,after_json,reason) VALUES(?,?,?,?,?,?)').run(user.id,entity,id,JSON.stringify(before),JSON.stringify(after),required(reason,500));
}
function scheduledBalance(visitId,reason,date=localToday()){
 const visit=db.prepare('SELECT * FROM visits WHERE id=?').get(visitId);if(!visit||visit.payment_mode!=='installments')return;
 const target=db.prepare('SELECT COALESCE(SUM(cost-paid),0) AS n FROM treatments WHERE visit_id=?').get(visitId).n;
 const current=db.prepare("SELECT COALESCE(SUM(amount-paid),0) AS n FROM installments WHERE visit_id=? AND status='active'").get(visitId).n;
 let difference=target-current;
 if(difference>0){const last=db.prepare('SELECT MAX(due_date) AS date FROM installments WHERE visit_id=?').get(visitId).date;db.prepare('INSERT INTO installments(visit_id,due_date,amount,note) VALUES(?,?,?,?)').run(visitId,last&&last>date?last:date,difference,reason);}
 else if(difference<0){
  let reduction=-difference;const rows=db.prepare("SELECT * FROM installments WHERE visit_id=? AND status='active' AND amount>paid ORDER BY due_date DESC,id DESC").all(visitId);
  for(const row of rows){if(!reduction)break;const take=Math.min(reduction,row.amount-row.paid);if(take===row.amount)db.prepare("UPDATE installments SET status='cancelled',note=? WHERE id=?").run(reason,row.id);else db.prepare('UPDATE installments SET amount=amount-?,note=? WHERE id=?').run(take,reason,row.id);reduction-=take;}
 }
}
function paymentRows(t,b){
 const visit=t.visit_id?db.prepare('SELECT * FROM visits WHERE id=?').get(t.visit_id):null;
 const rows=[];let remaining=b.amount;
 if(visit?.payment_mode==='installments'){
  const candidates=b.installment_id?[db.prepare("SELECT * FROM installments WHERE id=? AND visit_id=? AND status='active'").get(b.installment_id,t.visit_id)].filter(Boolean):db.prepare("SELECT * FROM installments WHERE visit_id=? AND status='active' AND amount>paid ORDER BY due_date,id").all(t.visit_id);
  for(const row of candidates){const take=Math.min(remaining,row.amount-row.paid);if(take>0){rows.push({amount:take,installment_id:row.id});remaining-=take;}if(!remaining)break;}
  if(remaining)fail('پارەدان لەگەڵ خشتەی قیستەکان ناگونجێت');
 }else{if(b.installment_id)fail('ئەم چارەسەرە قیستی نییە');rows.push({amount:b.amount,installment_id:null});}
 let first;
 for(const row of rows){const result=db.prepare('INSERT INTO payments(treatment_id,amount,date,note,installment_id) VALUES(?,?,?,?,?)').run(t.id,row.amount,requireDate(b.date),clean(b.note),row.installment_id);if(!first)first=result;if(row.installment_id)db.prepare('UPDATE installments SET paid=paid+? WHERE id=?').run(row.amount,row.installment_id);}
 db.prepare('UPDATE treatments SET paid=paid+? WHERE id=?').run(b.amount,t.id);return first;
}
function create(entity,b,u){
 let result;
 if(entity==='visits'){
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)fail('لانیکەم چارەسەرێک هەڵبژێرە (زۆرترین ١٠٠)');
  const mode=b.payment_mode;if(!['cash','debt','installments'].includes(mode))fail('جۆری پارەدان هەڵبژێرە');
  let total=0;for(const item of b.items){if(!item||!teeth.includes(item.tooth)||!int(item.cost)||!clean(item.kind))fail('زانیاری چارەسەر دروست نییە');total+=item.cost;}
  if(!int(total)||total>100000000000)fail('کۆی نرخ زۆر گەورەیە');
  if(!int(b.paid)||b.paid>total||(mode==='cash'&&b.paid!==total)||(mode!=='cash'&&b.paid===total))fail('پارەی دراو لەگەڵ جۆری پارەدان ناگونجێت');
  const date=requireDate(b.date??localToday()),doctor=required(b.doctor,100);
  let patientId=b.patient_id;
  if(b.new_patient){
   const name=required(b.new_patient.name,100),phone=required(b.new_patient.phone,40);
   if(db.prepare('SELECT id FROM patients WHERE name=? AND phone=?').get(name,phone))fail('ئەم نەخۆشە پێشتر تۆمارکراوە؛ لە نەخۆشەکان هەڵیبژێرە',409);
   patientId=create('patients',{...b.new_patient,name,phone,registered_date:date},u);
  }
  if(!Number.isInteger(patientId)||!db.prepare('SELECT id FROM patients WHERE id=?').get(patientId))fail('نەخۆش هەڵبژێرە یان زانیاری نەخۆشی نوێ بنووسە');
  result=db.prepare('INSERT INTO visits(patient_id,date,doctor,payment_mode,notes) VALUES(?,?,?,?,?)').run(patientId,date,doctor,mode,clean(b.notes,3000));
  const visitId=Number(result.lastInsertRowid);let upfront=b.paid;
  for(const item of b.items){const paid=Math.min(upfront,item.cost);upfront-=paid;const id=create('treatments',{...item,patient_id:patientId,date,doctor,paid,notes:clean(item.notes??b.notes,3000)},u);db.prepare('UPDATE treatments SET visit_id=? WHERE id=?').run(visitId,id);}
  if(mode==='installments'){
   if(!Array.isArray(b.schedule)||!b.schedule.length||b.schedule.length>60)fail('خشتەی قیستەکان دروست بکە (١ بۆ ٦٠ قیست)');
   let scheduled=0;for(const row of b.schedule){if(!row||!int(row.amount)||!row.amount)fail('بڕی هەر قیستێک دەبێت لە سفر زیاتر بێت');scheduled+=row.amount;requireDate(row.due_date);}
   if(scheduled!==total-b.paid)fail('کۆی قیستەکان دەبێت یەکسان بێت بە پارەی ماوە');
   for(const row of b.schedule)db.prepare('INSERT INTO installments(visit_id,due_date,amount) VALUES(?,?,?)').run(visitId,row.due_date,row.amount);
  }
 }else if(entity==='financing'){
  const t=getTreatment(b.treatment_id);let visitId=t.visit_id;
  if(visitId){const visit=db.prepare('SELECT * FROM visits WHERE id=?').get(visitId);if(visit.payment_mode==='installments')fail('ئەم سەردانە پێشتر خشتەی قیستی هەیە');}
  const remaining=visitId?db.prepare('SELECT SUM(cost-paid) AS n FROM treatments WHERE visit_id=?').get(visitId).n:t.cost-t.paid;
  if(remaining<=0)fail('ئەم حسابە قەرزی ماوەی نییە');
  if(!Array.isArray(b.schedule)||!b.schedule.length||b.schedule.length>60)fail('خشتەی قیستەکان دروست نییە');
  let scheduled=0;for(const row of b.schedule){if(!row||!int(row.amount)||!row.amount)fail('بڕی قیست نادروستە');scheduled+=row.amount;requireDate(row.due_date);}if(scheduled!==remaining)fail('خشتەی قیست دەبێت یەکسان بێت بە قەرزی ماوە؛ حسابەکە نوێ بکەرەوە');
  if(!visitId){const visit=db.prepare("INSERT INTO visits(patient_id,date,doctor,payment_mode,notes) VALUES(?,?,?,'installments','پلانی قیست بۆ قەرزی پێشوو')").run(t.patient_id,t.date,t.doctor);visitId=Number(visit.lastInsertRowid);db.prepare('UPDATE treatments SET visit_id=? WHERE id=?').run(visitId,t.id);}else db.prepare("UPDATE visits SET payment_mode='installments' WHERE id=?").run(visitId);
  for(const row of b.schedule)db.prepare('INSERT INTO installments(visit_id,due_date,amount) VALUES(?,?,?)').run(visitId,row.due_date,row.amount);
  result={lastInsertRowid:visitId};
 }else if(entity==='installmentpayments'){
  if(!Number.isSafeInteger(b.installment_id))fail('قیست هەڵبژێرە');
  const row=db.prepare("SELECT * FROM installments WHERE id=? AND status='active'").get(b.installment_id);
  if(!row||!int(b.amount)||b.amount<=0||b.amount>row.amount-row.paid)fail('بڕی پارە لە ماوەی قیست زیاترە یان نادروستە');
  let remaining=b.amount;const treatments=db.prepare('SELECT * FROM treatments WHERE visit_id=? AND cost>paid ORDER BY id').all(row.visit_id);
  for(const t of treatments){if(!remaining)break;const take=Math.min(remaining,t.cost-t.paid);const id=create('payments',{treatment_id:t.id,amount:take,date:b.date,note:b.note,installment_id:row.id},u);if(!result)result={lastInsertRowid:id};remaining-=take;}
  if(remaining)fail('قیست لەگەڵ حسابی چارەسەر ناگونجێت');
 }else if(entity==='patients'){

  if(b.birth_date&&!validDate(b.birth_date))fail('بەرواری لەدایکبوون نادروستە');
  result=db.prepare('INSERT INTO patients(name,phone,history,birth_date,gender,address,allergies,registered_date) VALUES(?,?,?,?,?,?,?,?)').run(required(b.name,100),required(b.phone,40),clean(b.history,3000),clean(b.birth_date,10),clean(b.gender,20),clean(b.address),clean(b.allergies,1000),requireDate(b.registered_date??localToday()));
 }else if(entity==='treatments'){
  if(!Number.isInteger(b.patient_id)||!teeth.includes(b.tooth)||!int(b.cost)||!int(b.paid)||b.paid>b.cost)fail('نرخ، پارە یان ژمارەی ددان دروست نییە');
  result=db.prepare('INSERT INTO treatments(patient_id,tooth,kind,doctor,cost,paid,notes,date) VALUES(?,?,?,?,?,?,?,?)').run(b.patient_id,b.tooth,required(b.kind,100),required(b.doctor,100),b.cost,b.paid,clean(b.notes,3000),requireDate(b.date??localToday()));
  if(b.plan_id){
   const plan=db.prepare('SELECT * FROM plans WHERE id=?').get(b.plan_id);
   if(!plan||plan.patient_id!==b.patient_id||plan.tooth!==b.tooth||plan.status!=='planned')fail('پلانی چارەسەر گونجاو نییە');
   db.prepare('UPDATE treatments SET plan_id=? WHERE id=?').run(plan.id,result.lastInsertRowid);
   db.prepare("UPDATE plans SET status='completed' WHERE id=?").run(plan.id);audit(u,'completed','plans',plan.id);
  }
 }else if(entity==='appointments'){
  result=db.prepare('INSERT INTO appointments(patient_id,date,time,reason,duration,doctor) VALUES(?,?,?,?,?,?)').run(...appointmentValues(b));
 }else if(entity==='plans'){
  if(!Number.isInteger(b.patient_id)||!teeth.includes(b.tooth)||!int(b.estimate))fail('زانیاری پلانی چارەسەر نادروستە');
  result=db.prepare('INSERT INTO plans(patient_id,tooth,kind,doctor,estimate,notes,date) VALUES(?,?,?,?,?,?,?)').run(b.patient_id,b.tooth,required(b.kind,100),required(b.doctor,100),b.estimate,clean(b.notes,3000),requireDate(b.date));
 }else if(entity==='refunds'){
  const t=getTreatment(b.treatment_id);
  if(!int(b.amount)||!b.amount||b.amount>t.paid)fail('گەڕاندنەوە نابێت لە پارەی وەرگیراو زیاتر بێت');
  result=db.prepare('INSERT INTO refunds(treatment_id,amount,reason,date) VALUES(?,?,?,?)').run(t.id,b.amount,required(b.reason,500),requireDate(b.date));
  db.prepare('UPDATE treatments SET paid=paid-? WHERE id=?').run(b.amount,t.id);
  if(t.visit_id){
   let remaining=b.amount;
   const payments=db.prepare('SELECT p.*,p.amount-COALESCE((SELECT SUM(a.amount) FROM refund_allocations a WHERE a.payment_id=p.id),0) AS refundable FROM payments p WHERE treatment_id=? AND installment_id IS NOT NULL ORDER BY id DESC').all(t.id);
   for(const payment of payments){if(!remaining)break;const take=Math.min(remaining,payment.refundable);if(take>0){db.prepare('INSERT INTO refund_allocations(refund_id,payment_id,installment_id,amount) VALUES(?,?,?,?)').run(result.lastInsertRowid,payment.id,payment.installment_id,take);db.prepare('UPDATE installments SET paid=paid-? WHERE id=?').run(take,payment.installment_id);remaining-=take;}}
   scheduledBalance(t.visit_id,'ڕێکخستنی حساب دوای گەڕاندنەوەی پارە',b.date);
  }

 }else if(entity==='payments'){
  const t=getTreatment(b.treatment_id);
  if(!int(b.amount)||b.amount===0||b.amount>t.cost-t.paid)fail('بڕی پارە دەبێت لە سفر زیاتر و لە قەرزی ماوە زیاتر نەبێت');
  result=paymentRows(t,b);
 }else if(entity==='prescriptions'){
  if(!Number.isInteger(b.patient_id))fail('نەخۆش هەڵبژێرە');
  result=db.prepare('INSERT INTO prescriptions(patient_id,doctor,medicine,instructions,date) VALUES(?,?,?,?,?)').run(b.patient_id,required(b.doctor,100),required(b.medicine,2000),required(b.instructions,3000),requireDate(b.date));
 }else if(entity==='expenses'){
  if(!int(b.amount)||!b.amount)fail('بڕی پارە دروست نییە');
  result=db.prepare('INSERT INTO expenses(title,amount,date) VALUES(?,?,?)').run(required(b.title),b.amount,requireDate(b.date));
 }else if(entity==='inventory'){
  if(!int(b.quantity)||!int(b.minimum))fail('ژمارە دروست نییە');
  result=db.prepare('INSERT INTO inventory(name,quantity,minimum) VALUES(?,?,?)').run(required(b.name,150),b.quantity,b.minimum);
 }else if(entity==='users'){
  if(!['admin','doctor','reception'].includes(b.role))fail('دەسەڵات دروست نییە');
  result=db.prepare('INSERT INTO users(name,username,password,role) VALUES(?,?,?,?)').run(required(b.name,100),required(b.username,60).toLowerCase(),password(b.password),b.role);
 }else if(entity==='attachments'){
  if(!Number.isInteger(b.patient_id)||typeof b.content!=='string')fail('فایل نادروستە');
  const bytes=Buffer.from(b.content,'base64');
  const formats={'application/pdf':bytes.subarray(0,5).toString()==='%PDF-','image/png':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/jpeg':bytes[0]===255&&bytes[1]===216&&bytes[2]===255};
  if(!Object.hasOwn(formats,b.mime)||!formats[b.mime]||!bytes.length||bytes.length>5*1024*1024)fail('تەنها PDF، PNG یان JPEG تا ٥ مێگابایت');
  result=db.prepare('INSERT INTO attachments(patient_id,name,mime,content) VALUES(?,?,?,?)').run(b.patient_id,required(b.name,150),b.mime,bytes);
 }else fail('بەش نەدۆزرایەوە',404);
 audit(u,'create',entity,Number(result.lastInsertRowid));return Number(result.lastInsertRowid);
}
const access={admin:['financing','visits','installmentpayments','plans','refunds','patients','treatments','appointments','payments','prescriptions','expenses','inventory','users','attachments','settings'],doctor:['visits','plans','patients','treatments','appointments','prescriptions','attachments'],reception:['financing','installmentpayments','patients','appointments','payments']};
const attempts=new Map();
function throttle(req){const key=req.socket.remoteAddress;const now=Date.now();let a=attempts.get(key);if(!a||a.until<now){a={count:0,until:now+900000};attempts.set(key,a);}if(++a.count>15)fail('هەوڵی زۆر؛ دوای ١٥ خولەک دووبارە هەوڵ بدەرەوە',429);}
async function readBody(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>7*1024*1024)fail('فایل زۆر گەورەیە',413);chunks.push(c);}try{const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')fail('داواکاری نادروستە');return parsed;}catch{fail('داواکاری نادروستە');}}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 try{
  const token=decodeURIComponent((req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8)||'');
  const session=token?db.prepare('SELECT s.*,u.name,u.username,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=? AND expires>? AND active=1').get(sessionHash(token),Date.now()):null;
  const user=session?{id:session.user_id,name:session.name,username:session.username,role:session.role}:null;
  const setup=!db.prepare('SELECT id FROM users LIMIT 1').get();
  if(url.pathname==='/healthz'&&req.method==='GET'){db.prepare('SELECT 1').get();return json(200,{ok:true,service:'yawar-clinic',storage:dataIdentity(dataDir)});}
  if(url.pathname==='/api/auth'&&req.method==='GET')return json(200,{setup,user,csrf:session?.csrf});
  if(['POST','PATCH','DELETE'].includes(req.method)){
   if(req.headers.origin&&req.headers.origin!==`${process.env.PUBLIC_ORIGIN||`http://${req.headers.host}`}`)fail('پەیوەندی نادروستە',403);
   if(req.headers['sec-fetch-site']==='cross-site')fail('پەیوەندی نادروستە',403);
  }
  if((url.pathname==='/api/setup'||url.pathname==='/api/login')&&req.method==='POST'){
   throttle(req);const b=await readBody(req);let account;
   if(url.pathname==='/api/setup'){
    if(!setup)fail('ڕێکخستن پێشتر کراوە',409);
    const id=transaction(()=>{if(db.prepare('SELECT id FROM users LIMIT 1').get())fail('ڕێکخستن پێشتر کراوە',409);const id=create('users',{...b,role:'admin'},null);for(const [k,v] of Object.entries({name:clean(b.clinic_name,100)||'کلینیکی ددانی یاوەر',phone:'',address:''}))db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(k,v);return id;});
    account=db.prepare('SELECT * FROM users WHERE id=?').get(id);
   }else{
    account=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(clean(b.username,60).toLowerCase());
    if(typeof b.password!=='string'||b.password.length>128||!verifyPassword(b.password,account?.password||'00000000000000000000000000000000:'+ '00'.repeat(64))||!account)fail('ناوی بەکارهێنەر یان وشەی نهێنی هەڵەیە',401);
   }
   db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
   const sid=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
   db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionHash(sid),account.id,csrf,Date.now()+(b.remember===true?30*24:8)*60*60*1000);
   res.setHeader('Set-Cookie',`session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${b.remember===true?2592000:28800}${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);
   audit(account,'login','users',account.id);return json(200,{ok:true});
  }
  if(url.pathname.startsWith('/api/')){
   if(!user)fail('تکایە بچۆ ژوورەوە',401);
   if(req.method!=='GET'&&req.headers['x-csrf-token']!==session.csrf)fail('تکایە پەڕەکە نوێ بکەرەوە',403);
   if(url.pathname==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(sessionHash(token));res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{ok:true});}
   if(url.pathname==='/api/password'&&req.method==='POST'){
    const b=await readBody(req),u=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if(typeof b.current!=='string'||b.current.length>128||!verifyPassword(b.current,u.password))fail('وشەی نهێنی ئێستا هەڵەیە');
    db.prepare('UPDATE users SET password=? WHERE id=?').run(password(b.password),user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);audit(user,'password','users',user.id);return json(200,{ok:true});
   }
   if(url.pathname==='/api/state'&&req.method==='GET'){
    const data={user,visits:db.prepare('SELECT * FROM visits ORDER BY date DESC,id DESC').all(),installments:db.prepare('SELECT * FROM installments ORDER BY due_date,id').all(),refundAllocations:db.prepare('SELECT * FROM refund_allocations').all(),plans:db.prepare('SELECT * FROM plans ORDER BY date,id').all(),refunds:db.prepare('SELECT * FROM refunds ORDER BY id DESC').all(),patients:db.prepare('SELECT * FROM patients ORDER BY id DESC').all(),treatments:db.prepare('SELECT * FROM treatments ORDER BY date DESC,id DESC').all(),appointments:db.prepare('SELECT * FROM appointments ORDER BY date,time').all(),payments:db.prepare('SELECT * FROM payments ORDER BY id DESC').all(),prescriptions:db.prepare('SELECT * FROM prescriptions ORDER BY date DESC,id DESC').all(),attachments:db.prepare('SELECT id,patient_id,name,mime,created FROM attachments ORDER BY id DESC').all(),settings:Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(s=>[s.key,s.value])),inventory:db.prepare('SELECT * FROM inventory ORDER BY name').all()};
    if(user.role==='reception'){data.visits=data.visits.map(v=>({...v,notes:''}));data.plans=[];data.patients=data.patients.map(p=>({...p,history:'',allergies:''}));data.treatments=data.treatments.map(t=>({...t,notes:''}));data.prescriptions=[];data.attachments=[];}
    if(user.role==='admin'){data.backupStatus=backupStatus;data.expenses=db.prepare('SELECT * FROM expenses ORDER BY date DESC,id DESC').all();data.users=db.prepare('SELECT id,name,username,role,active FROM users').all();data.revisions=db.prepare('SELECT id,user_id,entity,record_id,reason,created FROM revisions ORDER BY id DESC LIMIT 100').all();data.audit=db.prepare('SELECT a.*,u.name FROM audit a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.id DESC LIMIT 100').all();}return json(200,data);
   }
   if(url.pathname==='/api/backup'&&req.method==='GET'){
    if(user.role!=='admin')fail('دەسەڵاتت نییە',403);
    const target=path.join(dataDir,`backup-${randomBytes(8).toString('hex')}.sqlite`);
    const {unlinkSync}=await import('node:fs');
    try{await backup(db,target);chmodSync(target,0o600);audit(user,'backup','database');res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="yawar-${new Date().toISOString().slice(0,10)}.sqlite"`});res.end(readFileSync(target));}finally{try{unlinkSync(target);}catch{}}return;
   }
   const file=url.pathname.match(/^\/api\/attachments\/(\d+)$/);
   if(file&&req.method==='GET'){
    if(user.role==='reception')fail('دەسەڵاتت نییە',403);
    const f=db.prepare('SELECT * FROM attachments WHERE id=?').get(Number(file[1]));if(!f)fail('فایل نەدۆزرایەوە',404);
    audit(user,'download','attachments',f.id);res.writeHead(200,{'Content-Type':f.mime,'Content-Disposition':`attachment; filename="file-${f.id}"; filename*=UTF-8''${encodeURIComponent(f.name)}`});return res.end(f.content);
   }
   const match=url.pathname.match(/^\/api\/([a-z]+)(?:\/(\d+))?$/);
   if(!match)fail('نەدۆزرایەوە',404);
   const [,entity,record]=match,id=Number(record);
   if(!access[user.role]?.includes(entity))fail('دەسەڵاتت نییە',403);
   if(req.method==='POST'&&!record){const b=await readBody(req);const id=transaction(()=>create(entity,b,user));return json(201,{ok:true,id});}
   if(req.method==='PATCH'){
    const b=await readBody(req);
    transaction(()=>{
     let changes=0;
     if(entity==='patients'){
      const before=db.prepare('SELECT * FROM patients WHERE id=?').get(id);if(!before)fail('نەخۆش نەدۆزرایەوە',404);
      if(user.role==='reception'){const existing=db.prepare('SELECT history,allergies FROM patients WHERE id=?').get(id);if(!existing)fail('نەخۆش نەدۆزرایەوە',404);b.history=existing.history;b.allergies=existing.allergies;}
      if(b.birth_date&&!validDate(b.birth_date))fail('بەروار نادروستە');
      changes=db.prepare('UPDATE patients SET name=?,phone=?,history=?,birth_date=?,gender=?,address=?,allergies=?,registered_date=? WHERE id=?').run(required(b.name,100),required(b.phone,40),clean(b.history,3000),clean(b.birth_date,10),clean(b.gender,20),clean(b.address),clean(b.allergies,1000),requireDate(b.registered_date??before.registered_date),id).changes;saveRevision(user,entity,id,before,db.prepare('SELECT * FROM patients WHERE id=?').get(id),b.change_reason||'patient update');
     }else if(entity==='appointments'){
      const before=db.prepare('SELECT * FROM appointments WHERE id=?').get(id);if(!before)fail('مەوعید نەدۆزرایەوە',404);
      if(b.status!==undefined){
       if(!['scheduled','completed','cancelled'].includes(b.status))fail('دۆخ نادروستە');
       if(b.status==='scheduled')appointmentValues(before,id);
       changes=db.prepare('UPDATE appointments SET status=? WHERE id=?').run(b.status,id).changes;
      }else{
       if(before.status!=='scheduled')fail('تەنها مەوعیدی چاوەڕوان دەگۆڕدرێت');
       changes=db.prepare('UPDATE appointments SET patient_id=?,date=?,time=?,reason=?,duration=?,doctor=? WHERE id=?').run(...appointmentValues(b,id),id).changes;
      }
      saveRevision(user,entity,id,before,db.prepare('SELECT * FROM appointments WHERE id=?').get(id),b.change_reason||'appointment update');
     }else if(entity==='plans'){
      if(!['planned','cancelled'].includes(b.status))fail('دۆخی پلان دروست نییە');
      const before=db.prepare('SELECT * FROM plans WHERE id=?').get(id);if(!before)fail('پلان نەدۆزرایەوە',404);if(before.status==='completed')fail('پلانی تەواوبوو ناگۆڕدرێت');
      changes=db.prepare('UPDATE plans SET status=? WHERE id=?').run(b.status,id).changes;
     }else if(entity==='treatments'){
      const before=getTreatment(id),reason=required(b.change_reason,500);
      if(b.cost!==undefined){if(user.role!=='admin')fail('تەنها بەڕێوەبەر نرخ دەگۆڕێت',403);if(!int(b.cost)||b.cost<before.paid)fail('نرخ نابێت لە پارەی وەرگیراو کەمتر بێت');}
      changes=db.prepare('UPDATE treatments SET kind=?,doctor=?,notes=?,cost=? WHERE id=?').run(required(b.kind??before.kind,100),required(b.doctor??before.doctor,100),b.notes===undefined?before.notes:clean(b.notes,3000),b.cost??before.cost,id).changes;
      if(before.visit_id)scheduledBalance(before.visit_id,reason);
      saveRevision(user,entity,id,before,getTreatment(id),reason);
     }else if(entity==='prescriptions'){
      const before=db.prepare('SELECT * FROM prescriptions WHERE id=?').get(id);if(!before)fail('ڕەچەتە نەدۆزرایەوە',404);
      changes=db.prepare('UPDATE prescriptions SET doctor=?,medicine=?,instructions=? WHERE id=?').run(required(b.doctor,100),required(b.medicine,2000),required(b.instructions,3000),id).changes;
      saveRevision(user,entity,id,before,db.prepare('SELECT * FROM prescriptions WHERE id=?').get(id),required(b.change_reason));
     }else if(entity==='expenses'){
      const before=db.prepare('SELECT * FROM expenses WHERE id=?').get(id);if(!before)fail('خەرجی نەدۆزرایەوە',404);if(!int(b.amount)||!b.amount)fail('بڕ نادروستە');
      changes=db.prepare('UPDATE expenses SET title=?,amount=?,date=? WHERE id=?').run(required(b.title),b.amount,requireDate(b.date),id).changes;
      saveRevision(user,entity,id,before,db.prepare('SELECT * FROM expenses WHERE id=?').get(id),required(b.change_reason));
     }else if(entity==='inventory'){
      if(!int(b.quantity)||!int(b.minimum))fail('ژمارە نادروستە');changes=db.prepare('UPDATE inventory SET name=?,quantity=?,minimum=? WHERE id=?').run(required(b.name,150),b.quantity,b.minimum,id).changes;
     }else if(entity==='users'){
      const before=db.prepare('SELECT id,name,username,role,active FROM users WHERE id=?').get(id);if(!before)fail('بەکارهێنەر نەدۆزرایەوە',404);
      if(b.password!==undefined){
       if(id===user.id)fail('بۆ گۆڕینی وشەی نهێنی خۆت، بەشی وشەی نهێنی بەکاربهێنە');
       changes=db.prepare('UPDATE users SET password=? WHERE id=?').run(password(b.password),id).changes;db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      }else{
       const role=b.role??before.role,active=b.active??before.active,name=b.name===undefined?before.name:required(b.name,100),username=b.username===undefined?before.username:required(b.username,60).toLowerCase();
       if(!['admin','doctor','reception'].includes(role)||![0,1].includes(active))fail('ڕۆڵ یان دۆخ نادروستە');
       if(before.role==='admin'&&before.active===1&&(role!=='admin'||active===0)&&db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1").get().n<=1)fail('ناتوانیت دوایین بەڕێوەبەری چالاک ناچالاک بکەیت یان ڕۆڵەکەی بگۆڕیت');
       changes=db.prepare('UPDATE users SET name=?,username=?,role=?,active=? WHERE id=?').run(name,username,role,active,id).changes;
       saveRevision(user,entity,id,before,{id,name,username,role,active},'user profile/role update');
       if(role!==before.role||active!==before.active||username!==before.username)db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      }
     }else if(entity==='settings'){
      for(const k of ['name','phone','address'])db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(k,k==='name'?required(b[k],100):clean(b[k]));changes=1;
     }else fail('گۆڕانکاری پشتگیری ناکرێت',405);
     if(!changes)fail('تۆمار نەدۆزرایەوە',404);audit(user,'update',entity,id||null);
    });return json(200,{ok:true});
   }
   fail('داواکاری پشتگیری ناکرێت',405);
  }
  const files={'/':'index.html','/app.js':'app.js','/clinic-workflows.js':'clinic-workflows.js','/style.css':'style.css','/clinic.svg':'clinic.svg'};
  if(req.method!=='GET'||!files[url.pathname])fail('نەدۆزرایەوە',404);
  res.writeHead(200,{'Content-Type':url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(readFileSync(path.join(root,'public',files[url.pathname])));
 }catch(e){const constraint=String(e.message).includes('constraint');json(e.status||(constraint?400:500),{error:e.status?e.message:constraint?(e.message.includes('UNIQUE')?'ناوی بەکارهێنەر یان کاتی مەوعید پێشتر گیراوە':'زانیاری تۆمار دروست نییە'):'هەڵەیەک ڕوویدا؛ دووبارە هەوڵ بدەرەوە'});}
});
server.requestTimeout=30000;server.headersTimeout=15000;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{clearTimeout(firstBackup);clearInterval(backupTimer);server.close(async()=>{while(backupRunning)await new Promise(r=>setTimeout(r,50));db.close();process.exit(0);});server.closeIdleConnections();setTimeout(()=>process.exit(1),10000).unref();});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Yawar clinic listening on port '+server.address().port));
