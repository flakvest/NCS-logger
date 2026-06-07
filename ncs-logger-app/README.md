# NCS Logger

NCS Logger is a local-first desktop logger for Army MARS net control station operations.

The first version stores logs as JSON in the Windows app data folder. Each saved log contains the net timing, checked-in stations, and message traffic with precedence tracked per message.

## Development

Install dependencies:

```powershell
npm install
```

Run the web development server:

```powershell
npm run dev
```

Run the desktop app:

```powershell
npm run tauri dev
```

Build the Windows installer and executable:

```powershell
npm run tauri build
```
