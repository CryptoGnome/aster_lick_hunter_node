#!/usr/bin/env node
 
 

const { spawn } = require('child_process');
const os = require('os');
const { killProcessTree } = require('./kill-process-tree');

// Store all child processes
const childProcesses = new Set();
let mainProcess = null;
let isShuttingDown = false;
const SHUTDOWN_TIMEOUT = 10000; // 10 seconds max for graceful shutdown

// Determine the command to run based on arguments
const mode = process.argv[2] || 'dev';
const isWindows = os.platform() === 'win32';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}[ProcessManager] ${message}${colors.reset}`);
}

// Clean up all child processes
async function cleanup(signal = 'SIGTERM') {
  if (isShuttingDown) {
    log('Already shutting down...', 'yellow');
    return;
  }

  isShuttingDown = true;
  log(`Received ${signal}, starting graceful shutdown...`, 'yellow');

  // Set a timeout to force kill if graceful shutdown takes too long
  const forceKillTimeout = setTimeout(() => {
    log('Graceful shutdown timeout, forcing exit...', 'red');
    killAllProcesses('SIGKILL');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  try {
    // Kill main process and its tree
    if (mainProcess && !mainProcess.killed && mainProcess.pid) {
      log(`Stopping main process tree (PID: ${mainProcess.pid})...`, 'cyan');

      // Use the killProcessTree function for better cross-platform support
      await new Promise((resolve) => {
        killProcessTree(mainProcess.pid, signal, (err) => {
          if (err) {
            log(`Warning: Error killing process tree: ${err.message}`, 'yellow');
          }
          resolve();
        });
      });

      // Wait a bit for processes to clean up
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Kill any remaining child processes
    killAllProcesses(signal);

    // Clear the timeout since we're done
    clearTimeout(forceKillTimeout);

    log('All processes stopped successfully', 'green');
    process.exit(0);
  } catch (error) {
    log(`Error during cleanup: ${error.message}`, 'red');
    clearTimeout(forceKillTimeout);
    process.exit(1);
  }
}

function killAllProcesses(signal = 'SIGTERM') {
  childProcesses.forEach(child => {
    if (!child.killed && child.pid) {
      try {
        // Use killProcessTree for better cleanup
        killProcessTree(child.pid, signal, (err) => {
          if (err) {
            // Process might already be dead
          }
        });
      } catch (_e) {
        // Process might already be dead
      }
    }
  });
  childProcesses.clear();
}

// Register process cleanup handlers
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];
signals.forEach(signal => {
  process.on(signal, () => cleanup(signal));
});

// Handle process exit
process.on('exit', (code) => {
  if (!isShuttingDown) {
    log(`Process exiting with code ${code}`, code === 0 ? 'green' : 'red');
    killAllProcesses('SIGKILL');
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`, 'red');
  console.error(error);
  cleanup('SIGTERM');
});

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled rejection: ${reason}`, 'red');
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  cleanup('SIGTERM');
});

// Start the main process
function startMainProcess() {
  const npm = isWindows ? 'npm.cmd' : 'npm';
  const args = ['run', mode === 'start' ? 'start:direct' : 'dev:direct'];

  log(`Starting processes in ${mode} mode...`, 'blue');

  // Spawn with appropriate options for each platform
  const spawnOptions = {
    stdio: 'inherit',
    shell: isWindows, // Use shell on Windows
    windowsHide: false
  };

  // On Unix-like systems, create a new process group
  if (!isWindows) {
    spawnOptions.detached = true;
  }

  mainProcess = spawn(npm, args, spawnOptions);

  // Track the main process
  childProcesses.add(mainProcess);

  mainProcess.on('error', (error) => {
    log(`Failed to start process: ${error.message}`, 'red');
    cleanup('SIGTERM');
  });

  mainProcess.on('exit', (code, signal) => {
    if (!isShuttingDown) {
      if (code !== null) {
        log(`Main process exited with code ${code}`, code === 0 ? 'green' : 'red');
      } else if (signal) {
        log(`Main process killed by signal ${signal}`, 'yellow');
      }
      cleanup('SIGTERM');
    }
  });

  // Keep track of any child processes spawned by the main process
  if (!isWindows && mainProcess.pid) {
    // On Unix-like systems, we can track the process group
    process.on('SIGCHLD', () => {
      // Child process state changed
    });
  }
}

// Main execution
log('Process Manager starting...', 'cyan');
log(`Platform: ${os.platform()}, Mode: ${mode}`, 'cyan');

// Start the processes
startMainProcess();

// Keep the process alive
process.stdin.resume();