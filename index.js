'use strict';

const fs = require("fs");
const path = require("path");
const tls = require("tls");
const readline = require("readline");

/**
 * SECTION 1: YOUR CORE LOGIC (From index.js)
 * Using your exact JsonManager factory function.
 */
function JsonManager() {
    var data = {};
    var flag = false;
    var eventPause = [];

    function hasKey(key) { return !!data.hasOwnProperty(key) || !!data[key]; }
    function getKey(key) { return (!!hasKey(key)) ? data[key] : undefined; }

    function set(key, value) {
        if (flag === false) {
            flag = true;
            data[key] = value;
            flag = false;
            return "OK";
        } else {
            eventPause.push({ event: "set", key, value });
            return "LOCKED_QUEUED";
        }
    }

    function deleteKey(key) {
        if (flag === false) {
            flag = true;
            const res = delete data[key];
            flag = false;
            return res;
        }
        return "LOCKED";
    }

    function isMatch(term, criteria, options) {
        const termStr = String(term).toLowerCase();
        const criteriaStr = String(criteria).toLowerCase();
        if (options.regex) {
            try { return new RegExp(criteria, 'i').test(String(term)); } catch (e) { return false; }
        }
        return options.like ? termStr.includes(criteriaStr) : termStr === criteriaStr;
    }

    function searchKeyValues(criteria, options = { like: true, regex: false }) {
        const results = [];
        for (const [key, value] of Object.entries(data)) {
            if (isMatch(key, criteria, options) || isMatch(value, criteria, options)) {
                results.push({ key, value });
            }
        }
        return results;
    }

    function load(obj = {}) {
        if (flag === false) {
            flag = true;
            data = { ...data, ...obj };
            flag = false;
            return "OK";
        }
        return "LOCKED";
    }

    return {
        set, getKey, get: getKey, deleteKey, 
        init: (obj) => { data = obj; return "OK"; },
        load, search: searchKeyValues,
        dump: () => ({ ...data })
    };
}

/**
 * SECTION 2: CONFIGURATION & PREFIXES (From README.md)
 */
const prefixDefs = [
    { prefixes: ['-ip', '-h', '--host'], key: 'ip', default: '127.0.0.1' },
    { prefixes: ['-p', '--port'], key: 'port', default: 9999, type: 'number' },
    { prefixes: ['-s', '--mode'], key: 'mode', default: 'server' },
    { prefixes: ['-ca', '--ca-cert'], key: 'caCert', default: 'ca.crt' },
    { prefixes: ['-c', '--cert'], key: 'cert', default: 'server.crt' },
    { prefixes: ['-k', '--key'], key: 'key', default: 'server.key' },
    { prefixes: ['--dump-file'], key: 'dumpFile', default: 'store_dump.json' },
    { prefixes: ['--users-file'], key: 'usersFile', default: 'users.json' }
];

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {};
    prefixDefs.forEach(d => {
        config[d.key] = d.default;
        for (let i = 0; i < args.length; i++) {
            if (d.prefixes.includes(args[i])) {
                config[d.key] = (d.type === 'number') ? parseInt(args[i+1]) : args[i+1];
            }
        }
    });
    return config;
}

const globalConfig = parseArgs();
const dataStore = JsonManager(); // Main database
const userStore = JsonManager(); // Auth database
const activeSessions = new Map();

/**
 * SECTION 3: COMMAND ROUTER & MTLS LOGIC
 */
async function handleRequest(raw, socket) {
    try {
        const { command, args = [] } = JSON.parse(raw);
        const cert = socket.getPeerCertificate();
        const cn = cert && cert.subject ? cert.subject.CN : socket.remoteAddress;

        const cmd = command.toLowerCase();

        // 1. Auth Bypass for Login
        if (cmd === 'login') {
            const [user, pass] = args;
            const userData = userStore.get(user); // Calls getKey
            if (userData && userData.password === pass) {
                activeSessions.set(cn, { user });
                return { status: "OK", message: `Logged in as ${user}` };
            }
            return { status: "ERROR", message: "Invalid credentials" };
        }

        // 2. Authorization Check
        if (!activeSessions.has(cn)) {
            return { status: "ERROR", message: "Unauthorized. Please login." };
        }

        // 3. Command Mapping to your JsonManager
        const mapping = {
            'get': 'getKey',
            'set': 'set',
            'delete': 'deleteKey',
            'search': 'search',
            'load': 'load'
        };

        const target = mapping[cmd] || cmd;

        if (typeof dataStore[target] === 'function') {
            const result = dataStore[target](...args);
            
            // Fix: Check for undefined return from getKey
            if (result === undefined && target === 'getKey') {
                return { status: "NOT_FOUND", message: `Key "${args[0]}" does not exist.` };
            }
            
            return { status: "OK", result };
        }
        return { status: "ERROR", message: `Unknown command: ${command}` };
    } catch (e) { return { status: "ERROR", message: e.message }; }
}

/**
 * SECTION 4: SERVER / CLIENT STARTUP
 */
function startServer() {
    const options = {
        key: fs.readFileSync(globalConfig.key),
        cert: fs.readFileSync(globalConfig.cert),
        ca: fs.readFileSync(globalConfig.caCert),
        requestCert: true, rejectUnauthorized: true
    };

    tls.createServer(options, (socket) => {
        socket.on('data', (d) => {
            handleRequest(d.toString(), socket).then(res => socket.write(JSON.stringify(res) + '\n'));
        });
    }).listen(globalConfig.port, globalConfig.ip, () => {
        console.log(`[SERVER] ${globalConfig.ip}:${globalConfig.port} | Users: ${globalConfig.usersFile}`);
    });
}

function startShell() {
    const opts = { ca: fs.readFileSync(globalConfig.caCert), key: fs.readFileSync(globalConfig.key), cert: fs.readFileSync(globalConfig.cert) };
    const client = tls.connect(globalConfig.port, globalConfig.ip, opts, () => {
        console.log("CONNECTED. Identify verified via Cert CN.");
        rl.prompt();
    });
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('line', (line) => {
        const p = line.trim().split(' ');
        if (p[0]) client.write(JSON.stringify({ command: p[0], args: p.slice(1) }));
    });
    client.on('data', (d) => { console.log(JSON.parse(d.toString())); rl.prompt(); });
}

if (globalConfig.mode === 'server') {
    // Initialization of user and data stores
    if (fs.existsSync(globalConfig.usersFile)) {
        userStore.init(JSON.parse(fs.readFileSync(globalConfig.usersFile, 'utf8')));
    }
    if (fs.existsSync(globalConfig.dumpFile)) {
        dataStore.init(JSON.parse(fs.readFileSync(globalConfig.dumpFile, 'utf8')));
    }
    startServer();
} else {
    startShell();
}