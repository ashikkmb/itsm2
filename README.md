# IT Help Desk – Windows Setup Guide

Both the **server** and **client PCs** are Windows in this deployment. The server runs the app; client PCs just need a web browser (Chrome, Edge, or Firefox) — no installation needed on client machines.

---

## SERVER PC SETUP

### Step 1 — Install Node.js

Download the **LTS version** from:
```
https://nodejs.org
```

Run the installer. Accept defaults. Make sure "Add to PATH" is checked (it is by default).

Verify in Command Prompt:
```cmd
node --version
npm --version
```

### Step 2 — Extract the project

Extract `it-helpdesk-windows.zip` to a permanent location, e.g.:
```
C:\Apps\it-helpdesk
```

### Step 3 — Run setup

Double-click **SETUP.bat**

This installs all dependencies and builds the frontend. Takes 2-5 minutes.

### Step 4 — Allow firewall access

Right-click **CONFIGURE_FIREWALL.bat** → **Run as administrator**

This allows other PCs on your network to reach the app.

### Step 5 — Start the server

Double-click **START.bat**

You'll see:
```
Local:   http://localhost:3000
Network: http://192.168.x.x:3000
```

Keep this window open while the app is in use, or set up auto-start below.

---

## CLIENT PC SETUP

No installation needed — just open any browser and go to:
```
http://<server-ip>:3000
```

Example:
```
http://192.168.1.105:3000
```

### Optional — use a hostname instead of IP

On each client PC, edit the hosts file:

1. Open **Notepad as Administrator**
2. Open: `C:\Windows\System32\drivers\etc\hosts`
3. Add this line:
   ```
   192.168.1.105    itcms.local
   ```
4. Save

Now type `http://itcms.local:3000` instead of the IP.

---

## DEFAULT LOGIN CREDENTIALS

| Name | Email | Password | Role |
|---|---|---|---|
| IT Admin | admin@org.local | admin123 | Admin |
| Alice Johnson | alice@org.local | pass123 | User |
| Bob Smith | bob@org.local | pass123 | User |
| Carol White | carol@org.local | pass123 | User |
| David Kumar | david@org.local | pass123 | User |

**Change the admin password immediately via Manage Users → Reset.**

---

## AUTO-START ON SERVER BOOT (Recommended)

This makes the server start automatically every time the Windows machine boots — no need to manually run START.bat.

### Step 1 — Download NSSM

Get it from:
```
https://nssm.cc/download
```

Extract `nssm.exe` (from the `win64` folder) into your app folder, next to `INSTALL_SERVICE.bat`:
```
C:\Apps\it-helpdesk\nssm.exe
```

### Step 2 — Install the service

Right-click **INSTALL_SERVICE.bat** → **Run as administrator**

This registers "IT Help Desk" as a Windows Service that auto-starts on boot.

### Managing the service afterward

Open Command Prompt as Administrator in the app folder:
```cmd
nssm start ITHelpDesk
nssm stop ITHelpDesk
nssm restart ITHelpDesk
nssm remove ITHelpDesk confirm
```

Or use the Windows **Services** app (`services.msc`) — look for "IT Help Desk Complaint Management System".

---

## VIEWING LOGS (when running as a service)

Logs are saved to:
```
C:\Apps\it-helpdesk\logs\service-output.log
C:\Apps\it-helpdesk\logs\service-error.log
```

---

## BACKING UP THE DATABASE

The entire database is a single file:
```
C:\Apps\it-helpdesk\data\helpdesk.db
```

To back up, simply copy this file elsewhere (stop the service first for a clean copy, or just copy — SQLite in WAL mode handles this safely in most cases):

```cmd
copy C:\Apps\it-helpdesk\data\helpdesk.db C:\Backups\helpdesk-backup.db
```

### Automate daily backups with Task Scheduler

1. Open **Task Scheduler**
2. Create Task → Trigger: Daily at a set time
3. Action: Start a program
   - Program: `cmd.exe`
   - Arguments: `/c copy C:\Apps\it-helpdesk\data\helpdesk.db C:\Backups\helpdesk-%date:~-4,4%%date:~-10,2%%date:~-7,2%.db`

---

## CHANGING THE PORT

Edit `server\index.js`, find:
```js
const PORT = process.env.PORT || 3000;
```
Change `3000` to any other port (e.g. `8080`).

If using the NSSM service, also update it:
```cmd
nssm set ITHelpDesk AppParameters "server\index.js"
nssm set ITHelpDesk AppEnvironmentExtra PORT=8080
nssm restart ITHelpDesk
```

---

## TROUBLESHOOTING

**"Port already in use" error:**
```cmd
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Check Node.js is installed correctly:**
```cmd
where node
node --version
```

**npm install fails:**
Try clearing cache and retrying:
```cmd
npm cache clean --force
cd server
npm install
```

**Service won't start:**
Check the logs:
```
C:\Apps\it-helpdesk\logs\service-error.log
```

**Reset everything and reinstall:**
```cmd
rmdir /s /q server\node_modules
rmdir /s /q client\node_modules
SETUP.bat
```

---

## PROJECT STRUCTURE

```
it-helpdesk-windows\
├── SETUP.bat                  Run once to install everything
├── START.bat                  Start the server manually
├── INSTALL_SERVICE.bat        Install as auto-starting Windows Service
├── CONFIGURE_FIREWALL.bat     Allow network access (run as admin)
├── nssm.exe                   (you provide this - see Auto-Start section)
├── data\
│   └── helpdesk.db            SQLite database (auto-created)
├── logs\                      Service logs (auto-created)
├── server\
│   ├── index.js
│   ├── db.js
│   ├── sqlite-wrapper.js
│   ├── auth.js
│   └── routes\
│       ├── auth.js
│       ├── complaints.js
│       └── users.js
└── client\
    ├── src\
    └── dist\                  Built frontend (created by SETUP.bat)
```
