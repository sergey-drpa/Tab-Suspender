const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Parse command line args
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const PORT = portIndex !== -1 ? parseInt(args[portIndex + 1]) : 8080;
const useHttps = args.includes('--https');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
};

// Request handler
const requestHandler = (req, res) => {
    // Log request
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

    // Parse URL
    let filePath = req.url === '/' ? '/index.html' : req.url;

    // Remove query string
    filePath = filePath.split('?')[0];

    // Security: prevent directory traversal
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');

    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath);

    // Check if file exists
    fs.access(fullPath, fs.constants.F_OK, (err) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 Not Found</h1>');
            return;
        }

        // Read and serve file
        fs.readFile(fullPath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end('<h1>500 Internal Server Error</h1>');
                return;
            }

            const contentType = MIME_TYPES[ext] || 'application/octet-stream';

            // Add CORS headers for local testing
            res.writeHead(200, {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            });

            res.end(data);
        });
    });
};

// Create server (HTTP or HTTPS)
let server;
const protocol = useHttps ? 'https' : 'http';

if (useHttps) {
    // Generate self-signed certificate inline for development
    const { execSync } = require('child_process');
    const certDir = path.join(__dirname, '.certs');
    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');

    // Create certs directory if not exists
    if (!fs.existsSync(certDir)) {
        fs.mkdirSync(certDir);
    }

    // Generate self-signed certificate if not exists
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        console.log('Generating self-signed certificate...');
        try {
            execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`, {
                stdio: 'pipe'
            });
            console.log('Certificate generated successfully');
        } catch (e) {
            console.error('Failed to generate certificate. Make sure openssl is installed.');
            console.error('On macOS: brew install openssl');
            console.error('Or run without --https flag for HTTP server');
            process.exit(1);
        }
    }

    const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };

    server = https.createServer(options, requestHandler);
} else {
    server = http.createServer(requestHandler);
}

server.listen(PORT, () => {
    console.log('');
    console.log('='.repeat(50));
    console.log('  Tab Suspender Backup Server');
    console.log('='.repeat(50));
    console.log('');
    console.log(`  Server running at ${protocol}://localhost:${PORT}/`);
    if (useHttps) {
        console.log('  (Using self-signed certificate - accept in browser first)');
    }
    console.log('');
    console.log('  Pages:');
    console.log(`    - Recovery:  ${protocol}://localhost:${PORT}/`);
    console.log(`    - Sync:      ${protocol}://localhost:${PORT}/sync.html`);
    console.log('');
    console.log('  For testing with extension, update BACKUP_SYNC_ORIGIN');
    console.log(`  in offscreenDocument.ts to ${protocol}://localhost:${PORT}`);
    console.log('');
    console.log('='.repeat(50));
    console.log('');
});
