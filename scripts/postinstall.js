#!/usr/bin/env node
 

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const ENV_LOCAL_FILE = '.env.local';
const ENV_EXAMPLE_FILE = '.env.example';

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function setupEnvFile() {
  const envLocalPath = path.join(process.cwd(), ENV_LOCAL_FILE);
  const envExamplePath = path.join(process.cwd(), ENV_EXAMPLE_FILE);

  try {
    // Check if .env.local already exists
    if (await fileExists(envLocalPath)) {
      // File exists, check what's missing
      let content = await fs.readFile(envLocalPath, 'utf8');
      let modified = false;

      // Check for NEXTAUTH_SECRET - look for the key, not just if it includes it
      const hasNextAuthSecret = /^NEXTAUTH_SECRET=.+$/m.test(content);
      if (!hasNextAuthSecret) {
        const secret = crypto.randomBytes(32).toString('base64');
        content += (content && !content.endsWith('\n') ? '\n' : '') + `NEXTAUTH_SECRET=${secret}\n`;
        modified = true;
      }

      // Check for NEXTAUTH_URL - look for the key, not just if it includes it
      const hasNextAuthUrl = /^NEXTAUTH_URL=.+$/m.test(content);
      if (!hasNextAuthUrl) {
        content += (content && !content.endsWith('\n') ? '\n' : '') + `NEXTAUTH_URL=http://localhost:3000\n`;
        modified = true;
      }

      if (modified) {
        await fs.writeFile(envLocalPath, content, 'utf8');
        console.log('✅ Updated .env.local with missing environment variables');
      }
      return;
    }

    // .env.local doesn't exist, create it
    const secret = crypto.randomBytes(32).toString('base64');
    let envContent = `NEXTAUTH_SECRET=${secret}\nNEXTAUTH_URL=http://localhost:3000\n`;

    // If .env.example exists, copy its content (excluding auth-related lines that we already added)
    if (await fileExists(envExamplePath)) {
      const exampleContent = await fs.readFile(envExamplePath, 'utf8');
      const lines = exampleContent.split('\n');
      const filteredLines = lines.filter(line =>
        !line.trim().startsWith('NEXTAUTH_SECRET=') &&
        !line.trim().startsWith('NEXTAUTH_URL=') &&
        !line.includes('your-secret-key-change-in-production') &&
        !line.includes('http://localhost:3000')
      );

      // Add example content as comments/reference
      if (filteredLines.some(line => line.trim().length > 0)) {
        envContent += '\n' + filteredLines.join('\n');
      }
    }

    await fs.writeFile(envLocalPath, envContent, 'utf8');
    console.log('✅ Created .env.local with NEXTAUTH_SECRET');
    console.log('   Your application is now ready to run!');

  } catch (error) {
    // Silent fail - don't break npm install
    // Users will see a more helpful error when they try to run the app
    if (process.env.NODE_ENV !== 'production') {
      console.warn('⚠️  Note: Could not auto-generate .env.local:', error.message);
      console.warn('   Run "npm run setup:config" to create it manually');
    }
  }
}

// Only run if this is the main script (not when required)
if (require.main === module) {
  // Run silently to avoid cluttering npm install output
  setupEnvFile().catch(() => {
    // Silent fail for postinstall
  });
}

module.exports = { setupEnvFile, fileExists };