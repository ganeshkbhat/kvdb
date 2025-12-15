// client.js
const tls = require('tls');
const fs = require('fs');
const readline = require('readline');

// --- Configuration ---
const HOST = 'localhost';
const DEFAULT_PORT = 9999;
const CERTFILE = 'server.crt'; 
const CLIENT_KEY = 'client.key';   
const CLIENT_CERT = 'client.crt'; 
// ---------------------

/**
 * Parses user input into a standardized JSON command object.
 */
function parseInput(input) {
    const parts = input.trim().split(/\s+/);
    const op = parts[0] ? parts[0].toUpperCase() : '';
    const arg1 = parts[1];
    
    // --- SIMPLE/ADMIN COMMANDS ---
    if (op === 'DUMP' || op === 'EXIT' || op === 'HELP' || op === 'DUMPTOFILE') { 
        return { op };
    }

    // --- NEW: BROADCAST COMMAND ---
    if (op === 'BROADCAST') {
        const message = parts.slice(1).join(' ').trim();
        if (!message) {
            return { op: 'INVALID', message: 'BROADCAST requires a message to send.' };
        }
        return { op, message };
    }

    // --- SETID COMMAND ---
    if (op === 'SETID') {
        const newId = parts.slice(1).join(' ').trim();
        if (!newId) {
            return { op: 'INVALID', message: 'SETID requires a new ID string or number.' };
        }
        return { op, newId };
    }
    
    // --- LOAD and INIT COMMANDS ---
    if (op === 'LOAD' || op === 'INIT') {
        const valueStr = parts.slice(1).join(' ').trim(); 
        
        if (!valueStr) {
            if (op === 'INIT') {
                return { op };
            }
            return { op: 'INVALID', message: `${op} requires a JSON object or a file path.` };
        }

        if (valueStr.startsWith('{') && valueStr.endsWith('}')) {
            try {
                const data = JSON.parse(valueStr);
                return { op, data }; 
            } catch (e) {
                return { op: 'INVALID', message: `${op} requires valid inline JSON: ${e.message}` };
            }
        } else {
            return { op, filename: valueStr }; 
        }
    }

    // --- SEARCH COMMANDS (SEARCH and SEARCHKEY) ---
    if (op === 'SEARCH' || op === 'SEARCHKEY') { 
        const term = parts.slice(1).join(' ').trim(); 
        if (!term) {
            return { op: 'INVALID', message: `${op} requires a search term.` };
        }
        return { op, term };
    }
    
    // Check if the operation is valid (CRUD)
    if (!['SET', 'GET', 'DELETE'].includes(op)) {
        return { op: 'INVALID', message: `Unknown operation: ${op}. Use SET, GET, DELETE, LOAD, INIT, etc.` };
    }
    
    // For CRUD, arg1 must be the key
    const key = arg1;
    if (!key) {
        return { op: 'INVALID', message: `${op} requires a key. E.g., ${op} user_id_1` };
    }
    
    // --- SET Logic ---
    if (op === 'SET') {
        const opKeyRegex = new RegExp(`^${op}\\s+${key}\\s+`, 'i');
        const match = input.match(opKeyRegex);

        if (!match) {
             return { op: 'INVALID', message: 'Could not parse key and value. Check spacing.' };
        }
        
        let valueStr = input.substring(match[0].length).trim();
        
        if (!valueStr) {
            return { op: 'INVALID', message: 'SET requires a JSON value.' };
        }
        
        try {
            const value = JSON.parse(valueStr);
            return { op, key, value };
        } catch (e) {
            try {
                if (!valueStr.startsWith('"') && !valueStr.endsWith('"') && isNaN(Number(valueStr))) {
                    valueStr = `"${valueStr}"`;
                }
                const value = JSON.parse(valueStr);
                return { op, key, value };
            } catch (e) {
                return { op: 'INVALID', message: `SET requires a valid JSON value. Error: ${e.message}` };
            }
        }
    }

    // --- GET and DELETE Logic ---
    return { op, key }; 
}

