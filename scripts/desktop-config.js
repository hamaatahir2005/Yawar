import path from 'node:path';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function dataIdentity(directory){const value=realpathSync(directory);return createHash('sha256').update(process.platform==='win32'?value.toLowerCase():value).digest('hex').slice(0,16);}
export function desktopDataDirectory(env,root){
 if(env.DATA_DIR)return path.resolve(env.DATA_DIR);
 if(!env.LOCALAPPDATA)throw Error('Windows LOCALAPPDATA is unavailable');
 const home=path.join(env.LOCALAPPDATA,'YawarClinic'),config=path.join(home,'desktop-config.json');
 if(existsSync(config)){const value=JSON.parse(readFileSync(config,'utf8').replace(/^\uFEFF/,''));if(typeof value.dataDirectory!=='string'||!path.isAbsolute(value.dataDirectory))throw Error('Invalid desktop data folder configuration');return value.dataDirectory;}
 const shared=path.join(home,'data');
 if(existsSync(path.join(shared,'clinic.sqlite')))return shared;
 if(existsSync(path.join(root,'data','clinic.sqlite')))return path.join(root,'data');
 return shared;
}
export function cliDataDirectory(env,root,platform=process.platform){
 if(env.DATA_DIR)return path.resolve(env.DATA_DIR);
 const legacy=path.join(root,'data');
 if(existsSync(path.join(legacy,'clinic.sqlite')))return legacy;
 return platform==='win32'?desktopDataDirectory(env,root):legacy;
}
