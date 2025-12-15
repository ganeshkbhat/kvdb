/**
 * * Package: json-faster
 * Author: Ganesh B
 * Description: A key-value store manager with concurrency locking, exposed via a mandatory TLS socket server. 
 * The Server enforces mTLS, but the Client Shell supports both standard TLS (server validation only) and mTLS.
 * File: index.js (Unified Server & Client Shell)
 * * Rectified Search/Get/Set/Delete and Dump functionality.
 * */

/* eslint no-console: 0 */

'use strict';

const fs = require("fs");
const path = require("path");
const readline = require('readline');

// Dynamically require 'tls' for mandatory secure communication
let tls; 
try {
    tls = require('tls');
} catch (e) {
    console.error("FATAL: 'tls' module is required but could not be loaded. Exiting.");
    process.exit(1);
}

// Global configuration variable for the server (used by JsonManager for synchronization)
let globalServerConfig = {}; 

// --- 1. Utility and JsonManager Functions ---

/**
 * Converts a single-level JSON object with dot notation keys into a nested JSON object.
 */
function unflattenJson(obj) {
    if (typeof obj !== 'object' || obj === null) {
        throw new Error("Input must be a non-null object.");
    }
    const result = {};
    for (const fullKey in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, fullKey)) {
            const keys = fullKey.split(/(?<!\\)\./).map(key => key.replace(/\\\./g, '.'));
            let current = result;
            keys.forEach((key, index) => {
                if (index === keys.length - 1) {
                    current[key] = obj[fullKey];
                } else {
                    if (!current[key] || typeof current[key] !== 'object') {
                        current[key] = {};
                    }
                    current = current[key];
                }
            });
        }
    }
    return result;
}


/**
 * Flattens a nested JSON object into a single level with dot notation keys.
 */
function flattenJsonWithEscaping(obj, prefix = "") {
    if (typeof obj !== 'object' || obj === null) {
        throw new Error("Input must be a non-null object.");
    }

    const result = {};
    function escapeKey(key) {
        return key.replace(/\./g, '\\.');
    }

    function recurse(current, keyPrefix) {
        for (const key in current) {
            if (Object.prototype.hasOwnProperty.call(current, key)) {
                const escapedKey = escapeKey(key);
                const newKey = keyPrefix ? `${keyPrefix}.${escapedKey}` : escapedKey;

                if (typeof current[key] === 'object' && current[key] !== null) {
                    recurse(current[key], newKey);
                } else {
                    result[newKey] = current[key];
                }
            }
        }
    }

    recurse(obj, prefix);
    return result;
}


/**
 * Ensures the file path is safe and within the application's directory.
 */
function safeFilePath(filename) {
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
        throw new Error("Invalid filename: Only alphanumeric, _, -, and . are allowed.");
    }
    
    const filePath = path.join(__dirname, filename);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(__dirname)) {
        throw new Error("Access denied: Path is outside the application root.");
    }
    return filePath; 
}


/**
 * Writes data to a file.
 */
function writeToFile(obj, filename) {
    try {
        fs.writeFileSync(safeFilePath(filename), obj)
        return true
    } catch (e) {
        console.error(`Error writing to file ${filename}:`, e);
        return JSON.stringify(e);
    }
}


/**
 * JsonManager: A key-value store with concurrency control via locking and **synchronization to disk**.
 */
