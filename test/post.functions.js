
const http = require('http');
const assert = require('assert');
const sinon = require('sinon');
// We assume 'chai' is available in the testing environment.
const { expect } = require('chai');


/**
 * Makes an HTTP POST request to a specified host and port.
 *
 * NOTE: This function uses the 'http' module. If you need HTTPS,
 * simply change `const http = require('http');` to
 * `const http = require('https');` and adjust the default port if necessary.
 *
 * @param {string} host The hostname (e.g., 'jsonplaceholder.typicode.com').
 * @param {number} port The port number (e.g., 80 for HTTP, 443 for HTTPS).
 * @param {string} path The endpoint path (e.g., '/posts').
 * @param {object} payload The JavaScript object to send as the request body.
 * @param {object} [requestOptions={}] Optional. Additional options for http.request (e.g., timeout, agent, custom headers).
 * @returns {Promise<string>} A Promise that resolves with the response body as a string.
 */
function makePostRequest(host, port, path, payload, requestOptions = {}) {
    // Stringify the payload to send it as JSON
    const postData = JSON.stringify(payload);

    // Define the request options.
    // We spread the custom options first, then use the mandatory function arguments
    // and calculated values (Content-Type/Length) to ensure correctness.
    const options = {
        ...requestOptions, // Custom options (e.g., timeout, agent) are added first
        hostname: host,
        port: port,
        path: path,
        method: 'POST', // Enforce POST method
        headers: {
            ...requestOptions.headers, // Merge user-provided headers (allows custom headers)
            'Content-Type': 'application/json', // Override/ensure correct content type
            'Content-Length': Buffer.byteLength(postData) // Override/ensure correct content length
        }
    };

    return new Promise((resolve, reject) => {
        // Create the request
        const req = http.request(options, (res) => {
            let data = '';

            // Set the encoding of the response
            res.setEncoding('utf8');

            // A chunk of data has been received.
            res.on('data', (chunk) => {
                data += chunk;
            });

            // The whole response has been received.
            res.on('end', () => {
                // Check for successful HTTP status codes (2xx)
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    // reject(new Error(`Request failed with status code ${res.statusCode}: ${data}`));
                    resolve(data)
                }
            });
        });

        // Handle errors during the request (e.g., DNS lookup failure, connection refused)
        req.on('error', (e) => {
            reject(new Error(`Problem with request: ${e.message}`));
        });

        // Handle timeout if set in options
        if (options.timeout) {
            req.setTimeout(options.timeout, () => {
                req.destroy(new Error(`Request timeout after ${options.timeout}ms`));
            });
        }

        // Write data to request body
        req.write(postData);
        req.end();
    });
}


// // load test data for server for testing
// server.load({
//     12: 20000,
//     879898: ["test", "for", "alues"],
//     "testing": "for alues",
//     "123tsj": "testing",
//     "store": ["vaue", "loads", 10],
//     'user_id': 101,
//     'username': 'alpha_user',
//     'status': 'Active',
//     'tags': ['premium', 'new_member', 'verified'],
//     'location': 'New York City',
//     'last_login': '2025-11-10',
//     'settings': { theme: 'dark', notifications: true },
//     'scores': [95, 88, 92]
// })



/**
 * Recursively compares two values (objects, arrays, or primitives) and collects
 * all discovered differences.
 *
 * @param {*} val1 The first value to compare.
 * @param {*} val2 The second value to compare.
 * @param {string} currentPath The current path in the object structure (e.g., 'user.address[0]').
 * @param {Array<Object>} differences The array to store difference objects.
 * @returns {Array<Object>} The array of differences.
 */
