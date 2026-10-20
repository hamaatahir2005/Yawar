# Yawar Dental Clinic — Windows v4.0.0

[Download Yawar-Setup-v4.exe](https://github.com/hamaatahir2005/Yawar/raw/refs/heads/windows-downloads/Yawar-Setup-v4.exe)

Source commit: e2cf06c607d5b524c4764ff0db508c531bcf121b
Source: https://github.com/hamaatahir2005/Yawar/tree/e2cf06c607d5b524c4764ff0db508c531bcf121b
Kurdish upgrade guide: https://github.com/hamaatahir2005/Yawar/blob/main/deploy/WINDOWS-ckb.md

New: numbered R/L dental quadrants; multiple procedures per tooth; one-form patient + treatment entry; cash/debt; dated installment schedules, partial receipts and conversion of existing debts without duplicating records; 30-day remembered login across normal close/reopen when Remember me is selected.

BACK UP before upgrading and close all previous clinic/server windows. The existing selected data directory stays in place. Startup creates a private before-v4 recovery snapshot before upgrading an existing database. Choose existing clinic data from the Start menu if your data is in a different folder; do not create replacement patient records if the wrong folder was selected.

The installer includes the official checksum-verified Node.js runtime and creates desktop/start menu icons. Edge or Chrome and Windows x64 are required. Daily operation is offline. It is unsigned. Native Windows installer/Edge behavior has not been executed from this Linux workspace.

Validation: 17 passing regression/PowerShell tests on source and extracted installer, legacy snapshot and data migration checks, Chromium visit/cash/debt/installment/receipt tests, persistent-browser login across closing/reopening, and SHA256/NSIS integrity checks. No patient database is included.

SHA256: b6a66685b70cd45057ecc0b9a8f596fa044961f79df0a892a41b801f2ffd4e0e
