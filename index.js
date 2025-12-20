const tls = require('tls');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

// --- INDEPENDENT ARGUMENT PARSER ---
const argsList = process.argv.slice(2);
function getFlagValue(flags, defaultValue) {
    for (let i = 0; i < argsList.length; i++) {
        if (flags.includes(argsList[i]) && argsList[i + 1]) {
            return argsList[i + 1];
        }
    }
    return defaultValue;
}

// 1. Resolve Mode first
const MODE = getFlagValue(['-s', '--mode'], 'shell').toLowerCase(); 

// 2. Resolve Paths based on Mode Defaults
const defaultCert = (MODE === 'db') ? 'server.crt' : 'client.crt';
const defaultKey = (MODE === 'db') ? 'server.key' : 'client.key';

// 3. Apply overrides from command line
const CA_FILE   = getFlagValue(['-ca', '--ca-cert'], 'ca.crt');
const CERT_FILE = getFlagValue(['-c', '--cert'], defaultCert);
const KEY_FILE  = getFlagValue(['-k', '--key', '--keys'], defaultKey);

const PORT = parseInt(getFlagValue(['-p', '--port'], '9999'), 10);
const HOST = getFlagValue(['-ip', '-h', '--host'], MODE === 'db' ? '0.0.0.0' : 'localhost');

// --- PRE-FLIGHT SECURITY CHECK ---
const checkPath = (label, p) => {
    const absolutePath = path.resolve(process.cwd(), p);
    if (!fs.existsSync(absolutePath)) {
        console.error(`\x1b[31m[ERROR]\x1b[0m ${label} not found at: ${absolutePath}`);
        return false;
    }
    return true;
};

const ok = checkPath("CA Cert", CA_FILE) && checkPath("Cert", CERT_FILE) && checkPath("Key", KEY_FILE);

if (!ok) {
    process.exit(1);
}

