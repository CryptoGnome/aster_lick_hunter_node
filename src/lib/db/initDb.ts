import { db } from './database';

let initialized = false;

export async function ensureDbInitialized(): Promise<void> {
  if (!initialized) {
    try {
      await db.initialize();
      initialized = true;
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }
}