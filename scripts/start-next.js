#!/usr/bin/env node
 

const { spawn } = require('child_process');
const { getConfigPorts } = require('./get-config-ports');

// Get mode from command line arguments
const mode = process.argv[2] || 'dev';
const { dashboardPort } = getConfigPorts();

console.log(`Starting Next.js on port ${dashboardPort}...`);

// Set the PORT environment variable
process.env.PORT = String(dashboardPort);

// Determine the command based on mode
const isWindows = process.platform === 'win32';

let command;
let args;

if (isWindows) {
  // On Windows, use npx with shell
  command = 'npx';
  args = mode === 'start'
    ? ['next', 'start', '-p', String(dashboardPort)]
    : ['next', 'dev', '--turbopack', '-p', String(dashboardPort)];
} else {
  // On Unix, use npx directly
  command = 'npx';
  args = mode === 'start'
    ? ['next', 'start', '-p', String(dashboardPort)]
    : ['next', 'dev', '--turbopack', '-p', String(dashboardPort)];
}

// Spawn the Next.js process
const nextProcess = spawn(command, args, {
  stdio: 'inherit',
  shell: isWindows, // Use shell on Windows
  env: process.env
});

// Handle spawn errors
nextProcess.on('error', (err) => {
  console.error('Failed to start Next.js:', err);
  process.exit(1);
});

// Handle process exit
nextProcess.on('exit', (code) => {
  process.exit(code || 0);
});

// Pass through signals to the Next.js process
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
  process.on(signal, () => {
    if (!nextProcess.killed) {
      nextProcess.kill(signal);
    }
  });
});