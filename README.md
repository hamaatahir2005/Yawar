# یاوەر — Yawar Dental Clinic

## ⬇ داگرتنی بەرنامەی Windows

**[داگرتنی Yawar Setup.exe بۆ Windowsی ٦٤ بیت](https://github.com/hamaatahir2005/Yawar/raw/refs/heads/windows-downloads/Yawar-Setup.exe)**

[بینینی فایلی Setup لە GitHub](https://github.com/hamaatahir2005/Yawar/blob/windows-downloads/Yawar-Setup.exe) · [ڕێنمایی دامەزراندن بە کوردی](deploy/WINDOWS-ckb.md)

پێش دامەزراندن، پاشەکەوتێک دابگرە و پەنجەرەکانی سیستەمی کۆن دابخە. Node.js لەناو Setupەکەدایە. فایلەکە واژۆی دیجیتاڵی نییە و دامەزراندنی ڕاستەقینەی Windows لەم ژینگەیەدا تاقی نەکراوەتەوە.

---

Kurdish Sorani / RTL clinic management application for one clinic. Node.js 24+, SQLite, no runtime packages or external service credentials. Responsive desktop/mobile interface, empty initial database, no default passwords.

## Windows desktop installer (v3)

Download `Yawar-Setup.exe` from the repository's `windows-downloads` branch. It installs for the current Windows user, creates Desktop/Start Menu icons, includes the verified Node.js runtime, and opens a dedicated Edge/Chrome app window without a console. It runs offline after installation; Windows 10/11 x64 and Edge or Chrome must already be present. The installer is not digitally signed and has not been executed on native Windows in this workspace.

Close the old clinic server and make a backup before upgrading. The desktop reuses `%LOCALAPPDATA%\YawarClinic\data` created by the recovery launcher. If your database lives elsewhere, use Start Menu → Yawar Clinic → Choose existing clinic data; select the folder containing `clinic.sqlite` while all clinic processes are closed. This records a path, and never copies/deletes patient records. Selected folders must remain available. Unknown files and all clinic data are preserved by uninstallation. The desktop creates an isolated temporary browser profile and requires login on each new launch. Closing its window stops the server it started; an existing shared server is left running. Desktop mode is intended for the single-PC workflow, not as an always-on LAN server.

The installer build is reproducible via `scripts/package-windows.py` (official Node archive/checksum) followed by `scripts/build-installer.py` with NSIS. The compiler packages used here were verified by APT using Debian's signed repository metadata. The NSIS output archive was integrity-tested with 7-Zip; actual Windows installation, shortcuts, VBS launch, and Edge process behavior remain platform checks on the clinic PC.

## Windows clinic deployment

The Windows-x64 release includes a checksum-verified official Node.js runtime. Extract it to a permanent local folder and double-click `Start-Clinic.cmd`. It opens the browser, binds to loopback, and keeps data in `data/`. There is no default account. `Backup-Clinic.cmd` creates a verified manual snapshot. Read [the Kurdish Windows guide](deploy/WINDOWS-ckb.md). Source-only checkouts require Node.js 24+. If Explorer opens only the CMD inside a ZIP, the launcher now downloads the complete project into `%LOCALAPPDATA%\YawarClinic\app-launcher-v3` and uses `%LOCALAPPDATA%\YawarClinic\data` unless DATA_DIR is explicitly set. An Internet connection to GitHub is needed only for that first recovery download; complete extracted folders and cached recovery installations start offline. No existing data from other locations is moved or overwritten. Native Windows launch and optional Caddy LAN setup still require validation on the clinic computer; automated tests here ran on Linux.

## Start

```sh
cd /workspace/Yawar
npm test
npm start
```

Open the application in your deployment's browser access route. The first visit creates the clinic and administrator account; choose a unique password of at least 12 characters. Complete first-run setup on a trusted private connection before allowing anyone else to access it. `npm run dev` enables watch mode.

Default bind is `127.0.0.1:3000`. `PORT`, `HOST`, `DATA_DIR` override defaults. Persistent SQLite files are in ignored `data/`. Reuse the existing isolated checkout; no Git worktree needed. Restart the server in new cloud tasks.

## Implemented workflows

- Patients: registration/editing, name/phone search, birth date, gender, address, allergies, medical history, patient dossier.
- Dental chart: FDI permanent and primary teeth, treatment highlights, click a tooth to start treatment.
- Treatments: doctor, tooth, date, procedure, notes, whole-IQD cost and initial payment.
- Appointments: date/time booking, date filter, completion/cancellation, collision prevention, reuse cancelled slots. Duration-aware collision detection for a single clinic chair, rescheduling, doctor labels, and cancelled-slot reuse. Parallel per-doctor calendars are not implemented.
- Plans: staged treatment plans with per-tooth estimated costs, cancellation and atomic conversion to completed treatments; duplicate completion is rejected.
- Finance: admin-only refunds, audited price corrections, subsequent payments, outstanding balances, payment history, printable treatment invoices, expenses, cash balance, date-range reports, CSV export (spreadsheet formula escaping).
- Prescriptions: medicine, doctor, dosage instructions, printable prescription. Clinician must verify every medication/dose; no drug interaction checker.
- Files: authenticated PDF/PNG/JPEG downloads with signature checks and 5 MiB cap. No external storage provider.
- Inventory: quantity editing, minimum stock alert.
- Admin: clinic branding/contact, user creation/activation, last 100 audit events, consistent online SQLite backup.
- Security: scrypt password hashes, HttpOnly SameSite session cookies, eight-hour session expiry, CSRF tokens and origin checks, login rate limit, role checks, password changes invalidate sessions, deactivated accounts lose access. No password values in logs. There is no forgotten-password email service. An admin can reset another staff password in Settings, while offline administrator recovery is available in `scripts/reset-admin.js` after stopping all servers (see the Kurdish Windows guide).

### Permissions

Admin manages all sections. Doctor manages clinical records, treatments, prescriptions, appointments and patient files. Reception manages patients, appointments and payments; clinical history and files are withheld. All roles can read billing summaries and inventory. Admin-only expenses, user management, audit and backups. Records with financial/clinical history deliberately have no destructive delete action; refunds preserve separate immutable entries, adjust net receipts and reopen the appropriate balance. Admin can correct cost only above or equal to net payments; clinical edits, patient updates, prescriptions, expenses and appointment changes retain previous/new snapshots in a revisions table. No destructive transaction deletion is available.

## Before using real patient data

Functional checks are automated; production deployment and clinical acceptance are separate. The user selected a Windows computer inside the clinic. For one PC, loopback operation requires no public domain or Internet service. A public domain/TLS deployment is not part of this setup. Encrypted disks and off-device backup storage still need configuration on the actual computer. Before operational use:

1. Deploy on a trusted server with encrypted storage, limited OS access and monitored disk space. Keep SQLite on a local disk, not a shared network filesystem. Use one server process for this small clinic deployment.
2. For the selected single-PC Windows mode, keep the default loopback bind. For multiple LAN devices, use the supplied private-CA Caddy configuration, set `PUBLIC_ORIGIN` to the exact HTTPS LAN address and `COOKIE_SECURE=1`, and trust the private root CA on each approved device. Do not expose the Node port publicly or bypass certificate warnings.
3. Create individual staff accounts with minimum permissions. Complete first-run setup privately. Check staff access and keep the server behind a private network until rollout.
4. Schedule encrypted off-site backups, control access to them, and regularly rehearse restore. Backup downloads include patient records and password hashes; treat them as highly sensitive. They must never be placed in public web directories.
5. Have the clinic validate treatment terminology, receipt requirements, retention/privacy rules and actual daily workflows. No claim of regulatory certification or independent penetration testing is made.

Node's built-in SQLite API may emit an experimental warning depending on the runtime. Sessions and login rate limits are local to this server; rate limits reset on process restart. Audit stores mutation/login/download/backup events. Supported clinical and financial edits additionally retain before/after snapshots in the revisions table; it is not a comprehensive clinical document-signing system. No MFA, antivirus scanner, automated reminders, email/SMS integration, insurance claims, payroll, parallel-chair schedules, orthodontic imaging viewer or external insurance integration is implemented.

## Backup / restore

Automatic verified SQLite snapshots run five seconds after startup and every 24 hours while the server is running, retaining the last 14 files in `data/backups` (override `BACKUP_DIR`). Admin Settings displays last successful backup or a failure. These local same-disk snapshots are not disaster recovery: copy them to encrypted off-device storage. `npm run backup` creates a snapshot manually. An administrator can also download a transactionally consistent SQLite snapshot from Settings. Verify it on an isolated machine and store encrypted copies outside this server. For restore, first stop **all** running clinic server processes, then:

```sh
node scripts/restore.js /secure/path/yawar-backup.sqlite --server-stopped
npm start
```

The tool validates integrity and required tables, preserves the previous database in a `.before-restore-*` recovery file, and invalidates backed-up sessions. It never starts/stops servers itself: `--server-stopped` is your explicit assertion that no process has the DB open. `DATA_DIR` selects the restore destination. Recovery files contain sensitive information too. Test restoration before relying on backups.

## Validation

`npm test` creates an isolated temporary database and exercises initial setup, login, CSRF/origin rejection, role restrictions, patient updates, treatment validation, overpayment rejection, appointment conflicts/cancellation, prescriptions, expenses, stock, file validation/download, clinic settings, backup integrity, user deactivation, password changes and persistence after restart. No real patient records are used.

## Operational checks

`GET /healthz` checks database reachability without exposing clinic records. The process handles SIGTERM/SIGINT gracefully. On Windows keep the server window open; prevent sleep during clinic hours. For optional LAN use, see the Caddy private-CA configuration and Windows guide. Do not bypass browser certificate warnings. No cloud deployment or actual Windows installation has been performed from this Linux workspace.

Launcher recovery tests run the embedded PowerShell script against fixture archives, paths containing spaces/apostrophes, complete extracted folders, ZIP-only startup, offline cache reuse, custom data paths and damaged archives. Set `POWERSHELL_BIN` to a PowerShell executable to include them in `npm test`; otherwise the PowerShell-dependent group is explicitly skipped. These are script tests, not a claim of testing Windows Explorer itself.

## v3 workflow changes

Patients have an editable registration date defaulting to the local current day; existing records are backfilled from their original creation date. New treatments also default to the local date if the API caller omits it. Registration dates and creation timestamps remain distinct. The FDI chart separates upper/lower arches, patient left/right, permanent/primary dentition and planned/completed record indicators; no record is a diagnosis of a healthy tooth. Admins can edit names, usernames, roles and activation. Changing role/username/activation invalidates existing sessions. The last active administrator cannot be demoted or deactivated.