function deepCompare(val1, val2, currentPath = '', differences = []) {
    // 1. Check for primitive equality (null, undefined, number, string, boolean, symbol)
    if (val1 === val2) {
        return differences;
    }

    // Check for type difference or null/undefined vs anything else
    if (typeof val1 !== typeof val2 || val1 === null || val2 === null) {
        differences.push({
            path: currentPath || 'root',
            type: 'Type/Value Mismatch (Primitive or Null)',
            value1: val1,
            value2: val2
        });
        return differences;
    }

    // 2. Handle Dates
    if (val1 instanceof Date && val2 instanceof Date) {
        if (val1.getTime() !== val2.getTime()) {
            differences.push({
                path: currentPath,
                type: 'Date Mismatch',
                value1: val1.toISOString(),
                value2: val2.toISOString()
            });
        }
        return differences;
    }

    // 3. Handle Arrays
    if (Array.isArray(val1) && Array.isArray(val2)) {
        if (val1.length !== val2.length) {
            differences.push({
                path: currentPath,
                type: 'Array Length Mismatch',
                value1: `Length ${val1.length}`,
                value2: `Length ${val2.length}`
            });
            // Continue checking elements up to the minimum length
        }

        const len = Math.min(val1.length, val2.length);
        for (let i = 0; i < len; i++) {
            deepCompare(val1[i], val2[i], `${currentPath}[${i}]`, differences);
        }
        return differences;
    }

    // If one is an array and the other is not (and types were already the same, e.g. 'object')
    if (Array.isArray(val1) !== Array.isArray(val2)) {
        differences.push({
            path: currentPath || 'root',
            type: 'Type Mismatch (Array vs Object)',
            value1: Array.isArray(val1) ? 'Array' : 'Object',
            value2: Array.isArray(val2) ? 'Array' : 'Object'
        });
        return differences;
    }

    // 4. Handle Objects (including function types which fall through here but are handled below)
    if (typeof val1 === 'object' && typeof val2 === 'object') {
        const keys1 = Object.keys(val1);
        const keys2 = Object.keys(val2);
        const allKeys = new Set([...keys1, ...keys2]);

        for (const key of allKeys) {
            const newPath = currentPath ? `${currentPath}.${key}` : key;

            if (!keys1.includes(key)) {
                differences.push({
                    path: newPath,
                    type: 'Missing Key in Object 1',
                    value1: 'N/A',
                    value2: val2[key]
                });
            } else if (!keys2.includes(key)) {
                differences.push({
                    path: newPath,
                    type: 'Missing Key in Object 2',
                    value1: val1[key],
                    value2: 'N/A'
                });
            } else {
                // Key exists in both, recurse
                deepCompare(val1[key], val2[key], newPath, differences);
            }
        }
        return differences;
    }

    // 5. Fallback for non-identical functions, symbols, or other complex types not explicitly handled
    // We already checked val1 === val2, so if we reach here and it's not null/array/object/date, it's a difference.
    differences.push({
        path: currentPath || 'root',
        type: 'Type/Value Mismatch (Final Fallback)',
        value1: val1,
        value2: val2
    });
    return differences;
}

/**
 * Takes two objects, performs a deep comparison, and logs the result
 * including an assertion and detailed differences if necessary.
 *
 * @param {string} title A title for the test case.
 * @param {Object} a The first object.
 * @param {Object} b The second object.
 */
function assertDeepEqual(title, a, b) {
    const differences = deepCompare(a, b);
    const areEqual = differences.length === 0;

    console.log(`\n--- Test Case: ${title} ---`);

    if (areEqual) {
        console.assert(true, `SUCCESS: Objects are deeply equal.`);
        console.log(`Assertion Passed: Objects are identical.`);
    } else {
        // Use console.assert(false) to trigger an assertion failure log
        console.assert(false, `FAILURE: Objects are different. See diff report below.`);
        console.log(`\x1b[31mAssertion Failed:\x1b[0m Objects are different at ${differences.length} location(s).`); // Red text for failure

        console.log('\x1b[33m\nDifference Report:\x1b[0m'); // Yellow text for report header
        differences.forEach(diff => {
            console.log(`
  \x1b[36mPath:\x1b[0m ${diff.path}
  \x1b[36mType:\x1b[0m ${diff.type}
  \x1b[36mValue 1:\x1b[0m`, diff.value1, `(Type: ${typeof diff.value1})
  \x1b[36mValue 2:\x1b[0m`, diff.value2, `(Type: ${typeof diff.value2})
  --------------------------------------------------`);
        });
    }
}

module.exports = {
    makePostRequest,
    assertDeepEqual,
    deepCompare
}