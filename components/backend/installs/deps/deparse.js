const fs = require('fs');
const path = require('path');

const deps = JSON.parse(fs.readFileSync(path.join(__dirname, 'dependencies.json'), 'utf8'));

// Flatten nested object into single-level key-value map
function flatten(obj, prefix = '') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
            Object.assign(result, flatten(value, fullKey));
        } else {
            result[key] = value;
            result[fullKey] = value;
        }
    }
    return result;
}

const lookup = flatten(deps);

// Search: returns the string value for a key
function search(key) {
    return lookup[key] ?? null;
}

// Parse: resolves #-references recursively
function parse(key) {
    let value = search(key);
    if (value === null) return null;
    
    const visited = new Set([key]);
    while (typeof value === 'string' && value.startsWith('#')) {
        const refKey = value.slice(1).trim();
        if (visited.has(refKey)) return null; // circular reference guard
        visited.add(refKey);
        value = search(refKey);
        if (value === null) return null;
    }
    return value;
}

module.exports = { search, parse };