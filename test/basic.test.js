const assert = require('assert');

// Simple sanity test for CI
console.log('Running basic sanity tests...');

try {
    // Check if core modules can be required
    const indexer = require('../lib/indexer');
    assert.strictEqual(typeof indexer.createDb, 'function', 'createDb should be a function');
    console.log('✓ Successfully required lib/indexer and verified createDb function.');
    
    // You can add more basic checks here
    
    console.log('All tests passed!');
    process.exit(0);
} catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
}
