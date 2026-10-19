import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, chmodSync, unlinkSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export async function createBackup(db, directory, retain=14){
 mkdirSync(directory,{recursive:true,mode:0o700});
 const filename='yawar-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite';
 const temporary=path.join(directory,filename+'.partial'),target=path.join(directory,filename);
 try{
  await backup(db,temporary);chmodSync(temporary,0o600);
  const check=new DatabaseSync(temporary,{readOnly:true});
  try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');}finally{check.close();}
  renameSync(temporary,target);
  const files=readdirSync(directory).filter(n=>/^yawar-[\dTZ-]+\.sqlite$/.test(n)).sort().reverse();
  for(const name of files.slice(retain))unlinkSync(path.join(directory,name));
  return {filename,created:new Date().toISOString(),bytes:statSync(target).size};
 }catch(e){if(existsSync(temporary))unlinkSync(temporary);throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const data=process.env.DATA_DIR||path.join(root,'data');
 const source=path.join(data,'clinic.sqlite');
 if(!existsSync(source))throw Error('Start the clinic once before making backups');
 const db=new DatabaseSync(source,{readOnly:true});
 try{const result=await createBackup(db,process.env.BACKUP_DIR||path.join(data,'backups'));console.log('Verified backup created:',result.filename);}finally{db.close();}
}