function JsonManager() {
    var data = {}; // Private in-memory store
    var flag = false; // Lock flag
    var eventPause = []; 

    /**
     * Synchronizes the in-memory data to the dump file if in server mode.
     */
    function synchronizeStore() {
        if (globalServerConfig.mode === 'server' && globalServerConfig.dumpFile) {
            const dataToDump = JSON.stringify(data, null, 2);
            writeToFile(dataToDump, globalServerConfig.dumpFile);
        }
    }
    
    function processQueue() {
        if (!flag && eventPause.length > 0) {
            const nextEvent = eventPause.shift();
            console.log(`[JsonManager] Processing deferred event: ${nextEvent.event} for key: ${nextEvent.key || '(none)'}`);
            // Note: Deferred events (update/set) should re-call the synchronized functions
        }
    }

    // --- Data Modification Methods (Now with Synchronization) ---
    
    /**
     * Sets or updates a key-value pair. Ensures key is a string.
     */
    function set(key, value) {
        if (typeof key !== 'string') {
            throw new Error("Key must be a string.");
        }
        if (flag === false) { 
            flag = true; 
            data[key] = value; 
            
            console.log(`[JsonManager-SET] Stored key: ${key}. Current store size: ${Object.keys(data).length}`);

            synchronizeStore(); // SYNCHRONIZE
            flag = false; 
            processQueue(); 
            return { [key]: value }; 
        } 
        eventPause.push({ event: 'set', key, value }); 
        return { status: 'pending', message: 'Operation locked, queued for later execution.' };
    }
    
    /**
     * Merges a provided object into the store (shallow merge).
     */
    function update(obj) {
        if (flag === false) { 
            flag = true; 
            data = { ...data, ...obj }; 
            synchronizeStore(); 
            flag = false; 
            processQueue(); 
            return obj 
        } 
        eventPause.push({ event: "update", obj }); 
        return { status: 'pending', message: 'Operation locked, queued for later execution.' };
    }
    
    /**
     * Replaces the entire store with the provided object.
     */
    function init(obj = {}) { 
        data = obj; 
        synchronizeStore(); 
        return data; 
    }
    
    /**
     * Loads/merges data without locking (used internally on startup).
     */
    function load(obj = {}) { 
        data = { ...data, ...obj }; 
        synchronizeStore(); 
        return data; 
    }
    
    /**
     * Deletes a key from the store.
     */
    function deleteKey(key) { 
        if (flag) return null; 
        const exists = data.hasOwnProperty(key); 
        if (exists) {
            delete data[key];
            synchronizeStore(); 
            console.log(`[JsonManager-DELETE] Deleted key: ${key}. Remaining size: ${Object.keys(data).length}`);
        }
        return exists; 
    }
    
    // --- Data Access Methods (No Synchronization) ---
    
    /**
     * Retrieves the value for a given key.
     */
    function getKey(key) { 
        const result = data.hasOwnProperty(key) ? data[key] : undefined;
        
        console.log(`[JsonManager-GET] Requested key: ${key}. Found: ${data.hasOwnProperty(key) ? 'True' : 'False'}.`);
        return result; 
    }
   
    function dump() { return { ...data }; }
    
    /**
     * Dumps the current in-memory store to a client-specified file on the server.
     */
    function dumpCurrentToFile(filename) {
        const obj = dump();
        return writeToFile(JSON.stringify(obj, null, 2), filename);
    }

    // Retained for API compatibility, although client uses dumpCurrentToFile
    function dumpToFile(obj, filename) { return writeToFile(JSON.stringify(obj), filename); } 
    
    function read(key, options = { createKey: false }) { return data[key] ? { [key]: data[key] } : undefined; }
    function deleteKeys(keysArray) { /* implementation */ return []; }
    
    /**
     * Core search logic for case-insensitive substring search.
     */
    function searchLogic(criteria, type = 'keyvalue') {
        const results = {};
        if (!criteria) return results;

        const criteriaLower = String(criteria).toLowerCase();

        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                let match = false;

                if (type.includes('key') && String(key).toLowerCase().includes(criteriaLower)) {
                    match = true;
                }
                
                if (type.includes('value')) {
                    const valueLower = typeof data[key] === 'string' 
                        ? data[key].toLowerCase() 
                        : JSON.stringify(data[key]).toLowerCase();
                        
                    if (valueLower.includes(criteriaLower)) {
                        match = true;
                    }
                }

                if (match) {
                    results[key] = data[key];
                }
            }
        }
        return results;
    }
    
    /**
     * Searches keys and values. (Using default logic for now, ignoring options.)
     */
    function searchKeyValues(criteria, options = { like: false, regex: false }) { 
         console.warn(`[JsonManager] Search Key/Value executed with criteria: ${criteria}`);
         return searchLogic(criteria, 'keyvalue');
    }
    
    /**
     * Searches keys only. (Using default logic for now, ignoring options.)
     */
    function searchKeys(criteria, options = { like: false, regex: false }) { 
         console.warn(`[JsonManager] Search Keys executed with criteria: ${criteria}`);
         return searchLogic(criteria, 'key');
    }
    
    /**
     * Searches values only. (Using default logic for now, ignoring options.)
     */
    function searchValues(criteria, options = { like: false, regex: false }) { 
         console.warn(`[JsonManager] Search Values executed with criteria: ${criteria}`);
         return searchLogic(criteria, 'value');
    }
    
    function dumpKeys(criteria, options = { like: false, regex: false }, type = "search") { return []; }


    // Public API
    return {
        read, write: set, set, update, dump, dumpToFile, init, load,
        hasKey: key => data.hasOwnProperty(key), getKey, get: getKey, deleteKey, deleteKeys,
        search: searchKeyValues, searchKeys, searchValues, searchKeyValues, dumpKeys,
        dumpCurrentToFile, // EXPOSED FOR CLIENT'S DUMP -F COMMAND
        lock: () => flag, 
        setlock: (lock = true) => { flag = lock; return flag; }, 
        droplock: () => { flag = false; processQueue(); return flag; },
    }
}


