"""Build Windows installer using a checksum-verified bundle and NSIS.
Usage: python3 scripts/build-installer.py BUNDLE_ZIP OUTPUT_EXE MAKENSIS
NSIS must come from a verified package or official installation.
"""
import pathlib,sys,tempfile,zipfile,subprocess
bundle,output,compiler=sys.argv[1:]
output=pathlib.Path(output).resolve();output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='yawar-installer-') as temporary:
 stage=pathlib.Path(temporary)
 with zipfile.ZipFile(bundle) as archive:
  if archive.testzip():raise SystemExit('Invalid Windows bundle')
  if any('..' in pathlib.PurePosixPath(n).parts or pathlib.PurePosixPath(n).is_absolute() for n in archive.namelist()):raise SystemExit('Unsafe archive paths')
  archive.extractall(stage)
 root=stage/'Yawar-Clinic'
 for required in ['runtime/node.exe','scripts/Desktop.vbs','scripts/desktop.js','public/clinic.svg','deploy/assets/clinic.ico']:
  if not (root/required).is_file():raise SystemExit('Missing installer file: '+required)
 if (root/'data').exists():raise SystemExit('Patient data must never be included')
 uninstall=stage/'uninstall-files.nsh'
 lines=[]
 for file in sorted(root.rglob('*')):
  if file.is_file():
   name=str(file.relative_to(root)).replace('/','\\').replace('$','$$').replace('"','$\\"')
   lines.append('Delete "$INSTDIR\\'+name+'"')
 for directory in sorted((p for p in root.rglob('*') if p.is_dir()),key=lambda p:len(p.parts),reverse=True):
  lines.append('RMDir "$INSTDIR\\'+str(directory.relative_to(root)).replace('/','\\')+'"')
 uninstall.write_text('\n'.join(lines)+'\n')
 subprocess.run([compiler,'-V3','-DSTAGE='+str(root),'-DOUTPUT='+str(output),'-DUNINSTALL_FILES='+str(uninstall),str(root/'deploy/installer.nsi')],check=True)
print('Windows installer built:',output)
