# Tab Suspender Backup Server

This folder contains files that need to be deployed to `uninstall.tab-suspender.com`.

## Files

### `sync.html`
Hidden iframe page that receives suspended tabs data from the extension via postMessage and stores it in localStorage.

**Deploy to:** `https://uninstall.tab-suspender.com/sync.html`

### `index.html`
Recovery page shown when user uninstalls the extension. Reads localStorage and displays all backed up suspended tabs with options to:
- Open all tabs
- Copy all URLs
- Export as HTML file
- Manual URL parser for browser history recovery

**Deploy to:** `https://uninstall.tab-suspender.com/` (root)

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXTENSION (offscreenDocument)                 │
│                                                                 │
│  Every 20 seconds:                                              │
│  1. Get list of all suspended tabs from background              │
│  2. Send via postMessage to iframe                              │
│                                                                 │
│  <iframe src="https://uninstall.tab-suspender.com/sync.html">      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    sync.html (on server)                         │
│                                                                 │
│  Receives postMessage:                                          │
│  { type: 'SYNC_TABS', tabs: [...], timestamp: ... }             │
│                                                                 │
│  Saves to localStorage:                                         │
│  localStorage.setItem('ts_suspended_tabs', JSON.stringify({     │
│    tabs: [...],                                                 │
│    lastSync: timestamp                                          │
│  }))                                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │  (User uninstalls extension)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    index.html (recovery page)                    │
│                                                                 │
│  Reads localStorage on same domain                              │
│  Shows list of all suspended tabs                               │
│  Allows user to recover their tabs                              │
└─────────────────────────────────────────────────────────────────┘
```

## Deployment Requirements

1. HTTPS required (for postMessage security)
2. Same domain for sync.html and index.html (for localStorage access)
3. Static hosting is sufficient (Firebase Hosting, GitHub Pages, Netlify, etc.)

## CORS / Security

- `sync.html` validates postMessage origin starts with `chrome-extension://`
- No server-side code required
- All data stored in browser localStorage (no server database)

## Deployment to Firebase Hosting

### Initial Setup

1. **Install Firebase CLI** (if not already installed):
   ```bash
   npm install -g firebase-tools
   ```

2. **Login to Firebase**:
   ```bash
   firebase login
   ```

3. **Create Firebase Project**:
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project named `tab-suspender-backup` (or choose your own name)
   - Enable Firebase Hosting

4. **Update Firebase Project ID**:
   - Edit `.firebaserc` and set your project ID:
   ```json
   {
     "projects": {
       "default": "your-project-id"
     }
   }
   ```

### Deploy

```bash
cd backup-server
npm install              # Install firebase-tools
npm run deploy          # Deploy to Firebase Hosting
```

Or deploy manually:
```bash
firebase deploy --only hosting
```

### Preview Before Deploy

Test your deployment on a temporary URL:
```bash
npm run deploy:preview
```

### Custom Domain Setup

After deployment, configure custom domain in Firebase Console:
1. Go to Firebase Console → Hosting
2. Click "Add custom domain"
3. Enter `uninstall.tab-suspender.com`
4. Follow DNS configuration instructions
5. Wait for SSL certificate provisioning (automatic)

### Update Extension

After deploying to production domain, update extension code:

In `offscreenDocument.ts`:
```typescript
const BACKUP_SYNC_ORIGIN = 'https://uninstall.tab-suspender.com';
```

In `offscreenDocument.html`:
```html
<iframe id="backupSyncFrame"
        src="https://uninstall.tab-suspender.com/sync.html"
        ...>
```

## Testing Locally

### Start local server:

```bash
cd backup-server
npm start          # Starts on port 8080
# or
npm run dev        # Starts on port 3000
# or
node server.js --port 9000  # Custom port
```

### Configure extension for local testing:

1. In `offscreenDocument.ts`, change:
   ```typescript
   const BACKUP_SYNC_ORIGIN = 'http://localhost:8080';
   ```

2. In `offscreenDocument.html`, change iframe src:
   ```html
   <iframe id="backupSyncFrame"
           src="http://localhost:8080/sync.html"
           ...>
   ```

3. Rebuild extension: `npm run build`

4. Reload extension in Chrome

### Test flow:

1. Open Chrome with the extension loaded
2. Suspend some tabs
3. Check server console - should see sync requests every 20 seconds
4. Open `http://localhost:8080/` - should see backed up tabs
5. Test uninstall scenario by removing extension