// --- 2. Server Implementation (Mandatory mTLS) ---

/**
 * Handles incoming commands from the socket by running JsonManager methods.
 */
function handleCommand(manager, data) {
    try {
        const request = JSON.parse(data);
        const { command, args = [] } = request;

        if (typeof manager[command] !== 'function') {
            return JSON.stringify({ status: 'error', message: `Unknown or disallowed command: ${command}` });
        }

        const result = manager[command](...args);
        
        if (result && result.status === 'pending') {
            return JSON.stringify({ status: 'info', command: command, message: result.message });
        }
        
        return JSON.stringify({ status: 'success', command: command, result: result });

    } catch (error) {
        if (error instanceof SyntaxError) {
            return JSON.stringify({ status: 'error', message: 'Invalid JSON command format.' });
        } else {
            return JSON.stringify({ status: 'error', message: error.message, details: error.stack });
        }
    }
}

/**
 * Sets up listeners for the TLS server instance.
 */
function setupTlsListeners(server, manager, port) {
    server.on('secureConnection', (socket) => {
        const clientInfo = `${socket.remoteAddress}:${socket.remotePort}`;
        const authorized = socket.authorized;
        
        if (!authorized) {
            // Client failed mTLS authentication
            console.error(`[mTLS] Client UNAUTHORIZED: ${clientInfo}. Connection dropped. Check client certificate/key/CA.`);
            socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
            return;
        }

        console.log(`[mTLS] Client connected and AUTHORIZED: ${clientInfo}`);

        socket.on('data', (data) => {
            const rawCommands = data.toString().trim();
            const commands = rawCommands.split('\n').filter(line => line.length > 0);
            
            for (const commandLine of commands) {
                const response = handleCommand(manager, commandLine);
                socket.write(response + '\n');
            }
        });

        socket.on('end', () => {
            console.log(`[mTLS] Client disconnected: ${clientInfo}`);
        });

        socket.on('error', (err) => {
            console.error(`[mTLS] Socket error for ${clientInfo}: ${err.message}`);
        });
    });

    server.listen(port, () => {
        console.log(`[mTLS] Server listening on port ${port} (Mandatory Mutual TLS)`);
    });
    
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[mTLS] Port ${port} is already in use. Terminating.`);
            process.exit(1); 
        } else {
            console.error(`[mTLS] Server error:`, err.message);
        }
    });

    return server;
}

/**
 * Starts the mandatory Mutual TLS server instance.
 */
function startServer(manager, config) {
    // Check for mandatory mTLS files
    if (!config.cert || !config.key || !config.caCert) {
        console.error("FATAL: Server mode requires all mTLS files: -c <server.crt>, -k <server.key>, and -ca <ca.crt>.");
        process.exit(1);
    }

    try {
        const tlsOptions = {
            key: fs.readFileSync(safeFilePath(config.key)),
            cert: fs.readFileSync(safeFilePath(config.cert)),
            ca: fs.readFileSync(safeFilePath(config.caCert)),
            
            // Enforce mTLS: request client certificate and reject if unauthorized
            requestCert: true, 
            rejectUnauthorized: true, 
        };
        
        const tlsServer = tls.createServer(tlsOptions);
        setupTlsListeners(tlsServer, manager, config.port);

    } catch (e) {
        console.error(`FATAL: Could not start mTLS server. Check file paths, permissions, and ensure certificates are in PEM format. Reason: ${e.code || e.message}. Exiting.`);
        process.exit(1);
    }
}


// --- 3. Client Shell (Flexible TLS/mTLS Connection) ---

/**
 * Prints the shell help menu.
 */
function printHelpMenu() {
    // Helper function for aligned output
    const pad = (str, len) => String(str).padEnd(len);

    console.log('\n================================================================');
    console.log('                 Key-Value Store Shell Help');
    console.log('================================================================');
    console.log('Protocol: Standard TLS (Server Validation) or Mutual TLS (mTLS).');
    console.log('Client MUST provide **-ca**. Client **-c** and **-k** are optional (for mTLS).');
    
    console.log(
        `${pad('Command', 12)} | ${pad('Syntax / Arguments', 30)} | Description\n` +
        `${'-'.repeat(12)} | ${'-'.repeat(30)} | ${'-'.repeat(40)}\n` +
        `${pad('set', 12)} | ${pad('<key> <value>', 30)} | Sets or updates a key with a value.\n` +
        `${pad('get', 12)} | ${pad('<key>', 30)} | Retrieves the value of a key.\n` +
        `${pad('del', 12)} | ${pad('<key>', 30)} | Deletes a key from the store.\n` +
        `${pad('search', 12)} | ${pad('<criteria> [-like|-regex]', 30)} | Searches keys and values.\n` +
        `${pad('searchkeys', 12)} | ${pad('<criteria> [-like|-regex]', 30)} | Searches keys only.\n` +
        `${pad('searchvalues', 12)} | ${pad('<criteria> [-like|-regex]', 30)} | Searches values only.\n` +
        `${pad('update', 12)} | ${pad('JSON | -f <file>', 30)} | Merges data.\n` +
        `${pad('load', 12)} | ${pad('JSON | -f <file>', 30)} | Merges data.\n` +
        `${pad('init', 12)} | ${pad('JSON | -f <file>', 30)} | Replaces all data.\n` +
        `${pad('clear', 12)} | ${pad('', 30)} | Clears the entire store.\n` +
        `${pad('dump', 12)} | ${pad('[ -f <filename> ]', 30)} | Prints data or saves to server file.\n` +
        `${pad('lock', 12)} | ${pad('setlock <bool> | droplock', 30)} | Manages the concurrency lock.\n` +
        `${pad('help', 12)} | ${pad('', 30)} | Displays this help menu.\n` +
        `${pad('exit', 12)} | ${pad('', 30)} | Disconnects and quits the shell.`
    );
    console.log('================================================================\n');
}

/**
 * Processes a single incoming response line and prints the result.
 */
function processResponse(line, rl) {
    if (line.trim().length === 0) return;

    try {
        const response = JSON.parse(line);
        
        if (response.status === 'success') {
            const result = typeof response.result === 'object' && response.result !== null 
                ? JSON.stringify(response.result, null, 2) 
                : String(response.result);
            console.log(`\n[SUCCESS] ${response.command}: \n${result}`);
        } else if (response.status === 'info' && response.message.includes('locked')) {
            console.log(`\n[INFO] Command deferred: ${response.message}`);
        } else {
            console.error(`\n[ERROR] ${response.command}: ${response.message}`);
            if (response.details) console.error(`  Details: ${response.details.split('\n')[0]}`);
        }
    } catch (e) {
        console.error(`\n[RESPONSE PARSE ERROR] Failed to parse JSON response: ${line}`);
    }
    
    rl.prompt(true);
}


/**
 * Interactive shell for connecting to the JsonManager server using flexible TLS/mTLS.
 */
function Shell(config) {
    const { ip, port, caCert, cert: clientCertFile, key: clientKeyFile } = config; 
    
    // CA file is mandatory for all secure connections (to validate the server)
    if (!caCert) {
        console.error("FATAL: Shell mode requires the CA file: -ca <ca.crt> to enable server certificate validation.");
        process.exit(1);
    }
    
    let ca = null;
    let clientCert = null; 
    let clientKey = null; 
    let client;
    let isMtls = false;
    
    // --- 1. Load Certificates ---
    try {
        // Load mandatory CA file
        ca = fs.readFileSync(safeFilePath(caCert));
        
        // Load optional client cert/key
        if (clientCertFile && clientKeyFile) {
            clientCert = fs.readFileSync(safeFilePath(clientCertFile));
            clientKey = fs.readFileSync(safeFilePath(clientKeyFile));
            isMtls = true;
            console.log(`[Shell] Client certificate/key loaded. Attempting Mutual TLS (mTLS).`);
        } else {
             console.log(`[Shell] Connecting with Standard TLS (Server validation only).`);
        }
    } catch (e) {
        console.error(`FATAL: Failed to load required certificate files. Check paths, permissions, and ensure files are in PEM format. Reason: ${e.message}. Exiting.`);
        process.exit(1);
    }

    // --- 2. Establish Persistent Connection ---
    
    const connectMode = isMtls ? "mTLS" : "TLS";
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${connectMode} ${ip}:${port}> `
    });
    
    const handleConnect = () => {
        console.log(`[${connectMode} Shell] Successfully connected to: ${ip}:${port}.`);
        console.log('Type "**help**" for commands, "**exit**" to quit.');
        rl.prompt(); 
    };

    const tlsOptions = {
        // IMPORTANT: Always set rejectUnauthorized: true and provide the CA
        // This ensures the server's identity is verified against the CA.
        rejectUnauthorized: true, 
        ca: ca, 
        // These will be null/undefined if not provided, safely disabling client auth
        key: clientKey, 
        cert: clientCert,
    };
    
    client = tls.connect(port, ip, tlsOptions, handleConnect);

    // --- 3. Setup Response Line Listener (Reads from socket) ---
    const socketRl = readline.createInterface({ input: client, terminal: false });
    socketRl.on('line', (line) => processResponse(line, rl));


    // --- 4. Handle Socket Events ---
    client.on('error', (e) => {
        console.error(`\n[CONNECTION ERROR] ${e.message}`);
        
        // Detailed error guidance for mTLS/TLS issues
        if (e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
            console.error('HINT: Server certificate validation failed.');
            console.error('ACTION: Ensure the server certificate is signed by the CA provided with client\'s `-ca` flag.');
        } else if (e.code === 'UNABLE_TO_GET_ISSUER_CERT' && isMtls) {
            console.error('HINT: Client certificate validation failed (server side).');
            console.error('ACTION: Ensure the client certificate is signed by the CA provided to the server.');
        } else if (e.code === 'ECONNREFUSED') {
             console.error('HINT: Connection refused. Is the server running on the correct host and port?');
        } else if (e.code === 'ERR_OSSL_PEM_NO_START_LINE') {
             console.error('HINT: One of the certificate or key files is likely corrupt or not in the expected PEM format.');
        } else if (e.code === 'UNAUTHORIZED') {
             // This is less common here but catches server-side rejection
             console.error('HINT: Server rejected the connection. This often means the client certificate was invalid or missing (if the server requires mTLS).');
        }
        
        rl.close();
        process.exit(1);
    });

    client.on('close', () => {
        console.log('\n[CONNECTION CLOSED] Server disconnected.');
        rl.close();
        process.exit(0);
    });

    // --- 5. Setup User Input Listener (Writes to socket) ---
    rl.on('line', (line) => {
        const commandString = line.trim();
        if (commandString.length === 0) {
            rl.prompt();
            return;
        }

        const commandName = commandString.split(/\s+/)[0].toLowerCase();

        if (commandName === 'help') {
            printHelpMenu();
            rl.prompt();
            return;
        }
        if (commandName === 'exit' || commandName === 'quit') {
            rl.close();
            client.end(); 
            return;
        }
        
        executeCommandPayload(commandString, client, rl);
    });

    rl.on('close', () => {
        console.log('Shell closed.');
        process.exit(0);
    });
}

