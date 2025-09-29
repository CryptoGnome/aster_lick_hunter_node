#!/usr/bin/env node
 

/**
 * Script to generate test errors for the error logging system
 * Usage: npm run test:errors (add this to package.json)
 * or: node scripts/generate-test-errors.js
 */

const http = require('http');

function makeRequest(method, path, callback) {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: path,
    method: method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      callback(null, JSON.parse(data));
    });
  });

  req.on('error', callback);
  req.end();
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || 'generate';

  console.log('================================');
  console.log('Error System Test Data Generator');
  console.log('================================\n');

  if (action === 'clear') {
    console.log('Clearing all test errors...');
    makeRequest('DELETE', '/api/errors/test', (err, result) => {
      if (err) {
        console.error('❌ Failed to clear errors:', err.message);
      } else {
        console.log('✅ Cleared all test errors');
        console.log(`   Deleted: ${result.deleted} errors\n`);
      }
    });
  } else {
    console.log('Generating test errors...');
    makeRequest('POST', '/api/errors/test', (err, result) => {
      if (err) {
        console.error('❌ Failed to generate errors:', err.message);
        console.log('\nMake sure the application is running with: npm run dev');
      } else {
        console.log('✅ Test errors generated successfully!');
        console.log(`   Generated: ${result.generated} errors`);
        console.log(`   Resolved: ${result.resolved} errors`);
        console.log(`   Session ID: ${result.sessionId}\n`);

        // Get statistics
        makeRequest('GET', '/api/errors/stats', (err, stats) => {
          if (!err && stats.stats) {
            console.log('Current Statistics:');
            console.log(`   Total errors: ${stats.stats.total}`);
            console.log(`   Recent (24h): ${stats.stats.recentCount}`);

            if (Object.keys(stats.stats.byType).length > 0) {
              console.log('\n   By Type:');
              Object.entries(stats.stats.byType).forEach(([type, count]) => {
                console.log(`     • ${type}: ${count}`);
              });
            }

            if (Object.keys(stats.stats.bySeverity).length > 0) {
              console.log('\n   By Severity:');
              Object.entries(stats.stats.bySeverity).forEach(([severity, count]) => {
                console.log(`     • ${severity}: ${count}`);
              });
            }
          }

          console.log('\n================================');
          console.log('View Error Dashboard');
          console.log('================================\n');
          console.log('Open http://localhost:3000/errors to see:');
          console.log('  • Error statistics dashboard');
          console.log('  • Various error types and severities');
          console.log('  • Filterable and searchable error list');
          console.log('  • Detailed error views with metadata');
          console.log('  • Some errors marked as resolved');
          console.log('  • Export functionality for bug reports\n');

          console.log('Commands:');
          console.log('  node scripts/generate-test-errors.js          # Generate test errors');
          console.log('  node scripts/generate-test-errors.js clear    # Clear all errors\n');
        });
      }
    });
  }
}

main();