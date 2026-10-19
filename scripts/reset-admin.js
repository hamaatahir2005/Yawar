// Offline recovery only: stop the clinic first. Passwords are never printed.
import {cliDataDirectory} from './desktop-config.js';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {emitKeypressEvents} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const username=process.argv[2];
if(!username||username.startsWith('--')||!process.argv.includes('--server-stopped')){console.error('Usage: node scripts/reset-admin.js USERNAME --server-stopped\nStop all clinic server processes before offline administrator recovery.');process.exit(1);}
const dir=cliDataDirectory(process.env,path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const source=path.join(dir,'clinic.sqlite');if(!existsSync(source))throw Error('Clinic database not found');
const db=new DatabaseSync(source);
try{
 const account=db.prepare("SELECT id FROM users WHERE username=? AND role='admin'").get(username.toLowerCase());if(!account)throw Error('Administrator not found');
 async function secret(prompt){
  process.stdout.write(prompt);emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  return await new Promise((resolve,reject)=>{let value='';const finish=(error)=>{process.stdin.off('keypress',listener);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');if(error)reject(error);else resolve(value);};const listener=(text,key)=>{if(key?.ctrl&&key.name==='c')return finish(Error('Cancelled'));if(key?.name==='return')return finish();if(key?.name==='backspace'){value=value.slice(0,-1);return;}if(text&&!key?.ctrl&&value.length<128)value+=text;};process.stdin.on('keypress',listener);});
 }
 let next;
 if(process.argv.includes('--password-stdin'))next=readFileSync(0,'utf8').replace(/\r?\n$/,'');
 else{if(!process.stdin.isTTY)throw Error('Use an interactive terminal, or explicit --password-stdin');next=await secret('New password (at least 12 characters, input hidden): ');if(next!==await secret('Repeat password: '))throw Error('Passwords do not match');}
 if(next.length<12||next.length>128)throw Error('Password must contain 12 to 128 characters');
 const salt=randomBytes(16).toString('hex'),hash=salt+':'+scryptSync(next,salt,64).toString('hex');
 db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE users SET password=?,active=1 WHERE id=?').run(hash,account.id);db.prepare('DELETE FROM sessions').run();db.prepare("INSERT INTO audit(user_id,action,entity,record_id) VALUES(?,'offline-password-recovery','users',?)").run(account.id,account.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 console.log('Administrator password reset. All sessions invalidated. Restart the clinic.');
}finally{db.close();}