/**
 * Builds the JSON payload and sends it over the persistent socket.
 */
function executeCommandPayload(commandString, client, rl) {
    
    const parts = commandString.trim().split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const rawArgs = parts.slice(1);
    
    let payload;
    let args = [];
    
    try {
        switch (commandName) {
            case 'set':
            case 'write':
                if (rawArgs.length < 2) throw new Error('SET requires a key and a value.');
                
                // The first word is the key, the rest is the value (allowing spaces in values)
                const key = rawArgs[0];
                const value = commandString.substring(commandName.length + key.length + 2).trim();
                
                args = [key, value];
                payload = { command: 'set', args: args }; 
                break;

            case 'get':
            case 'read':
            case 'has':
                if (rawArgs.length !== 1) throw new Error(`${commandName.toUpperCase()} requires exactly one key.`);
                args = [rawArgs[0]];
                payload = { command: 'get', args: args }; 
                if (commandName === 'has') payload.command = 'hasKey';
                break;
            
            case 'del':
            case 'deletekey':
                if (rawArgs.length !== 1) throw new Error(`${commandName.toUpperCase()} requires exactly one key.`);
                args = [rawArgs[0]];
                payload = { command: 'deleteKey', args: args };
                break;

            case 'init':
            case 'load':
            case 'update':
                let dataObject;
                const isFileLoad = rawArgs.length === 2 && 
                                   (rawArgs[0].toLowerCase() === '-f' || rawArgs[0].toLowerCase() === '--file');

                if (isFileLoad) {
                    if (!rawArgs[1]) throw new Error(`File path missing for ${commandName.toUpperCase()} -f.`);
                    const filePath = path.resolve(rawArgs[1]); 
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    dataObject = JSON.parse(fileContent);
                    console.log(`[Shell] Successfully loaded data from file: ${rawArgs[1]}`);
                } else if (rawArgs.length >= 1) {
                    const jsonString = commandString.substring(commandName.length).trim();
                    dataObject = JSON.parse(jsonString);
                } else {
                    throw new Error(`${commandName.toUpperCase()} requires a JSON object or '-f <filename>'.`);
                }
                payload = { command: commandName, args: [dataObject] };
                break;

            case 'dump':
                if (rawArgs.length === 2 && (rawArgs[0].toLowerCase() === '-f' || rawArgs[0].toLowerCase() === '--dump-file')) {
                     // FIX: Use the new server command and pass the filename 
                     payload = { command: 'dumpCurrentToFile', args: [rawArgs[1]] }; 
                } else if (rawArgs.length === 0) {
                    payload = { command: 'dump', args: [] };
                } else {
                    throw new Error('DUMP requires no arguments (to print) or "-f filename" (to dump to file on server).');
                }
                break;
            
            case 'clear':
                payload = { command: 'init', args: [{}] }; 
                break;
            
            case 'search':
            case 'searchkeys':
            case 'searchvalues':
                if (rawArgs.length < 1) throw new Error(`${commandName.toUpperCase()} requires a search criteria.`);
                
                const criteria = rawArgs.find(arg => !arg.startsWith('-'));
                if (!criteria) throw new Error(`${commandName.toUpperCase()} requires a search criteria.`);
                
                const options = { 
                    like: rawArgs.includes('-like'), 
                    regex: rawArgs.includes('-regex') 
                };
                
                let managerCommand;
                if (commandName === 'search') {
                    managerCommand = 'searchKeyValues'; 
                } else {
                    managerCommand = commandName;
                }
                
                payload = { command: managerCommand, args: [criteria, options] };
                break;

            case 'lock':
            case 'droplock':
                payload = { command: commandName, args: [] };
                break;
            
            case 'setlock':
                if (rawArgs.length !== 1) throw new Error('SETLOCK requires a boolean argument (true or false).');
                const lockState = rawArgs[0].toLowerCase() === 'true';
                payload = { command: 'setlock', args: [lockState] };
                break;

            default:
                console.log(`Unknown command: ${commandName}. Type 'help' for available commands.`);
                rl.prompt(); 
                return;
        }

        client.write(JSON.stringify(payload) + '\n', (err) => {
            if (err) {
                console.error(`\n[WRITE ERROR] Failed to send command: ${err.message}`);
                rl.prompt();
            }
        });

    } catch (e) {
        console.error(`\n[COMMAND ERROR] ${e.message}`);
        rl.prompt();
    }
}


