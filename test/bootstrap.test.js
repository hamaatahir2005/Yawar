import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const powershell=process.env.POWERSHELL_BIN;
const source=readFileSync(new URL('../Start-Clinic.cmd',import.meta.url),'utf8');
const parts=source.split(/^:__YAWAR_POWERSHELL__\r?$/m);
const body=parts[1];
const quote=s=>"'"+s.replaceAll("'","''")+"'";

// These tests run the actual embedded PowerShell body. A fixture GitHub archive
// replaces the network, and a mock launch.js records execution instead of opening
// a browser. Native Windows CMD invocation remains a separate platform check.
test('Windows launcher has one embedded script and preserves CMD CRLF framing',()=>{
 assert.equal(parts.length,2);assert.match(source,/powershell\.exe -NoLogo -NoProfile -Command/);
 const raw=readFileSync(new URL('../Start-Clinic.cmd',import.meta.url));assert.ok(raw.includes(Buffer.from('\r\n')));
 assert.ok(!source.includes('ExecutionPolicy Bypass'));assert.ok(!source.includes('ServerCertificateValidationCallback'));
});

test('embedded Windows recovery launcher handles ZIP-only, installed, cached and damaged sources',{skip:!powershell},async t=>{
 const root=mkdtempSync(path.join(tmpdir(),"yawar startup's (test) "));
 const bin=path.join(root,'bin');mkdirSync(bin);
 if(process.platform!=='win32')symlinkSync(process.execPath,path.join(bin,'node.exe'));
 const environment={...process.env,XDG_CACHE_HOME:path.join(root,'cache'),XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'xdg-data'),PATH:bin+path.delimiter+process.env.PATH};
 function application(folder){mkdirSync(path.join(folder,'scripts'),{recursive:true});mkdirSync(path.join(folder,'public'));writeFileSync(path.join(folder,'server.js'),'// fixture');writeFileSync(path.join(folder,'package.json'),'{"type":"module"}');writeFileSync(path.join(folder,'public','index.html'),'fixture');writeFileSync(path.join(folder,'scripts','launch.js'),"console.log('FIXTURE_LAUNCHED '+JSON.stringify({cwd:process.cwd(),data:process.env.DATA_DIR||null}));");}
 function invoke(entry,local,network,extra={}){
  const runner=path.join(root,'runner-'+Math.random().toString(16).slice(2)+'.ps1');
  writeFileSync(runner,network+'\n'+body);
  return spawnSync(powershell,['-NoLogo','-NoProfile','-File',runner],{env:{...environment,DATA_DIR:'',YAWAR_ENTRY:entry,LOCALAPPDATA:local,...extra},encoding:'utf8',timeout:30000});
 }
 try{
  const fixture=path.join(root,'fixture','Yawar-main');application(fixture);const archive=path.join(root,'fixture.zip');
  const compress=spawnSync(powershell,['-NoProfile','-Command',`Compress-Archive -LiteralPath ${quote(fixture)} -DestinationPath ${quote(archive)}`],{encoding:'utf8',env:environment});assert.equal(compress.status,0,compress.stderr);
  const online=`function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec) if($Uri -ne 'https://github.com/hamaatahir2005/Yawar/archive/refs/heads/main.zip'){throw 'Unexpected source'} Copy-Item -LiteralPath ${quote(archive)} -Destination $OutFile }`;
  const offline="function Invoke-WebRequest { throw 'Network must not be used' }";
  await t.test('complete extracted project starts without a download',()=>{
   const folder=path.join(root,'complete folder');application(folder);const entry=path.join(folder,'Start-Clinic.cmd');writeFileSync(entry,source);
   const r=invoke(entry,path.join(root,'local-complete'),offline);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/FIXTURE_LAUNCHED/);assert.ok(r.stdout.includes(folder));assert.ok(!r.stdout.includes('Downloading'));
  });
  const temporary=path.join(root,'Explorer ZIP Temp');mkdirSync(temporary);const entry=path.join(temporary,'Start-Clinic.cmd');writeFileSync(entry,source);const local=path.join(root,'Local AppData');mkdirSync(path.join(local,'YawarClinic','data'),{recursive:true});const marker=path.join(local,'YawarClinic','data','existing-patient-data.txt');writeFileSync(marker,'preserve');
  await t.test('CMD extracted alone downloads complete source and preserves existing data',()=>{
   const r=invoke(entry,local,online);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/Downloading/);assert.match(r.stdout,/FIXTURE_LAUNCHED/);assert.ok(existsSync(path.join(local,'YawarClinic','app-launcher-v2','scripts','launch.js')));assert.equal(readFileSync(marker,'utf8'),'preserve');assert.ok(r.stdout.includes('Persistent clinic data:'));
  });
  await t.test('subsequent ZIP-only starts reuse the offline installed application',()=>{
   const r=invoke(entry,local,offline);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/FIXTURE_LAUNCHED/);assert.ok(!r.stdout.includes('Downloading'));
  });
  await t.test('explicit data location is preserved',()=>{
   const custom=path.join(root,'custom data');const r=invoke(entry,local,offline,{DATA_DIR:custom});assert.equal(r.status,0,r.stdout+r.stderr);assert.ok(r.stdout.includes(custom));
  });
  await t.test('incomplete download fails clearly without replacing user files',()=>{
   const brokenLocal=path.join(root,'broken local');const incomplete=path.join(brokenLocal,'YawarClinic','app-launcher-v2');mkdirSync(incomplete,{recursive:true});writeFileSync(path.join(incomplete,'keep.txt'),'preserve');
   const r=invoke(entry,brokenLocal,"function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec) Set-Content -LiteralPath $OutFile -Value 'not a zip' }");assert.equal(r.status,1);assert.match(r.stdout,/Unable to start Yawar/);assert.equal(readFileSync(path.join(incomplete,'keep.txt'),'utf8'),'preserve');
  });
 }finally{rmSync(root,{recursive:true,force:true});}
});