/**
 * Establishes and manages the persistent TLS connection and shell loop.
 */
function startShell(port) {
    let client;
    let rl;
    let buffer = '';
    
    try {
        const options = {
            host: HOST,
            port: port,
            ca: fs.readFileSync(CERTFILE), 
            key: fs.readFileSync(CLIENT_KEY),
            cert: fs.readFileSync(CLIENT_CERT),
            rejectUnauthorized: true 
        };

        client = tls.connect(options, () => {
            console.log(`\n✅ Securely connected to server at ${HOST}:${port}. Type 'help' for usage.`);
            startReadline();
        });

    } catch (e) {
        console.error(`\n❌ Connection Setup Error: ${e.message}`);
        return;
    }
    
    // --- Data Handling ---
    client.on('data', (data) => {
        buffer += data.toString();
        
        let boundary;
        while ((boundary = buffer.indexOf('\n')) !== -1) {
            const rawResponse = buffer.substring(0, boundary).trim();
            buffer = buffer.substring(boundary + 1);

            try {
                const response = JSON.parse(rawResponse);
                
                if (response.status === "BROADCAST") {
                    console.log(`\n📢 BROADCAST from [Client ${response.senderId}]: ${response.message}`);
                } else {
                    console.log("<- Response:");
                    console.log(JSON.stringify(response, null, 4));
                }
            } catch(e) {
                 console.error("<- Received invalid response:", rawResponse);
            }

            rl.prompt(); 
        }
    });
    
    // --- Connection Events ---
    client.on('error', (err) => {
        console.error(`\n❌ Socket Error: ${err.message}`);
        if (rl) rl.close();
    });

    client.on('end', () => {
        console.log('\nConnection closed by server. Exiting shell.');
        if (rl) rl.close();
    });

    client.on('close', () => {
        console.log('Shell exited.');
        process.exit(0);
    });

    // --- Interactive Shell Logic ---
    function startReadline() {
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: `KV-SHELL@${HOST}:${port}> `
        });

        rl.prompt();

        rl.on('line', (line) => {
            const input = line.trim();
            if (!input) {
                rl.prompt();
                return;
            }
            
            const command = parseInput(input);

            if (command.op === 'EXIT') {
                client.end(); 
                return;
            } else if (command.op === 'INVALID') {
                console.log(`Error: ${command.message}`);
            } else if (command.op === 'HELP') {
                console.log("Available Commands:");
                console.log("  SET <key> <json_value>   - Create/Update a key (CRUD).");
                console.log("  GET <key>                - Read a key (CRUD).");
                console.log("  DELETE <key>             - Delete a key (CRUD).");
                console.log("  LOAD [{json_object} or <file_path>] - Merges data from JSON object or file into the store (retains existing data).");
                console.log("  INIT [{json_object} or <file_path>] - Replaces store data with JSON object, file content, or empty store.");
                console.log("  SEARCH <term>            - Searches BOTH keys and JSON values for a term.");
                console.log("  SEARCHKEY <term>         - Searches ONLY keys for a term.");
                console.log("  BROADCAST <message>      - Sends a message to all other connected clients.");
                console.log("  DUMP                     - (Admin) Retrieves all data to the console.");
                console.log("  DUMPTOFILE               - (Admin) Writes all data to a file (store_dump.json) on the server.");
                console.log("  SETID <new_id>           - (Admin) Sets a new ID for the current connection.");
                console.log("  EXIT                     - Closes the connection and shell.");
            } else {
                // Send command
                const message = JSON.stringify(command) + '\n';
                client.write(message);
            }
            
            if (command.op === 'INVALID' || command.op === 'HELP') {
                rl.prompt();
            }
        }).on('close', () => {
            client.end(); 
        });
    }
}

// --- Main Execution ---
if (require.main === module) {
    const portToUse = process.argv[2] ? parseInt(process.argv[2], 10) : DEFAULT_PORT;
    console.log("Starting interactive shell...");
    startShell(portToUse);
}