// --- 4. Command-Line Argument Parsing and Execution ---

function parseDurationToMs(durationStr) {
    if (typeof durationStr !== 'string') return 0;
    const match = durationStr.match(/^(\d+)([smhdm])$/i);
    if (!match) return 0;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 0;
    }
}

const prefixDefinitions = [
    { prefixes: ['-h', '--host', '-ip'], key: 'ip', default: '127.0.0.1' }, 
    { prefixes: ['-p', '--port'], key: 'port', default: 9999, type: 'number' }, 
    { prefixes: ['-s', '--mode'], key: 'mode', default: 'server', type: 'string' }, 
    
    // Server/Client Config (Mandatory for mTLS, Flexible for Shell)
    { prefixes: ['-c', '--cert'], key: 'cert', default: 'server.crt' },
    { prefixes: ['-k', '--key'], key: 'key', default: 'server.key' },
    { prefixes: ['-ca', '--ca-cert'], key: 'caCert', default: 'ca.crt' },

    // Server Config Only
    { prefixes: ['--dump-file'], key: 'dumpFile', default: 'store_dump.json' },
    { prefixes: ['--exit-dump-file'], key: 'exitDumpFile', default: null }, 
    { prefixes: ['-dt', '--dump-time'], key: 'dumpTime', default: '5m' }, 
    { prefixes: ['--load-file'], key: 'loadFile', default: null },
    { prefixes: ['--init-data'], key: 'initData', default: null, type: 'json' }, 
];

