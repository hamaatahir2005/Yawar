import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, copyFileSync, unlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const source=process.argv[2];
if(!source||!process.argv.includes('--server-stopped')){console.error('Usage: node scripts/restore.js /path/backup.sqlite --server-stopped\nStop every clinic server process before restoring. Existing data is preserved in a recovery copy.');process.exit(1);}
const dir=process.env.DATA_DIR||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data');
const target=path.join(dir,'clinic.sqlite');
if(path.resolve(source)===path.resolve(target))throw Error('Backup source must differ from target');
const sourceDb=new DatabaseSync(source,{readOnly:true});
if(sourceDb.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Invalid database integrity');
for(const table of ['users','patients','treatments','appointments','payments','settings','sessions'])sourceDb.prepare(`SELECT COUNT(*) FROM ${table}`).get();
sourceDb.close();mkdirSync(dir,{recursive:true,mode:0o700});
if(existsSync(target)){
 const old=new DatabaseSync(target);old.exec('PRAGMA wal_checkpoint(TRUNCATE)');old.close();
 const recovery=target+'.before-restore-'+Date.now();copyFileSync(target,recovery);chmodSync(recovery,0o600);console.log('Preserved current database:',recovery);
}
for(const suffix of ['-wal','-shm'])if(existsSync(target+suffix))unlinkSync(target+suffix);
copyFileSync(source,target);chmodSync(target,0o600);
const restored=new DatabaseSync(target);restored.exec('DELETE FROM sessions');restored.close();
console.log('Restore complete. Previous browser sessions invalidated. Restart the server and sign in.');
