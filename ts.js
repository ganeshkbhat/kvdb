// To run this:
// 1. Make sure Node.js is installed.
// 2. Run: npm init -y
// 3. Run: npm install express
// 4. Save this code as 'server.js'
// 5. Run: node server.js

const express = require('express');
const app = express();
const PORT = 3000;

// Middleware to parse incoming JSON request bodies
app.use(express.json());

// -----------------------------------------------------------------------------
// --- JsonManager Implementation (Embedded from user's provided code)
// --- Adapted for in-memory use (file system methods removed)
// -----------------------------------------------------------------------------

/**
 * Helper function to determine if a term matches the criteria based on options (Exact, Like, Regex).
 * @param {any} term The key or value to test.
 * @param {string|RegExp|Array} criteria The search term(s).
 * @param {object} options Search options ({ like: boolean, regex: boolean }).
 * @returns {boolean} True if the term matches the criteria.
 */
function isMatch(term, criteria, options) {
    if (options.regex && criteria instanceof RegExp) {
        return criteria.test(String(term));
    } else if (options.regex) {
        try {
            // Using 'i' for case-insensitive regex search
            const regex = new RegExp(criteria, 'i');
            return regex.test(String(term));
        } catch (e) {
            console.error("Invalid regex criteria:", e);
            return false;
        }
    } else if (options.like) {
        // Partial matching (like), converted to string and lowercase for case-insensitive partial search
        const termStr = String(term).toLowerCase();
        const criteriaStr = String(criteria).toLowerCase();
        return termStr.includes(criteriaStr);
    } else {
        // Exact match
        return term === criteria;
    }
}

/**
 * Searches ONLY the keys or ONLY the values of the object and returns the full key/value pairs that match.
 * @param {object} data The internal data store (key is ID, value is the item properties).
 * @param {string|RegExp} criteria The search term.
 * @param {object} [options={ like: false, regex: false }] Search options.
 * @returns {Array<{key: string, value: any}>} An array of objects where the key/value matches the criteria.
 */
function searchKeys(data, criteria, options = { like: false, regex: false }) {
    const results = [];
    for (const [key, value] of Object.entries(data)) {
        if (isMatch(key, criteria, options)) {
            results.push({ key, value });
        }
    }
    return results;
}

function searchValues(data, criteria, options = { like: false, regex: false }) {
    const results = [];
    const entries = Object.entries(data);

    for (const [key, value] of entries) {
        let isValueMatch = false;

        // Since the value is an object of properties (e.g., {name: "Project"}),
        // we check if the search criteria matches any property value in that object.
        if (typeof value === 'object' && value !== null) {
            for (const nestedValue of Object.values(value)) {
                // Check if the nested value is a complex object/array and handle by matching the criteria
                // For simplicity in this implementation, we rely on isMatch to coerce to string and compare
                if (isMatch(nestedValue, criteria, options)) {
                    isValueMatch = true;
                    break;
                }
            }
        } else if (isMatch(value, criteria, options)) {
            isValueMatch = true;
        }

        if (isValueMatch) {
            results.push({ key, value });
        }
    }

    return results;
}


/**
 * JsonManager - A simple in-memory key-value store.
 * @return {*}
 */
function JsonManager() {
    let data = {};

    function write(key, value) {
        data[key] = value;
    }

    function getKey(key) {
        return data[key];
    }

    function read(key) {
        return data[key];
    }

    function dump() {
        return { ...data };
    }

    function deleteKey(key) {
        try {
            delete data[key];
            return true;
        } catch (e) {
            return false;
        }
    }

    function init(obj = {}) {
        data = obj;
        return data;
    }

    function update(obj) {
        data = { ...data, ...obj };
        return data;
    }

    return {
        read,
        write,
        update,
        dump,
        init,
        getKey,
        deleteKey,
        // Using simplified searchKeys/searchValues from above, passing internal data
        searchKeys: (criteria, options) => searchKeys(data, criteria, options),
        searchValues: (criteria, options) => searchValues(data, criteria, options),
    }
}

// -----------------------------------------------------------------------------
// --- Manager Initialization and Setup
// -----------------------------------------------------------------------------

const manager = JsonManager();

// Initial data loaded into the manager: Key is the ID (string), value contains NO ID.
manager.init({
    'alpha': { name: "Project Alpha", status: "Pending" },
    'beta': { name: "Task Beta", status: "Completed" },
    'gamma': { name: "Module Gamma", status: "In Progress" }
});

// -----------------------------------------------------------------------------
// --- Utility Function
// -----------------------------------------------------------------------------

/**
 * Converts the manager's key-value object store into an array of full data objects
 * by mapping the key (ID) back into the value object.
 * @param {object} dataObject The object returned by manager.dump()
 * @returns {Array<object>} The array of data items, each including the 'id' property.
 */
function managerDataToArray(dataObject) {
    return Object.entries(dataObject).map(([idKey, itemValue]) => ({
        id: idKey, // Reinsert the ID (key) from the internal store
        ...itemValue
    }));
}

// -----------------------------------------------------------------------------
// --- API Router using JsonManager
// -----------------------------------------------------------------------------

