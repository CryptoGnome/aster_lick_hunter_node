#!/usr/bin/env node
 

const fs = require('fs');
const path = require('path');

// Load configuration to get ports
function getConfigPorts() {
  const configPath = path.join(__dirname, '..', 'config.user.json');
  const defaultConfigPath = path.join(__dirname, '..', 'config.default.json');

  let config = {};

  // Try to load user config first, then fall back to default
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else if (fs.existsSync(defaultConfigPath)) {
      config = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading config:', error.message);
  }

  const dashboardPort = config.global?.server?.dashboardPort || 3000;
  const websocketPort = config.global?.server?.websocketPort || 8080;

  return {
    dashboardPort,
    websocketPort
  };
}

// If run directly, output the ports
if (require.main === module) {
  const ports = getConfigPorts();
  console.log(JSON.stringify(ports));
}

module.exports = { getConfigPorts };