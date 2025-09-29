#!/usr/bin/env node
 

const fs = require('fs');
const path = require('path');
const { setupEnvFile } = require('./postinstall');

const ENV_LOCAL_FILE = '.env.local';

async function checkAndSetupEnv() {
  const envPath = path.join(process.cwd(), ENV_LOCAL_FILE);

  // Check if .env.local exists
  if (!fs.existsSync(envPath)) {
    console.log('⚠️  .env.local not found, creating it...');
    await setupEnvFile();
  }
}

// Run the check
checkAndSetupEnv().catch(error => {
  console.error('Failed to setup environment:', error);
  // Don't exit with error - let the app try to run anyway
});