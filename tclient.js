const tls = require('tls');
const fs = require('fs');
const readline = require('readline');
const os = require('os');

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
    cert: getArg(['-c', '--cert'], 'client.crt'),
    key: getArg(['-k', '--key'], 'client.key')
};

const client = tls.connect(config.port, config.ip, {
    key: fs.readFileSync(config.key),
    cert: fs.readFileSync(config.cert),
    ca: fs.readFileSync(config.ca),
    rejectUnauthorized: true
});

let cursorActive = false;
const promptStr = `${os.userInfo().username}@${config.ip === '127.0.0.1' ? 'localhost' : config.ip}:${config.port}> `;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: promptStr
});

client.on('connect', () => {
    console.log(JSON.stringify({ event: "connected" }));
    rl.prompt();
});

client.on('data', (data) => {
    data.toString().trim().split('\n').forEach(line => {
        try {
            const res = JSON.parse(line);
            console.log(JSON.stringify(res, null, 2));
            // Check if server indicated more data is available
            cursorActive = !!res.cursor;
            if (cursorActive) console.log("-- Press ENTER for more results --");
        } catch (e) {
            console.log(line);
        }
    });
    rl.prompt();
});

rl.on('line', (line) => {
    const input = line.trim();

    // If Enter is pressed on empty line and cursor is active, get next batch
    if (!input && cursorActive) {
        return client.write(JSON.stringify({ cmd: "next" }));
    }
    
    if (!input) return rl.prompt();
    if (input === 'exit') return client.end();

    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    
    // Parse --number or -n for the list command
    let nValue = null;
    const nIdx = parts.findIndex(p => p === '--number' || p === '-n');
    if (nIdx !== -1 && parts[nIdx + 1]) nValue = parts[nIdx + 1];

    client.write(JSON.stringify({
        cmd: cmd,
        args: { k: parts[1], v: parts[2], q: parts[1], n: nValue }
    }));
});

client.on('end', () => process.exit(0));