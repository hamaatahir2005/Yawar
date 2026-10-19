# Yawar Windows desktop installer — v3.0.0

Download Yawar-Setup.exe and close the previous clinic server before installing.
The installer includes the official checksum-verified Node.js runtime, creates desktop/start menu icons and opens an Edge/Chrome app window without a console. Daily operation is offline.

Source commit: 0b976229fdc48094a487ccbbca2f0477a5ddd918
Source: https://github.com/hamaatahir2005/Yawar/tree/0b976229fdc48094a487ccbbca2f0477a5ddd918
Kurdish instructions: https://github.com/hamaatahir2005/Yawar/blob/main/deploy/WINDOWS-ckb.md

Existing recovered clinic data in %LOCALAPPDATA%\YawarClinic\data is reused. For another existing data folder, choose Start Menu > Yawar Clinic > Choose existing clinic data while all clinic processes are closed. Back up before upgrading. Uninstall preserves data and unknown files.

Validation: API/PowerShell regression tests, browser checks, offline local requests, compiler output integrity and extracted installer payload tests. Native Windows setup/VBS/Edge window behavior has not been run in this Linux workspace. The installer is unsigned. Windows x64 and Edge or Chrome are required.
