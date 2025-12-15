// server.js
const tls = require('tls');
const fs = require('fs');
const { Mutex } = require('async-mutex'); 

// --- Configuration ---
const HOST = 'localhost';
const DEFAULT_PORT = 9999;
const CERTFILE = 'server.crt'; 
const KEYFILE = 'server.key';   
const CLIENT_CERTFILE = 'client.crt'; 
const DUMP_FILENAME = 'store_dump.json'; 
// ---------------------

// Global state
let clientIdCounter = 0; 
const activeClients = new Map(); // Stores active ClientConnection objects (ID -> ClientConnection)

/**
 * Class to wrap the client socket and manage its unique identifier.
 */
class ClientConnection {
    constructor(socket) {
        this.socket = socket;
        this._id = ++clientIdCounter; 
        activeClients.set(this._id, this); // Add self to the global map
    }
    
    getClientId() {
        return this._id;
    }
    
    setClientId(newId) {
        if (newId === null || newId === undefined || newId === '') {
            console.error(`Attempted to set invalid ID for client ${this._id}.`);
            return false;
        }
        
        // Remove old ID from map, update ID, add new ID to map
        activeClients.delete(this._id);
        this._id = newId;
        activeClients.set(this._id, this);
        console.log(`Client ID updated to: ${this._id}`);
        return true;
    }

    write(data) {
        this.socket.write(data);
    }
    
    end() {
        this.socket.end();
    }
}

/**
 * Function to send a message to all connected clients.
 */
function broadcastMessage(senderId, message) {
    const timestamp = new Date().toISOString();
    const broadcastPayload = JSON.stringify({
        status: "BROADCAST",
        senderId: senderId,
        message: message,
        timestamp: timestamp
    }) + '\n';

    let recipients = 0;
    
    for (const [id, client] of activeClients.entries()) {
        if (id !== senderId) {
            client.write(broadcastPayload);
            recipients++;
        }
    }
    
    console.log(`[Broadcast] Message sent from Client ${senderId} to ${recipients} other clients.`);
    return recipients;
}


/**
 * Global Key-Value Store and Locks Manager
 */
class KeyValueStore {
    constructor() {
        this.data = {}; 
        this.locks = new Map(); 
        this.globalLock = new Mutex();
    }

    async loadData(newData) {
        await this.globalLock.runExclusive(() => {
            Object.assign(this.data, newData);
        });
    }
    
    async initializeData(newData) {
        await this.globalLock.runExclusive(() => {
            this.data = newData || {};
            this.locks.clear();
            for (const key in this.data) {
                this.locks.set(key, new Mutex());
            }
        });
    }

    async dumpToFile(filename) {
        await this.globalLock.runExclusive(() => {
            try {
                const json = JSON.stringify(this.data, null, 2);
                fs.writeFileSync(filename, json, 'utf8');
                return { status: "OK", op: "DUMPTOFILE", message: `Data successfully written to ${filename}` };
            } catch (error) {
                console.error("Error writing dump file:", error);
                return { status: "ERROR", op: "DUMPTOFILE", message: `Failed to write file: ${error.message}` };
            }
        });
    }
    
    async withLock(key, operation) {
        let keyMutex;
        
        await this.globalLock.runExclusive(() => {
            if (!this.locks.has(key)) {
                this.locks.set(key, new Mutex());
            }
            keyMutex = this.locks.get(key);
        });

        const result = await keyMutex.runExclusive(async () => {
            
            switch (operation.op) {
                case 'SET': 
                    this.data[key] = operation.value;
                    return { status: "OK", op: "SET", key: key };
                
                case 'GET': 
                    const value = this.data.hasOwnProperty(key) ? this.data[key] : undefined;
                    return value !== undefined 
                        ? { status: "OK", op: "GET", key: key, value: value }
                        : { status: "NOT_FOUND", op: "GET", key: key };
                
                case 'DELETE': 
                    if (this.data.hasOwnProperty(key)) {
                        delete this.data[key];
                        this.locks.delete(key); 
                        return { status: "OK", op: "DELETE", key: key };
                    } else {
                        return { status: "NOT_FOUND", op: "DELETE", key: key };
                    }
                    
                default:
                    return { status: "ERROR", message: "Unknown operation" };
            }
        });
        
        return result;
    }
}

const store = new KeyValueStore(); 