function parseCommandLineArguments(definitions) {
    const args = process.argv.slice(2);
    const config = {};
    const argMap = {}; 

    definitions.forEach(def => {
        config[def.key] = def.default;
        def.prefixes.forEach(p => argMap[p] = def.key);
    });

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (argMap[arg]) {
            const key = argMap[arg];
            let value = args[i + 1]; 

            if (!value || value.startsWith('-')) {
                const def = definitions.find(d => d.key === key);
                if (def.type === 'number') {
                    console.error(`Error: Value missing for required argument ${arg}`);
                    process.exit(1);
                }
                if (def.key === 'mode' && !value) {
                    config[key] = 'server';
                }
                continue;
            }

            const def = definitions.find(d => d.key === key);
            
            if (def.type === 'number') {
                const parsedInt = parseInt(value);
                if (isNaN(parsedInt)) {
                    console.error(`Error: Value for ${arg} ('${value}') is not a valid number.`);
                    process.exit(1);
                }
                config[key] = parsedInt;
            } else if (def.type === 'json') {
                try {
                    config[key] = JSON.parse(value);
                } catch (e) {
                    console.error(`Error: Invalid JSON provided for ${arg}: ${value}`);
                    process.exit(1);
                }
            } else {
                config[key] = value;
            }
            i++; 
        }
    }

    if (!config.exitDumpFile) {
        config.exitDumpFile = config.dumpFile;
    }
    config.dumpTimeMs = parseDurationToMs(config.dumpTime);
    
    return config;
}


