#!/usr/bin/env node
 

const fs = require('fs').promises;
const path = require('path');
const { setupEnvFile } = require('./postinstall');

const CONFIG_USER_FILE = 'config.user.json';
const CONFIG_LEGACY_FILE = 'config.json';
const CONFIG_DEFAULT_FILE = 'config.default.json';

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function setupNextAuthSecret() {
  try {
    // Use shared env setup logic from postinstall.js
    await setupEnvFile();
  } catch (error) {
    console.error('⚠️  Warning: Failed to setup NEXTAUTH_SECRET:', error.message);
    console.log('   Please manually add NEXTAUTH_SECRET to your .env.local file');
    console.log('   Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  }
}

async function setupConfig() {
  console.log('🔧 Setting up configuration...\n');

  // First, setup NextAuth secret
  await setupNextAuthSecret();

  const userConfigPath = path.join(process.cwd(), CONFIG_USER_FILE);
  const legacyConfigPath = path.join(process.cwd(), CONFIG_LEGACY_FILE);
  const defaultConfigPath = path.join(process.cwd(), CONFIG_DEFAULT_FILE);

  // Check if user config already exists
  if (await fileExists(userConfigPath)) {
    console.log('✅ config.user.json already exists');
    return;
  }

  // Check for legacy config
  if (await fileExists(legacyConfigPath)) {
    console.log('📦 Found existing config.json, migrating to config.user.json...');

    try {
      const legacyData = await fs.readFile(legacyConfigPath, 'utf8');
      const legacyConfig = JSON.parse(legacyData);

      // Add version if missing
      if (!legacyConfig.version) {
        legacyConfig.version = '1.0.0';
      }

      // Save as user config
      await fs.writeFile(userConfigPath, JSON.stringify(legacyConfig, null, 2), 'utf8');

      console.log('✅ Successfully migrated config.json to config.user.json');
      console.log('\n⚠️  IMPORTANT: config.json is no longer tracked by git');
      console.log('   Your API keys are now safe in config.user.json\n');

      // Check if config.json is tracked by git
      try {
        const { execSync } = require('child_process');
        execSync('git ls-files --error-unmatch config.json', { stdio: 'ignore' });

        console.log('📝 To complete the migration, run:');
        console.log('   git rm --cached config.json');
        console.log('   git commit -m "Remove config.json from tracking"\n');
      } catch {
        // config.json is not tracked, which is good
      }
    } catch (error) {
      console.error('❌ Failed to migrate config:', error.message);
      process.exit(1);
    }
  } else {
    console.log('🔨 No existing config found, creating from defaults...');

    try {
      // Read default config
      const defaultData = await fs.readFile(defaultConfigPath, 'utf8');
      const defaultConfig = JSON.parse(defaultData);

      // Clear API keys for new user
      defaultConfig.api = {
        apiKey: '',
        secretKey: ''
      };

      // Save as user config
      await fs.writeFile(userConfigPath, JSON.stringify(defaultConfig, null, 2), 'utf8');

      console.log('✅ Created config.user.json with default settings');
      console.log('\n📝 Next steps:');
      console.log('   1. Edit config.user.json and add your API keys');
      console.log('   2. Configure your trading symbols and parameters');
      console.log('   3. Set paperMode to false when ready for live trading\n');
    } catch (error) {
      console.error('❌ Failed to create config:', error.message);
      process.exit(1);
    }
  }
}

// Run setup
setupConfig().catch(error => {
  console.error('Setup failed:', error);
  process.exit(1);
});