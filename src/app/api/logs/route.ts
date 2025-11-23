import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';

interface LogEntry {
  id: string;
  timestamp: number;
  timestampFormatted: string;
  level: 'info' | 'warn' | 'error';
  component: string;
  message: string;
}

/**
 * Parse PM2 log line into structured format
 */
function parseLogLine(line: string): LogEntry | null {
  // Skip empty lines and web server logs
  if (!line.trim() || line.includes('[WEB]')) return null;

  // Extract timestamp: [HH:MM:SS.mmm]
  const timestampMatch = line.match(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\]/);
  if (!timestampMatch) return null;

  const timeStr = timestampMatch[1];
  const now = new Date();
  const [hours, minutes, secondsMs] = timeStr.split(':');
  const [seconds, milliseconds] = secondsMs.split('.');
  
  // Create a date object for today with the extracted time
  const timestamp = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    parseInt(hours),
    parseInt(minutes),
    parseInt(seconds),
    parseInt(milliseconds)
  );

  // Extract component from patterns like "ComponentName: message"
  let component = 'System';
  let message = line;
  
  const componentMatch = line.match(/\[BOT\].*?\](.+)/);
  if (componentMatch) {
    message = componentMatch[1].trim();
    const nameMatch = message.match(/^(\w+(?:Manager|Service)?)\s*:/);
    if (nameMatch) {
      component = nameMatch[1];
    }
  }

  // Determine log level
  let level: 'info' | 'warn' | 'error' = 'info';
  if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
    level = 'error';
  } else if (message.toLowerCase().includes('warn')) {
    level = 'warn';
  }

  // Generate a unique ID
  const id = `${timestamp.getTime()}_${Math.random().toString(36).substr(2, 9)}`;

  return {
    id,
    timestamp: timestamp.getTime(),
    timestampFormatted: timeStr,
    level,
    component,
    message
  };
}

/**
 * GET /api/logs
 * Fetch logs from PM2 with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const component = searchParams.get('component') || undefined;
    const level = searchParams.get('level') as 'info' | 'warn' | 'error' | undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 500;

    // Get PM2 logs
    const { stdout } = await execAsync(`pm2 logs aster --lines ${limit} --nostream --raw 2>&1 | grep "\\[BOT\\]"  || true`);
    
    const lines = stdout.split('\n').filter(l => l.trim());
    const parsedLogs = lines
      .map(parseLogLine)
      .filter((log): log is LogEntry => log !== null);

    // Filter by component
    let filteredLogs = parsedLogs;
    if (component && component !== 'all') {
      filteredLogs = filteredLogs.filter(log => log.component === component);
    }

    // Filter by level
    if (level) {
      filteredLogs = filteredLogs.filter(log => log.level === level);
    }

    // Get unique components
    const components = Array.from(new Set(parsedLogs.map(log => log.component))).sort();

    return NextResponse.json({
      success: true,
      logs: filteredLogs.reverse(), // Most recent first
      components,
      count: filteredLogs.length,
    });
  } catch (error) {
    console.error('[API] Error fetching logs:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch logs',
        logs: [],
        components: [],
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/logs
 * Clear PM2 logs
 */
export async function DELETE() {
  try {
    await execAsync('pm2 flush aster');
    return NextResponse.json({
      success: true,
      message: 'PM2 logs cleared',
    });
  } catch (error) {
    console.error('[API] Error clearing logs:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear logs',
      },
      { status: 500 }
    );
  }
}