// --- 5. Execution ---

const config = parseCommandLineArguments(prefixDefinitions);

// Set the global config for JsonManager to use for synchronization
globalServerConfig = config; 

const managerInstance = JsonManager(); 

if (config.mode.toLowerCase() === 'shell') {
    Shell(config);
} else {
    
    // 1. Initial Load from Dump File if it exists, otherwise load from Load File/Init Data
    let initialLoadPerformed = false;
    if (config.dumpFile) {
        try {
            const filePath = safeFilePath(config.dumpFile);
            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const loadedData = JSON.parse(fileContent);
                console.log(`Loading initial data from active dump file: ${config.dumpFile}`);
                managerInstance.load(loadedData);
                initialLoadPerformed = true;
            }
        } catch (e) {
            console.error(`Error loading/parsing dump file ${config.dumpFile}:`, e.message);
            process.exit(1);
        }
    }

    // 2. Load from explicit Load File (only if dump file was not loaded or is not configured)
    if (!initialLoadPerformed && config.loadFile) {
        try {
            const filePath = safeFilePath(config.loadFile);
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const loadedData = JSON.parse(fileContent);
            console.log(`Loading data from load file: ${config.loadFile}`);
            managerInstance.load(loadedData);
        } catch (e) {
            if (e.code === 'ENOENT') {
                console.warn(`Warning: Load file '${config.loadFile}' not found. Skipping load.`);
            } else {
                console.error(`Error loading file ${config.loadFile}:`, e.message);
                process.exit(1);
            }
        }
    }

    // 3. Initial Load from CLI data 
    if (config.initData) {
        console.log(`Initializing manager with CLI data.`);
        managerInstance.init(config.initData);
    }
    
    // 4. Dynamic dumping interval is now redundant due to synchronous write, 
    //    but the interval check remains for completeness.
    if (config.dumpTimeMs > 0) {
         console.log(`Synchronization is active. Dynamic data dump interval (${config.dumpTime}) is technically redundant.`);
    }


    // 5. Graceful Shutdown Handler
    function handleShutdown(signal) {
        console.log(`\nReceived signal ${signal}. Starting graceful shutdown...`);
        
        const finalDump = managerInstance.dump();
        const success = writeToFile(JSON.stringify(finalDump, null, 2), config.exitDumpFile);
        
        if (success === true) {
            console.log(`[EXIT DUMP] Final data successfully saved to ${config.exitDumpFile}`);
        } else {
            console.error(`[EXIT DUMP] Failed to save final data to ${config.exitDumpFile}.`);
        }

        process.exit(0);
    }

    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);


    // 6. Start the Server (Mandatory mTLS)
    startServer(managerInstance, config);
}

// --- 6. EXPORTS (COMPLETE) ---
module.exports = {
    JsonManager,
    writeToFile,
    flattenJsonWithEscaping,
    unflattenJson,
    flatten: flattenJsonWithEscaping,
    unflatten: unflattenJson
}