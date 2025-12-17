const tls = require('tls');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// --- COMMAND LINE ARGUMENT PARSING ---
const args = process.argv.slice(2);
const getArg = (flags, defaultValue) => {
    for (let flag of flags) {
        const index = args.indexOf(flag);
        if (index !== -1 && args[index + 1]) return args[index + 1];
    }
    return defaultValue;
};

const config = {
    ip: getArg(['-ip', '-h', '--host'], '127.0.0.1'),
    port: parseInt(getArg(['-p', '--port'], '9999'), 10),
    ca: getArg(['-ca', '--ca-cert'], 'ca.crt'),
    cert: getArg(['-c', '--cert'], 'server.crt'),
    key: getArg(['-k', '--key'], 'server.key'),
    dt: parseInt(getArg(['-dt'], '60'), 10)
};

const DB_PATH = path.join(__dirname, 'data.sqlite');
const memDb = new sqlite3.Database(':memory:');

// --- DATABASE INITIALIZATION ---
memDb.serialize(() => {
    memDb.run("CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT)");
    if (fs.existsSync(DB_PATH)) {
        memDb.run(`ATTACH DATABASE '${DB_PATH}' AS disk`, (err) => {
            if (!err) {
                memDb.run(`INSERT OR IGNORE INTO main.store SELECT * FROM disk.store`, () => {
                    memDb.run(`DETACH DATABASE disk`);
                });
            }
        });
    }
});

const persistToDisk = (targetPath = DB_PATH, socket = null, cmd = 'auto-sync') => {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    memDb.run(`VACUUM INTO '${targetPath}'`, (err) => {
        if (socket) sendJson(socket, { status: err ? "error" : "success", command: cmd, message: err ? err.message : `Persisted to ${path.basename(targetPath)}` });
    });
};

const server = tls.createServer({
    key: fs.readFileSync(config.key),
    cert: fs.readFileSync(config.cert),
    ca: fs.readFileSync(config.ca),
    requestCert: true,
    rejectUnauthorized: true
}, (socket) => {
    // Session state for pagination
    socket.cursor = { results: [], limit: 0, index: 0 };

    socket.on('data', (data) => {
        try {
            const req = JSON.parse(data.toString());
            executeCommand(req.cmd, req.args || {}, socket);
        } catch (e) {
            sendJson(socket, { status: "error", message: "Invalid JSON" });
        }
    });
});

function sendJson(socket, obj) {
    if (socket.writable) socket.write(JSON.stringify(obj) + '\n');
}

function executeCommand(cmd, args, socket) {
    const command = cmd ? cmd.toLowerCase() : '';
    
    // Logic for "NEXT" (Enter key on client sends cmd: 'next')
    if (command === 'next' && socket.cursor.results.length > 0) {
        return sendCursorBatch(socket);
    }

    const callback = (err, result) => {
        if (err) return sendJson(socket, { status: "error", command, message: err.message });
        
        // Handle List with --number / -n
        if (command === 'list' && args.n) {
            socket.cursor = {
                results: result || [],
                limit: parseInt(args.n, 10),
                index: 0
            };
            return sendCursorBatch(socket);
        }

        const hasData = result !== undefined && result !== null && (Array.isArray(result) ? result.length > 0 : true);
        sendJson(socket, { status: "success", command, data: hasData ? result : "No data found" });
    };

    switch (command) {
        case 'set': memDb.run("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)", [args.k, args.v], (err) => callback(err)); break;
        case 'get': memDb.get("SELECT value FROM store WHERE key = ?", [args.k], callback); break;
        case 'search': memDb.all("SELECT * FROM store WHERE key LIKE ? OR value LIKE ?", [`%${args.q}%`, `%${args.q}%`], callback); break;
        case 'list': memDb.all("SELECT * FROM store", [], callback); break;
        case 'delete': memDb.run("DELETE FROM store WHERE key = ?", [args.k], (err) => callback(err)); break;
        case 'dump': persistToDisk(DB_PATH, socket, 'dump'); break;
        default: sendJson(socket, { status: "error", message: "Unknown command" });
    }
}

function sendCursorBatch(socket) {
    const { results, limit, index } = socket.cursor;
    const batch = results.slice(index, index + limit);
    const nextIndex = index + limit;
    
    socket.cursor.index = nextIndex;
    const hasMore = nextIndex < results.length;
    
    // Clear cursor if done
    if (!hasMore) socket.cursor = { results: [], limit: 0, index: 0 };

    sendJson(socket, { 
        status: "success", 
        command: "list", 
        data: batch.length > 0 ? batch : "No more data",
        cursor: hasMore ? { remaining: results.length - nextIndex } : null
    });
}

server.listen(config.port, config.ip);