// --- SERVER (DB) MODE ---
if (MODE === 'db') {
    const DB_PATH = getFlagValue(['-df', '--dump-file'], null) || getFlagValue(['-l', '--load'], path.join(__dirname, 'data.sqlite'));
    const LOG_PREFIX = getFlagValue(['-lp', '--log-prefix'], DB_PATH);
    const LOG_PATH = LOG_PREFIX + ".log";
    const DT_RAW = getFlagValue(['-dt'], '60s');

    // Enhanced Logging Utility: [Timestamp] [IP:PORT] [Category] [Command] [Status] "Details"
    const logger = (socket, event, cmd, status, message) => {
        const timestamp = new Date().toISOString();
        const ip = socket ? (socket.remoteAddress || "127.0.0.1") : "127.0.0.1";
        const port = socket ? (socket.remotePort || "0000") : "0000";
        const clientInfo = `${ip}:${port}`;
        const cleanMsg = String(message).replace(/"/g, "'").replace(/\n/g, " ");
        const logEntry = `[${timestamp}] [${clientInfo}] [${event.toUpperCase()}] [${cmd.toUpperCase()}] [${status}] "${cleanMsg}"\n`;
        try { fs.appendFileSync(LOG_PATH, logEntry); } catch (e) {}
        console.log(logEntry.trim());
    };

    function parseDuration(str) {
        const regex = /(-?\d+)([hms])/g;
        let totalSeconds = 0, match, found = false;
        while ((match = regex.exec(str)) !== null) {
            found = true;
            const value = parseInt(match[1], 10);
            const unit = match[2];
            if (unit === 'h') totalSeconds += value * 3600;
            if (unit === 'm') totalSeconds += value * 60;
            if (unit === 's') totalSeconds += value;
        }
        return found ? totalSeconds : (parseInt(str, 10) || 60);
    }

    let globalLock = false;
    let isShuttingDown = false;
    const commandQueue = [];

    function processQueue() {
        if (globalLock || commandQueue.length === 0 || isShuttingDown) return;
        const task = commandQueue.shift();
        executeCommand(task.cmd, task.args, task.socket);
    }

    const memDb = new sqlite3.Database(':memory:');
    let currentTable = 'store';

    memDb.serialize(() => {
        memDb.run(`CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT)`);
        if (fs.existsSync(DB_PATH)) {
            memDb.run(`ATTACH DATABASE '${DB_PATH}' AS disk`, (err) => {
                if (!err) {
                    memDb.all("SELECT name FROM disk.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", (e, tables) => {
                        if (!e) tables.forEach(t => {
                            memDb.run(`CREATE TABLE IF NOT EXISTS main.${t.name} (key TEXT PRIMARY KEY, value TEXT)`);
                            memDb.run(`INSERT OR IGNORE INTO main.${t.name} SELECT * FROM disk.${t.name}`);
                        });
                        memDb.run(`DETACH DATABASE disk`, () => logger(null, "SYSTEM", "BOOT_SYNC", "SUCCESS", `Loaded ${path.basename(DB_PATH)}`));
                    });
                }
            });
        }
    });

    const persistToDisk = (targetPath = DB_PATH, socket = null, cmd = 'auto-sync', callback = null) => {
        if (!memDb || isShuttingDown) { if (callback) callback(new Error("Database unavailable")); return; }
        memDb.serialize(() => {
            if (fs.existsSync(targetPath)) { try { fs.unlinkSync(targetPath); } catch(e) {} }
            memDb.run(`VACUUM INTO '${targetPath}'`, (err) => {
                const status = err ? "ERROR" : "SUCCESS";
                const msg = err ? err.message : `Dumped to ${path.basename(targetPath)}`;
                logger(socket, "SYNC", cmd, status, msg);
                if (socket) sendJson(socket, { status, command: cmd, message: msg });
                if (callback) callback(err);
            });
        });
    };

    const autoSyncInterval = setInterval(() => { if(!isShuttingDown) persistToDisk(); }, parseDuration(DT_RAW) * 1000);

    const server = tls.createServer({
        key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE), ca: fs.readFileSync(CA_FILE),
        requestCert: true, rejectUnauthorized: true
    }, (socket) => {
        logger(socket, "NETWORK", "TLS_CONNECT", "INFO", "Handshake successful");
        socket.cursor = { results: [], limit: 0, index: 0, total: 0 };
        socket.on('data', (data) => {
            try {
                const req = JSON.parse(data.toString());
                commandQueue.push({ cmd: req.cmd, args: req.args || {}, socket });
                processQueue();
            } catch (e) { sendJson(socket, { status: "error", message: "Malformed JSON" }); }
        });
        socket.on('end', () => logger(socket, "NETWORK", "DISCONNECT", "INFO", "Connection closed"));
        socket.on('error', () => {});
    });

    function sendJson(socket, obj) {
        if (socket && !socket.destroyed && socket.writable) socket.write(JSON.stringify(obj) + '\n');
    }

    function executeCommand(cmd, args, socket) {
        const command = cmd ? cmd.toLowerCase() : '';
        const writeCmds = ['set', 'delete', 'clear', 'init', 'load', 'sql', 'use', 'drop'];
        if (writeCmds.includes(command)) globalLock = true;

        const finalize = (err, result) => {
            const status = err ? "ERROR" : "SUCCESS";
            logger(socket, "COMMAND", command, status, `Context: ${currentTable}${args.k ? ' | Target: '+args.k : ''}`);
            if (err) sendJson(socket, { status: "error", command, message: err.message });
            else sendJson(socket, { status: "success", command, data: result || [] });
            globalLock = false; 
            processQueue();
        };

        if (command === 'next' && socket.cursor.results.length > 0) return sendCursorBatch(socket, finalize);

        const q = `%${args.q}%`;
        try {
            switch (command) {
                case 'use':
                    const tableToUse = (args.k || 'store').replace(/[^a-z0-9_]/gi, '');
                    memDb.run(`CREATE TABLE IF NOT EXISTS ${tableToUse} (key TEXT PRIMARY KEY, value TEXT)`, (err) => {
                        if (!err) currentTable = tableToUse;
                        finalize(err, `Active table: ${tableToUse}`);
                    });
                    break;
                case 'drop':
                    const tableToDrop = (args.k || '').replace(/[^a-z0-9_]/gi, '');
                    if (!tableToDrop || tableToDrop === 'store') return finalize(new Error("Cannot drop default store"));
                    memDb.run(`DROP TABLE IF EXISTS ${tableToDrop}`, (err) => {
                        if (!err && currentTable === tableToDrop) currentTable = 'store';
                        finalize(err, `Dropped table: ${tableToDrop}`);
                    });
                    break;
                case 'set': memDb.run(`INSERT OR REPLACE INTO ${currentTable} (key, value) VALUES (?, ?)`, [args.k, args.v], (err) => finalize(err, "OK")); break;
                case 'get': memDb.get(`SELECT value FROM ${currentTable} WHERE key = ?`, [args.k], finalize); break;
                case 'delete': memDb.run(`DELETE FROM ${currentTable} WHERE key = ?`, [args.k], (err) => finalize(err, "Deleted")); break;
                case 'clear': memDb.run(`DELETE FROM ${currentTable}`, (err) => finalize(err, `Cleared ${currentTable}`)); break;
                case 'tables': memDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", (err, rows) => finalize(err, rows)); break;
                case 'search': memDb.all(`SELECT * FROM ${currentTable} WHERE key LIKE ? OR value LIKE ?`, [q, q], finalize); break;
                case 'searchkey': memDb.all(`SELECT * FROM ${currentTable} WHERE key LIKE ?`, [q], finalize); break;
                case 'searchvalue': memDb.all(`SELECT * FROM ${currentTable} WHERE value LIKE ?`, [q], finalize); break;
                case 'init':
                    try {
                        let data = args.f && fs.existsSync(args.f) ? JSON.parse(fs.readFileSync(args.f)) : (args.data ? JSON.parse(args.data) : null);
                        memDb.serialize(() => {
                            memDb.run(`DELETE FROM ${currentTable}`);
                            const stmt = memDb.prepare(`INSERT INTO ${currentTable} (key, value) VALUES (?, ?)`);
                            for (const [k, v] of Object.entries(data)) stmt.run(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
                            stmt.finalize(() => finalize(null, "Initialized"));
                        });
                    } catch(e) { finalize(e); }
                    break;
                case 'load':
                    if (args.f && fs.existsSync(args.f)) {
                        const jData = JSON.parse(fs.readFileSync(args.f));
                        memDb.serialize(() => {
                            const stmt = memDb.prepare(`INSERT OR REPLACE INTO ${currentTable} (key, value) VALUES (?, ?)`);
                            for (const [k, v] of Object.entries(jData)) stmt.run(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
                            stmt.finalize(() => finalize(null, "Loaded"));
                        });
                    } else finalize(new Error("File error"));
                    break;
                case 'list':
                    memDb.all(`SELECT * FROM ${currentTable}`, (err, rows) => {
                        if (args.n && !err) {
                            socket.cursor = { results: rows, limit: parseInt(args.n), index: 0, total: rows.length };
                            return sendCursorBatch(socket, finalize);
                        }
                        finalize(err, rows);
                    });
                    break;
                case 'dump': persistToDisk(DB_PATH, socket, 'dump'); finalize(null, "Sync triggered"); break;
                case 'sql': memDb.all(args.sql, [], finalize); break;
                default: globalLock = false; finalize(new Error("Unknown command"));
            }
        } catch (err) { finalize(err); }
    }

    function sendCursorBatch(socket, finalize) {
        const { results, limit, index, total } = socket.cursor;
        const batch = results.slice(index, index + limit);
        socket.cursor.index += batch.length;
        const hasMore = socket.cursor.index < total;
        sendJson(socket, { status: "success", command: "list", data: batch, pagination: { progress: `${socket.cursor.index}/${total}`, hasMore } });
        if (!hasMore) socket.cursor = { results: [], limit: 0, index: 0, total: 0 };
        globalLock = false; processQueue();
    }

    const handleShutdown = (type) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        clearInterval(autoSyncInterval);
        console.log(`\n[SHUTDOWN] Signal: ${type}. Saving state...`);
        const forceExit = setTimeout(() => { process.exit(1); }, 4000);
        persistToDisk(DB_PATH, null, 'shutdown-sync', (err) => {
            clearTimeout(forceExit);
            if (memDb && memDb.close) {
                memDb.close(() => { process.exit(err ? 1 : 0); });
            } else {
                process.exit(err ? 1 : 0);
            }
        });
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
        logger(null, "SYSTEM", "CRASH", "FATAL", err.stack || err.message);
        if (!err.message.includes('SQLITE_ERROR')) handleShutdown('CRASH');
        else { globalLock = false; processQueue(); }
    });

    server.listen(PORT, HOST, () => logger(null, "SYSTEM", "STARTUP", "SUCCESS", `Active on ${HOST}:${PORT}`));

} else if (MODE === 'shell') {
    // --- FULL SHELL (CLIENT) MODE ---
    let cursorActive = false, pendingCommand = null;
    const client = tls.connect(PORT, HOST, {
        key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE), ca: fs.readFileSync(CA_FILE),
        rejectUnauthorized: true
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const getPrompt = () => `${os.userInfo().username}@${HOST}:${PORT}> `;

    client.on('connect', () => { 
        console.log(JSON.stringify({ event: "connected", mode: "shell", host: HOST, port: PORT })); 
        rl.setPrompt(getPrompt()); rl.prompt(); 
    });

    client.on('data', (data) => {
        data.toString().trim().split('\n').forEach(line => {
            if (!line) return;
            try {
                const res = JSON.parse(line);
                console.log(JSON.stringify(res, null, 2));
                cursorActive = res.pagination ? res.pagination.hasMore : false;
            } catch (e) { console.log("Raw Server Response:", line); }
        });
        rl.setPrompt(getPrompt()); rl.prompt();
    });

    rl.on('line', (line) => {
        const input = line.trim().toLowerCase();
        if (input === 'exit' || input === 'quit') process.exit(0);

        if (pendingCommand) {
            if (input === 'y' || input === 'yes') client.write(pendingCommand);
            else console.log("Action cancelled.");
            pendingCommand = null; rl.setPrompt(getPrompt()); rl.prompt(); return;
        }

        if (!input && cursorActive) return client.write(JSON.stringify({ cmd: "next" }));
        if (!input) return rl.prompt();

        const parts = line.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();
        
        // Advanced Argument Extractors
        const findArg = (flag) => { const idx = parts.indexOf(flag); return idx !== -1 ? parts[idx + 1] : null; };
        const cmdData = (line.match(/-cmd\s+`([^`]+)`/) || [])[1];

        const payload = JSON.stringify({
            cmd, args: {
                k: parts[1], 
                v: parts[2], 
                q: parts[1], 
                f: findArg('-f'),
                n: findArg('-n'), 
                sql: (cmd === 'sql') ? cmdData : null,
                data: (cmd === 'init') ? cmdData : null
            }
        });

        // Danger Zone Protections
        if (['clear', 'drop', 'init'].includes(cmd)) {
            pendingCommand = payload;
            rl.setPrompt(`\x1b[31m[DANGER]\x1b[0m Confirm ${cmd} ${parts[1] || ''}? (y/N): `); rl.prompt();
        } else {
            client.write(payload);
        }
    });

    client.on('error', (err) => { console.error("Connection Error:", err.message); process.exit(1); });
}