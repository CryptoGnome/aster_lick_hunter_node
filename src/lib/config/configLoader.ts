import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { Config, configSchema } from './types';
import { DEFAULT_CONFIG, DEFAULT_CONFIG_VERSION } from './defaults';
import { migrateConfig, needsMigration, addMissingFields } from './migrator';

const CONFIG_USER_FILE = 'config.user.json';
const CONFIG_LEGACY_FILE = 'config.json';
const CONFIG_DEFAULT_FILE = 'config.default.json';

export class ConfigLoader {
  private static instance: ConfigLoader;
  private config: Config | null = null;
  private userConfigPath: string;
  private legacyConfigPath: string;
  private defaultConfigPath: string;

  private constructor() {
    this.userConfigPath = path.join(process.cwd(), CONFIG_USER_FILE);
    this.legacyConfigPath = path.join(process.cwd(), CONFIG_LEGACY_FILE);
    this.defaultConfigPath = path.join(process.cwd(), CONFIG_DEFAULT_FILE);
  }

  static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  async loadConfig(): Promise<Config> {
    try {
      // Check for existing user config
      const userConfigExists = await this.fileExists(this.userConfigPath);

      if (!userConfigExists) {
        // Check for legacy config.json
        const legacyConfigExists = await this.fileExists(this.legacyConfigPath);

        if (legacyConfigExists) {
          console.log('📦 Found legacy config.json, migrating to config.user.json...');
          await this.migrateLegacyConfig();
        } else {
          console.log('🔨 No user config found, creating from defaults...');
          await this.createUserConfig();
        }
      }

      // Load user config
      const userConfigData = await fs.readFile(this.userConfigPath, 'utf8');
      let userConfig = JSON.parse(userConfigData);

      // Check if migration is needed
      if (needsMigration(userConfig)) {
        console.log('🔄 Config needs migration, updating...');
        userConfig = migrateConfig(userConfig, DEFAULT_CONFIG_VERSION);
        await this.saveUserConfig(userConfig);
      }

      // Load default config for field merging
      let defaultConfig = DEFAULT_CONFIG;
      const defaultConfigExists = await this.fileExists(this.defaultConfigPath);
      if (defaultConfigExists) {
        const defaultConfigData = await fs.readFile(this.defaultConfigPath, 'utf8');
        defaultConfig = JSON.parse(defaultConfigData);
      }

      // Add any missing fields from defaults
      userConfig = addMissingFields(userConfig, defaultConfig);

      // Apply environment variable overrides
      this.applyEnvironmentOverrides(userConfig);

      // Validate the final config
      const validated = configSchema.parse(userConfig);

      // Validate API keys only if not in paper mode
      if (!validated.global.paperMode) {
        if (!validated.api.apiKey || !validated.api.secretKey) {
          throw new Error('API keys are required when not in paper mode');
        }
        if (validated.api.apiKey.length !== 64 || validated.api.secretKey.length !== 64) {
          throw new Error('API keys must be 64 characters when not in paper mode');
        }
      }

      // Save if fields were added
      if (JSON.stringify(userConfig) !== JSON.stringify(JSON.parse(userConfigData))) {
        await this.saveUserConfig(userConfig);
        console.log('✅ User config updated with new fields');
      }

      this.config = validated;
      return validated;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Config validation error:\n${details}`);
      }
      if (error instanceof Error) {
        throw new Error(`Failed to load config: ${error.message}`);
      }
      throw new Error('Failed to load config: Unknown error');
    }
  }

  private async migrateLegacyConfig(): Promise<void> {
    try {
      // Read legacy config
      const legacyData = await fs.readFile(this.legacyConfigPath, 'utf8');
      let legacyConfig = JSON.parse(legacyData);

      // Apply migrations
      legacyConfig = migrateConfig(legacyConfig, DEFAULT_CONFIG_VERSION);

      // Save as user config
      await this.saveUserConfig(legacyConfig);

      console.log('✅ Successfully migrated config.json to config.user.json');
      console.log('⚠️  Please remove config.json from git tracking with:');
      console.log('    git rm --cached config.json');
      console.log('    git add config.user.json');
    } catch (error) {
      throw new Error(`Failed to migrate legacy config: ${error}`);
    }
  }

  private async createUserConfig(): Promise<void> {
    // Create a user config from defaults
    const userConfig = {
      ...DEFAULT_CONFIG,
      api: {
        apiKey: '',
        secretKey: '',
      },
    };

    await this.saveUserConfig(userConfig);
    console.log('✅ Created config.user.json with default settings');
    console.log('📝 Please update config.user.json with your API keys');
  }

  private async saveUserConfig(config: any): Promise<void> {
    await fs.writeFile(this.userConfigPath, JSON.stringify(config, null, 2), 'utf8');
  }

  async saveConfig(config: Config): Promise<void> {
    // Always save to user config
    await this.saveUserConfig(config);
    this.config = config;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private applyEnvironmentOverrides(config: any): void {
    // Apply WebSocket host environment variable override
    if (process.env.NEXT_PUBLIC_WS_HOST) {
      if (!config.global) config.global = {};
      if (!config.global.server) config.global.server = {};
      config.global.server.envWebSocketHost = process.env.NEXT_PUBLIC_WS_HOST;
      console.log('Applied WebSocket host environment override:', process.env.NEXT_PUBLIC_WS_HOST);
    }
  }

  getConfig(): Config | null {
    return this.config;
  }

  getUserConfigPath(): string {
    return this.userConfigPath;
  }
}

export const configLoader = ConfigLoader.getInstance();