/**
 * The single-entry-point API route handler.
 * It reads the 'event' key from the POST body to dispatch the correct action.
 */
app.post('/', (req, res) => {
    // Separate the event, id (the key), and the rest of the data.
    const { event, id, ...data } = req.body;

    // Check if the 'event' key is provided
    if (!event) {
        return res.status(400).json({ error: "Missing required 'event' key in request body." });
    }

    try {
        switch (event.toLowerCase()) {
            case 'create':
            case 'set':
                // Create (Set) Operation: Client MUST provide a unique ID as the key.
                if (!id) {
                    return res.status(400).json({ error: "Missing required 'id' key for create/set event (The ID field is the key for the key-value store)." });
                }

                const idKey = String(id);
                // Check for key collision
                if (manager.getKey(idKey)) {
                    return res.status(409).json({ error: `Key '${idKey}' already exists. Use 'update' event to modify it.` });
                }

                const itemToStore = { ...data }; // Store the payload properties (value)
                manager.write(idKey, itemToStore);

                // Prepare response: add the ID (key) back to the object for the client
                const newItem = { id: idKey, ...itemToStore };

                return res.status(201).json({
                    success: true,
                    message: `Item created with key ${idKey}`,
                    result: newItem
                });

            case 'read':
                // Read Operation: Get all items or a single item by ID.
                if (id) {
                    const idKey = String(id);
                    const itemValue = manager.getKey(idKey);
                    if (itemValue) {
                        // Reconstruct the full object for the response
                        const item = { id: idKey, ...itemValue };
                        return res.json({ success: true, result: item });
                    }
                    return res.status(404).json({ success: false, message: `Item with ID (key) '${idKey}' not found.` });
                }
                // Read All
                const allData = managerDataToArray(manager.dump());
                return res.json({ success: true, count: allData.length, result: allData });

            case 'update':
                // Update Operation: Find and modify an existing item by ID.
                if (!id) {
                    return res.status(400).json({ error: "Missing 'id' (key) for update event." });
                }
                const idKeyUpdate = String(id);
                const updateData = { ...data }; // The rest of the payload properties

                const existingItemValue = manager.getKey(idKeyUpdate);
                if (existingItemValue) {
                    // Merge existing value with new updateData (updateData contains no ID)
                    const updatedItemValue = { ...existingItemValue, ...updateData };
                    manager.write(idKeyUpdate, updatedItemValue); // Overwrite the existing value

                    // Prepare response by re-adding the ID (key)
                    const updatedItem = { id: idKeyUpdate, ...updatedItemValue };

                    return res.json({ success: true, message: `Item with ID (key) '${idKeyUpdate}' updated.`, result: updatedItem });
                }
                return res.status(404).json({ success: false, message: `Item with ID (key) '${idKeyUpdate}' not found for update.` });

            case 'delete':
                // Delete Operation: Remove an item by ID.
                if (!id) {
                    return res.status(400).json({ error: "Missing 'id' (key) for delete event." });
                }
                const idKeyDelete = String(id);
                const itemValueToDelete = manager.getKey(idKeyDelete);

                if (itemValueToDelete) {
                    manager.deleteKey(idKeyDelete);
                    // Prepare response by re-adding the ID (key) of the deleted item
                    const itemToDelete = { id: idKeyDelete, ...itemValueToDelete };
                    return res.json({ success: true, message: `Item with ID (key) '${idKeyDelete}' deleted.`, result: itemToDelete });
                }
                return res.status(404).json({ success: false, message: `Item with ID (key) '${idKeyDelete}' not found for deletion.` });

            case 'search':
                // Search Operation: Perform a 'like' search against all item properties (name, status, etc.).
                if (!data.query) {
                    return res.status(400).json({ error: "Missing 'query' for search event." });
                }

                // Search the internal values (objects without ID)
                const searchResultsKV = searchValues(manager.dump(), data.query, { like: true, regex: false });

                // The search returns an array of {key: 'idKey', value: {itemValue}}.
                // Map the key (ID) back into the value object for the final result.
                const searchResults = searchResultsKV.map(result => ({
                    id: result.key, // Reinsert ID (key) from key
                    ...result.value
                }));

                return res.json({ success: true, count: searchResults.length, result: searchResults });

            default:
                // Handle unknown event types
                return res.status(400).json({ error: `Unknown event type: ${event}` });
        }
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: "Internal server error during processing." });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Using JsonManager for data storage as a strict key-value store.`);
    console.log(`Use POST requests to http://localhost:${PORT} with an 'event' key in the JSON body.`);
});

/**
 * --- Example Request Bodies (POST to http://localhost:3000 with Content-Type: application/json) ---
 * * 1. CREATE/SET (The client provides the key 'id' and the value properties):
 * { "event": "create", "id": "task_401", "name": "New Report", "status": "Draft" }
 * * 2. READ ALL:
 * { "event": "read" }
 * * 3. READ SINGLE:
 * { "event": "read", "id": "alpha" }
 * * 4. UPDATE:
 * { "event": "update", "id": "alpha", "status": "Completed" }
 * * 5. DELETE:
 * { "event": "delete", "id": "beta" }
 * * 6. SEARCH:
 * { "event": "search", "query": "Project" }
 */