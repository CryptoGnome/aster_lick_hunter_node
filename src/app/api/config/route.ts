import { NextResponse } from 'next/server';
import { Config } from '@/lib/types';
import { configLoader } from '@/lib/config/configLoader';
import { configSchema } from '@/lib/config/types';


export async function GET() {
  try {
    // Use the config loader to get current config
    let config = configLoader.getConfig();

    // If not loaded yet, load it
    if (!config) {
      config = await configLoader.loadConfig();
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error('Failed to load config:', error);

    // Return default config if loading fails
    const defaultConfig: Config = {
      api: {
        apiKey: '',
        secretKey: '',
      },
      global: {
        riskPercent: 2,
        paperMode: true,
        positionMode: 'HEDGE',
        maxOpenPositions: 10,
        server: {
          dashboardPassword: 'admin',
          dashboardPort: 3000,
          websocketPort: 8080,
          useRemoteWebSocket: false,
          websocketHost: null
        }
      },
      symbols: {},
      version: '1.0.0',
    };

    return NextResponse.json(defaultConfig);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate config
    const validatedConfig = configSchema.parse(body);

    // Save using the config loader (saves to user config)
    await configLoader.saveConfig(validatedConfig);

    return NextResponse.json({ success: true, config: validatedConfig });
  } catch (error: any) {
    console.error('Failed to save config:', error);
    return NextResponse.json(
      { error: 'Failed to save config', details: error.message },
      { status: 500 }
    );
  }
}