function handleConnection(socket) {
    
    if (!socket.authorized) {
        console.log('Client rejected: Unauthorized certificate.');
        socket.end(JSON.stringify({ status: "ERROR", message: "Unauthorized client (mTLS failure)" }) + '\n');
        return;
    }
    
    const client = new ClientConnection(socket); 
    const clientId = client.getClientId(); 

    console.log(`✅ New secure and authorized connection established. Client ID: ${clientId}`);

    let buffer = '';

    socket.on('data', async (data) => {
        buffer += data.toString();
        
        let boundary;
        while ((boundary = buffer.indexOf('\n')) !== -1) {
            const rawMessage = buffer.substring(0, boundary).trim();
            buffer = buffer.substring(boundary + 1);

            let response;
            try {
                const request = JSON.parse(rawMessage);
                const operation = request.op;
                
                if (operation === 'BROADCAST') {
                    const recipients = broadcastMessage(clientId, request.message);
                    response = { 
                        status: "OK", 
                        op: "BROADCAST", 
                        message: `Message sent to ${recipients} clients.`,
                        senderId: clientId
                    };

                } else if (operation === 'SETID') {
                    if (client.setClientId(request.newId)) {
                        response = { status: "OK", op: "SETID", message: `Client ID changed from ${clientId} to ${client.getClientId()}.` };
                    } else {
                        response = { status: "ERROR", op: "SETID", message: "Invalid ID provided." };
                    }
                    
                } else if (operation === 'LOAD') {
                    let loadData = request.data;
                    let source = "inline object";

                    if (request.filename) {
                        try {
                            const fileContent = fs.readFileSync(request.filename, 'utf8');
                            loadData = JSON.parse(fileContent);
                            source = `file ${request.filename}`;
                        } catch (e) {
                            response = { status: "ERROR", op: "LOAD", message: `Failed to load file ${request.filename}: ${e.message}` };
                            client.write(JSON.stringify(response) + '\n');
                            continue;
                        }
                    }
                    
                    await store.loadData(loadData);
                    response = { status: "OK", op: "LOAD", message: `Data loaded and merged successfully from ${source}. (Client: ${client.getClientId()})` };
                    
                } else if (operation === 'INIT') {
                    let loadData = request.data || {};
                    let source = "empty object";

                    if (request.filename) {
                        try {
                            const fileContent = fs.readFileSync(request.filename, 'utf8');
                            loadData = JSON.parse(fileContent);
                            source = `file ${request.filename}`;
                        } catch (e) {
                            response = { status: "ERROR", op: "INIT", message: `Failed to load file ${request.filename}: ${e.message}` };
                            client.write(JSON.stringify(response) + '\n');
                            continue;
                        }
                    }
                    
                    await store.initializeData(loadData);
                    response = { status: "OK", op: "INIT", message: `Store initialized from ${source} successfully. (Client: ${client.getClientId()})` };

                } else if (operation === 'SEARCH') { // Searches key and value
                    const term = request.term ? String(request.term).toLowerCase() : '';
                    const results = {};
                    
                    for (const key in store.data) {
                        const value = store.data[key];
                        const lowerKey = key.toLowerCase();
                        const searchableValue = JSON.stringify(value).toLowerCase();
                        
                        if (lowerKey.includes(term) || searchableValue.includes(term)) {
                            results[key] = value;
                        }
                    }
                    response = { status: "OK", op: "SEARCH", term: request.term, results: results };
                    
                } else if (operation === 'SEARCHKEY') { // Searches keys only (Reinstated)
                    const term = request.term ? String(request.term).toLowerCase() : '';
                    const results = {};
                    
                    for (const key in store.data) {
                        if (key.toLowerCase().includes(term)) {
                            results[key] = store.data[key];
                        }
                    }
                    response = { status: "OK", op: "SEARCHKEY", term: request.term, results: results };
                
                } else if (operation === 'DUMPTOFILE') { 
                    response = await store.dumpToFile(DUMP_FILENAME); 
                    
                } else if (['SET', 'GET', 'DELETE'].includes(operation)) {
                    response = await store.withLock(request.key, request); 
                } else if (operation === 'DUMP') {
                    response = { status: "OK", op: "DUMP", data: store.data };
                } else {
                    response = { status: "ERROR", message: "Unknown operation" };
                }
            } catch (e) {
                response = { status: "ERROR", message: `Invalid JSON or server error: ${e.message}` };
            }
            
            client.write(JSON.stringify(response) + '\n');
        }
    });

    socket.on('end', () => {
        console.log(`Connection closed for Client ID: ${client.getClientId()}`);
        activeClients.delete(client.getClientId()); 
    });

    socket.on('error', (err) => {
        console.error(`Socket error for Client ID ${client.getClientId()}:`, err.message);
    });
}

function startServer(port) {
    try {
        const options = {
            key: fs.readFileSync(KEYFILE),
            cert: fs.readFileSync(CERTFILE),
            
            requestCert: true,                      
            rejectUnauthorized: true,               
            ca: [fs.readFileSync(CLIENT_CERTFILE)]  
        };

        const server = tls.createServer(options, handleConnection);

        server.listen(port, HOST, () => {
            console.log(`Secure Key-Value TCP Server listening on ${HOST}:${port}`);
        });

    } catch (e) {
        console.error(`\nERROR: Could not start server. Check certificates and paths: ${e.message}`);
            process.exit(1);
    }
}

const portToUse = process.argv[2] ? parseInt(process.argv[2], 10) : DEFAULT_PORT;
startServer(portToUse);