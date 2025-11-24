const http = require('http');
const assert = require('assert');
const sinon = require('sinon');
// We assume 'chai' is available in the testing environment.
const { expect } = require('chai');

const {
    makePostRequest,
    assertDeepEqual,
    deepCompare
} = require("../test/post.functions.js")



// --- 3. Mocha Test Suite ---
describe('API Sequence Testing: Payloads and Expected Responses', () => {
    let allTestScenarios = [
        "./payloads.delete.json",
        "./payloads.dump.json"
    ]
    allTestScenarios.forEach(scenario => {
        var testSequenceData = require(scenario)
        // Get all test keys in order to maintain execution sequence
        var testKeys = Object.keys(testSequenceData);

        // Use an asynchronous loop to execute tests sequentially
        for (const key of testKeys) {
            const testCase = testSequenceData[key];

            // Create a separate 'it' block for each test case
            it(`Case ${key}: ${testCase.payload.event} ${testCase.description}`, async () => {
                const host = 'localhost'; // A public API for testing
                const port = 7000;
                const payload = testCase.payload;
                const expected = JSON.parse(JSON.stringify(testCase.response));



                // --- New: Custom options for the request ---
                const customOptions = {
                    timeout: 5000, // Example: Set a 5 second timeout
                    headers: {
                        // 'X-Custom-Auth': 'Bearer 12345' // Example: Add a custom header
                    }
                };

                // 1. Send the payload using the (mocked) post function
                const actualResponse = await makePostRequest(host, port, '/', testSequenceData[key]["payload"], customOptions);
                const response = JSON.parse(actualResponse)
                // 2. Assert that the actual response deeply matches the expected response object
                // Chai's 'deep.equal' performs a recursive comparison of the object properties.
                expect(response).to.deep.equal(testSequenceData[key].response,
                    `Expected response for Case ${key} to match, but objects were different.`
                );
            });
        }
    })

});



// runExample(); // Uncomment this line to run the example function

module.exports = {
    makePostRequest
};

// If you run this file directly via `node post_request.js`, the example will execute.
if (require.main === module) {
    runExample();
}
