import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(Number(process.versions.node.split('.')[0])<24)throw Error('Install Node.js 24 or newer from https://nodejs.org');
const port=Number(process.env.PORT||3000),url=`http://127.0.0.1:${port}`;
function openBrowser(){
 const command=process.platform==='win32'?'rundll32':process.platform==='darwin'?'open':'xdg-open';
 const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
 const browser=spawn(command,args,{stdio:'ignore',detached:true});browser.on('error',()=>console.log('Open your browser at '+url));browser.unref();
}
try{const r=await fetch(url+'/healthz',{signal:AbortSignal.timeout(1500)});if(r.ok&&(await r.json()).service==='yawar-clinic'){console.log('Clinic is already running at '+url);openBrowser();process.exit(0);}}catch{}
const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,env:{...process.env,HOST:'127.0.0.1'},stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',code=>process.exit(code||0));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
for(let i=0;i<40;i++){
 try{const r=await fetch(url+'/healthz',{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).service==='yawar-clinic'){openBrowser();break;}}catch{}
 await new Promise(r=>setTimeout(r,250));
}
