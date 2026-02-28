const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = 3000;
const NODES_DIR = path.join(__dirname, '..', 'nodes');
const SERVERS_FILE = path.join(__dirname, 'servers.json');
const SSH_FILE = path.join(__dirname, 'ssh-connections.json');

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

// ── Helpers ──
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    });
}

function json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function loadJSON(file) {
    if (!fs.existsSync(file)) return [];
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
    const pathname = req.url.split('?')[0];

    if (pathname.startsWith('/api/')) {
        await handleAPI(req, res, pathname);
        return;
    }

    const filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    fs.readFile(filePath, (err, content) => {
        if (err) { res.writeHead(404); res.end('404'); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        res.end(content);
    });
});

// ── WebSocket Server (terminal SSH) ──
const wss = new WebSocketServer({ server, path: '/ssh/terminal' });

wss.on('connection', ws => {
    let ptyProcess = null;

    ws.on('message', raw => {
        const msg = JSON.parse(raw);

        if (msg.type === 'connect') {
            const { host, port, user, password } = msg;
            const sshArgs = ['-tt', '-p', port || '22', '-o', 'StrictHostKeyChecking=no', `${user}@${host}`];
            const spawnCmd = password ? 'sshpass' : 'ssh';
            const spawnArgs = password ? ['-p', password, 'ssh', ...sshArgs] : sshArgs;

            try {
                ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
                    name: 'xterm-256color',
                    cols: msg.cols || 120,
                    rows: msg.rows || 30,
                    env: process.env,
                });

                ptyProcess.onData(data => {
                    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'output', data }));
                });

                ptyProcess.onExit(() => {
                    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'close' }));
                });
            } catch (e) {
                ws.send(JSON.stringify({ type: 'error', data: e.message }));
            }
        }

        if (msg.type === 'input' && ptyProcess) {
            ptyProcess.write(msg.data);
        }

        if (msg.type === 'resize' && ptyProcess) {
            ptyProcess.resize(msg.cols, msg.rows);
        }
    });

    ws.on('close', () => {
        if (ptyProcess) { ptyProcess.kill(); ptyProcess = null; }
    });
});

