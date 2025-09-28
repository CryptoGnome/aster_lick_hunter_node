#!/usr/bin/env node
 
 

const { exec } = require('child_process');
const os = require('os');

/**
 * Kill a process and all its children across platforms
 * @param {number} pid - The process ID to kill
 * @param {string} signal - The signal to send (default: SIGTERM)
 */
function killProcessTree(pid, signal = 'SIGTERM', callback) {
  const isWindows = os.platform() === 'win32';

  if (isWindows) {
    // On Windows, use taskkill with /T flag to kill process tree
    exec(`taskkill /PID ${pid} /T /F`, (err) => {
      if (callback) {
        if (err && err.code !== 128) {
          // Code 128 means process not found, which is OK
          callback(err);
        } else {
          callback(null);
        }
      }
    });
  } else {
    // On Unix-like systems, find all child processes and kill them
    exec(`ps -o pid --no-headers --ppid ${pid}`, (err, stdout) => {
      if (err && err.code !== 1) {
        // Code 1 means no child processes found
        if (callback) callback(err);
        return;
      }

      const childPids = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

      // Kill all children first
      childPids.forEach(childPid => {
        killProcessTree(parseInt(childPid), signal);
      });

      // Then kill the parent
      try {
        process.kill(pid, signal);
      } catch (_e) {
        // Process might already be dead
      }

      if (callback) callback(null);
    });
  }
}

module.exports = { killProcessTree };

// If run directly from command line
if (require.main === module) {
  const pid = parseInt(process.argv[2]);
  if (!pid) {
    console.error('Usage: node kill-process-tree.js <pid>');
    process.exit(1);
  }

  killProcessTree(pid, 'SIGTERM', (err) => {
    if (err) {
      console.error('Error killing process tree:', err);
      process.exit(1);
    } else {
      console.log(`Successfully killed process tree for PID ${pid}`);
      process.exit(0);
    }
  });
}