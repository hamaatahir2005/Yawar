"""Build a patient-data-free Windows x64 release from an official Node archive.
Usage: python3 scripts/package-windows.py NODE_ZIP SHASUMS256 VERSION OUTPUT_ZIP
The archive and checksum list must be downloaded with HTTPS verification from
https://nodejs.org/dist/VERSION/. Runtime hashes are verified before extraction.
"""
import hashlib
import pathlib
import sys
import zipfile

archive, sums, version, output = sys.argv[1:]
name = f'node-{version}-win-x64.zip'
expected = next(line.split()[0] for line in pathlib.Path(sums).read_text().splitlines() if line.split()[-1].lstrip('*') == name)
actual = hashlib.sha256(pathlib.Path(archive).read_bytes()).hexdigest()
if actual != expected:
    raise SystemExit('Node.js checksum mismatch; no release was built')
root = pathlib.Path(__file__).resolve().parent.parent
prefix = 'Yawar-Clinic/'
files = ['server.js','package.json','README.md','Start-Clinic.cmd','Backup-Clinic.cmd']
for directory in ['public','scripts','deploy','test']:
    files += [str(p.relative_to(root)) for p in (root/directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
output = pathlib.Path(output)
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as release:
    for relative in sorted(files):
        source = root/relative
        if source.is_symlink():
            raise SystemExit('Symlink not allowed in release: '+relative)
        release.write(source, prefix+relative.replace('\\','/'))
    with zipfile.ZipFile(archive) as runtime:
        base = f'node-{version}-win-x64/'
        for source, destination in [('node.exe','runtime/node.exe'),('LICENSE','runtime/LICENSE.txt')]:
            release.writestr(prefix+destination, runtime.read(base+source))
    release.writestr(prefix+'runtime/PROVENANCE.txt',f'Official Node.js {version} Windows x64\nSource: https://nodejs.org/dist/{version}/{name}\nArchive SHA256: {expected}\nValidated against the official HTTPS SHASUMS256.txt before packaging.\n')
    release.writestr(prefix+'START-HERE.txt','Yawar Dental Clinic for Windows x64\n\nExtract the whole folder to C:\\Yawar or another permanent LOCAL folder.\nDouble-click Start-Clinic.cmd. Keep the server window open.\nFirst run creates your administrator account; no default password exists.\nKurdish instructions: deploy/WINDOWS-ckb.md\nBackups: data/backups; copy to encrypted external storage.\nDo not place patient data in a shared or cloud-synced folder.\nNative Windows installation must be verified on the clinic computer.\n')
print('Verified runtime SHA256:', expected)
print('Release:', output, 'bytes:', output.stat().st_size)
print('Release SHA256:', hashlib.sha256(output.read_bytes()).hexdigest())