// ── API ──
async function handleAPI(req, res, pathname) {
    const parts = pathname.split('/').filter(Boolean);

    // ── Nodes ──
    if (pathname === '/api/nodes/custom' && req.method === 'GET') {
        const nodes = fs.readdirSync(NODES_DIR).filter(d => fs.statSync(path.join(NODES_DIR, d)).isDirectory());
        return json(res, 200, nodes);
    }

    if (parts[1] === 'nodes' && parts[2] && parts[2] !== 'custom' && parts[2] !== 'save' && req.method === 'GET') {
        const file = path.join(NODES_DIR, parts[2], `${parts[2]}.node.ts`);
        if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
        return json(res, 200, parseNode(fs.readFileSync(file, 'utf8')));
    }

    if (pathname === '/api/nodes/save' && req.method === 'POST') {
        try {
            const { nodeData, code } = await readBody(req);
            const dir = path.join(NODES_DIR, nodeData.name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${nodeData.name}.node.ts`), code);
            fs.writeFileSync(path.join(dir, `${nodeData.name}.node.json`), JSON.stringify({
                node: `n8n-nodes-${nodeData.name.toLowerCase()}`,
                nodeVersion: '1.0', codexVersion: '1.0',
                categories: ['Development'],
                resources: { primaryDocumentation: [{ url: '' }] }
            }, null, '\t'));
            return json(res, 200, { success: true });
        } catch (e) { return json(res, 500, { error: e.message }); }
    }

    // ── Servers ──
    if (pathname === '/api/servers' && req.method === 'GET') return json(res, 200, loadJSON(SERVERS_FILE));

    if (pathname === '/api/servers/test' && req.method === 'POST') {
        try {
            const { host } = await readBody(req);
            // Hacer un fetch real a la URL del servidor n8n
            const testUrl = host.startsWith('http') ? host : `https://${host}`;
            const result = await fetch(testUrl, { signal: AbortSignal.timeout(5000) });
            return json(res, 200, { success: true });
        } catch (e) {
            return json(res, 200, { success: false, error: `No se pudo conectar: ${e.message}` });
        }
    }

    if (pathname === '/api/servers/save' && req.method === 'POST') {
        try {
            const srv = await readBody(req);
            const servers = loadJSON(SERVERS_FILE);
            const idx = servers.findIndex(s => s.id === srv.id);
            if (idx >= 0) servers[idx] = srv; else servers.push(srv);
            saveJSON(SERVERS_FILE, servers);
            return json(res, 200, { success: true });
        } catch (e) { return json(res, 500, { error: e.message }); }
    }

    if (parts[1] === 'servers' && parts[2] && req.method === 'DELETE') {
        saveJSON(SERVERS_FILE, loadJSON(SERVERS_FILE).filter(s => s.id !== parts[2]));
        return json(res, 200, { success: true });
    }

    // ── SSH Connections ──
    if (pathname === '/api/ssh/connections' && req.method === 'GET') return json(res, 200, loadJSON(SSH_FILE));

    if (pathname === '/api/ssh/save' && req.method === 'POST') {
        try {
            const conn = await readBody(req);
            const conns = loadJSON(SSH_FILE);
            const idx = conns.findIndex(c => c.id === conn.id);
            if (idx >= 0) conns[idx] = conn; else conns.push(conn);
            saveJSON(SSH_FILE, conns);
            return json(res, 200, { success: true });
        } catch (e) { return json(res, 500, { error: e.message }); }
    }

    if (parts[1] === 'ssh' && parts[2] && parts[2] !== 'connections' && parts[2] !== 'save' && req.method === 'DELETE') {
        saveJSON(SSH_FILE, loadJSON(SSH_FILE).filter(c => c.id !== parts[2]));
        return json(res, 200, { success: true });
    }

    // ── Deploy ──
    if (pathname === '/api/deploy' && req.method === 'POST') {
        try {
            const { nodes, serverId } = await readBody(req);
            const srv = loadJSON(SERVERS_FILE).find(s => s.id === serverId);
            if (!srv) return json(res, 404, { error: 'Servidor no encontrado' });

            let output = '';
            if (!srv.isRemote) {
                const targetDir = path.join(srv.path, 'nodes');
                for (const name of nodes) {
                    const src = path.join(NODES_DIR, name);
                    const dst = path.join(targetDir, name);
                    if (src !== dst) { copyDirSync(src, dst); }
                    output += `✓ Copiado: ${name}\n`;
                }
                output += '\nEjecutando npm run build...\n';
                output += execSync('npm run build', { cwd: srv.path, encoding: 'utf8' });
            } else {
                const keyFlag = srv.sshKey ? `-i ${srv.sshKey.replace('~', process.env.HOME)}` : '';
                const target = `${srv.sshUser}@${srv.host}`;
                const port = srv.sshPort || '22';
                for (const name of nodes) {
                    execSync(`scp -r -P ${port} ${keyFlag} ${path.join(NODES_DIR, name)} ${target}:${srv.path}/nodes/`, { encoding: 'utf8' });
                    output += `✓ Copiado: ${name}\n`;
                }
                output += '\nEjecutando npm run build...\n';
                output += execSync(`ssh -p ${port} ${keyFlag} ${target} "cd ${srv.path} && npm run build"`, { encoding: 'utf8' });
            }
            return json(res, 200, { success: true, output });
        } catch (e) { return json(res, 200, { success: false, error: e.message, output: e.stdout || '' }); }
    }

    json(res, 404, { error: 'Not found' });
}

function copyDirSync(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).forEach(f => {
        const s = path.join(src, f), d = path.join(dst, f);
        fs.statSync(s).isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
    });
}

function parseNode(content) {
    const get = rx => content.match(rx)?.[1] || '';
    return {
        displayName: get(/displayName:\s*['"]([^'"]+)['"]/),
        name: get(/name:\s*['"]([^'"]+)['"]/),
        description: get(/description:\s*['"]([^'"]+)['"]/),
        category: 'input', properties: [], operations: [],
    };
}

server.listen(PORT, () => console.log(`\n🚀 n8n Node Builder → http://localhost:${PORT}\n`));
