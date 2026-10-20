import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {desktopDataDirectory,dataIdentity} from './desktop-config.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let server,owned=false,logDirectory;
function message(text){const child=spawn('wscript.exe',[path.join(root,'scripts','message.vbs'),text],{windowsHide:false,stdio:'ignore'});child.on('error',()=>{});}
function stop(){if(owned&&server&&!server.killed)server.kill();}
try{
 if(process.platform!=='win32')throw Error('Desktop mode runs on Windows. Use npm start on other platforms.');
 const data=desktopDataDirectory(process.env,root);mkdirSync(data,{recursive:true});logDirectory=data;
 const expected=dataIdentity(data),port=Number(process.env.PORT||3000),url=`http://127.0.0.1:${port}`;
 const browsers=[process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean).flatMap(base=>[path.join(base,'Microsoft','Edge','Application','msedge.exe'),path.join(base,'Google','Chrome','Application','chrome.exe')]);
 const browser=browsers.find(existsSync);if(!browser)throw Error('Microsoft Edge or Google Chrome must be installed to display the clinic window.');
 let ready=false;
 try{const r=await fetch(url+'/healthz',{signal:AbortSignal.timeout(1500)});if(r.ok){const health=await r.json();if(health.service!=='yawar-clinic'||health.storage!==expected)throw Error('PORT_IN_USE');ready=true;}else throw Error('PORT_IN_USE');}catch(e){if(e.message==='PORT_IN_USE')throw Error('Another application or an older clinic server is using port '+port+'. Close its window before opening Yawar Desktop. Your data has not been changed.');}
 if(!ready){
  server=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:data,PUBLIC_ORIGIN:url,COOKIE_SECURE:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});owned=true;
  let diagnostics='';for(const stream of [server.stdout,server.stderr])stream.on('data',b=>{diagnostics=(diagnostics+b).slice(-16000);});server.on('error',e=>{diagnostics=e.message;});
  for(let i=0;i<480;i++){if(server.exitCode!==null)break;try{const r=await fetch(url+'/healthz',{signal:AbortSignal.timeout(1000)});const h=await r.json();if(r.ok&&h.service==='yawar-clinic'&&h.storage===expected){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  if(!ready){writeFileSync(path.join(data,'desktop-error.log'),diagnostics||'Server did not become ready.');throw Error('Unable to start the clinic. See desktop-error.log in your clinic data folder.');}
 }
 const profiles=path.join(data,'desktop-browser');mkdirSync(profiles,{recursive:true});const profile=path.join(profiles,'profile');mkdirSync(profile,{recursive:true});
 const window=spawn(browser,[`--app=${url}`,`--user-data-dir=${profile}`,'--no-first-run','--disable-background-mode','--no-default-browser-check'],{windowsHide:false,stdio:'ignore'});
 window.once('error',e=>{stop();message(e.message);});window.once('exit',()=>{stop();process.exit(0);});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stop();process.exit(0);});
}catch(e){stop();if(logDirectory)writeFileSync(path.join(logDirectory,'desktop-error.log'),e.stack||e.message);message(e.message);process.exitCode=1;}
