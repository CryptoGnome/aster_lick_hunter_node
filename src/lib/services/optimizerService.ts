/**
 * Optimizer Service
 * 
 * Optimizer service to support UI-driven optimization
 * with progress tracking and job management.
 * 
 * @server-only This file should only run on the server
 */
import 'server-only';
import { loadConfig, saveConfig } from '@/lib/bot/config';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const JOBS_STATE_PATH = path.join(process.cwd(), 'data', 'optimizer-jobs.json');
const OPTIMIZATION_RESULTS_PATH = path.join(process.cwd(), 'optimization-results.json');
import { errorLogger } from '@/lib/services/errorLogger';
// Job state management
interface OptimizationJob {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  currentStage: string;
  startTime: number;
  estimatedTimeRemaining?: number;
  results?: OptimizationResults;
  error?: string;
  config: OptimizationConfig;
}
interface OptimizationConfig {
  weights: {
    pnl: number;
    sharpe: number;
    drawdown: number;
  };
  capitalAllocation?: number;
  symbols?: string[];
}
interface OptimizationResults {
  timestamp: string;
  summary: {
    currentDailyPnl: number;
    optimizedDailyPnl: number;
    dailyImprovement: number;
    monthlyImprovement: number;
    improvementPercent: number | null;
    recommendedMaxOpenPositions: number;
  };
  recommendations: SymbolRecommendation[];
  capitalAllocation: any;
  optimizedConfig: any;
}
interface SymbolRecommendation {
  symbol: string;
  thresholds: {
    current: { long: number; short: number };
    optimized: { long: number; short: number };
  };
  settings: {
    current: any;
    optimized: any;
  };
  improvement: {
    long: number;
    short: number;
    total: number;
  };
  performance: any;
  scoring: any;
}
// In-memory job storage (use Redis for production multi-instance)
// Persist map on globalThis so route handlers share state during dev
const globalForOptimizerJobs = globalThis as typeof globalThis & { __optimizerJobs?: Map<string, OptimizationJob> };
const jobs = globalForOptimizerJobs.__optimizerJobs ?? (globalForOptimizerJobs.__optimizerJobs = new Map<string, OptimizationJob>());
hydrateJobsFromDisk();
function hydrateJobsFromDisk(): void {
  try {
    if (!fs.existsSync(JOBS_STATE_PATH)) {
      return;
    }
    const raw = fs.readFileSync(JOBS_STATE_PATH, 'utf8');
    if (!raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as OptimizationJob[];
    for (const job of parsed) {
      jobs.set(job.jobId, job);
    }
  } catch (error) {
    console.error('Failed to hydrate optimizer jobs from disk', error);
  }
}
function persistJobsToDisk(): void {
  try {
    const dir = path.dirname(JOBS_STATE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const serialized = JSON.stringify(Array.from(jobs.values()), null, 2);
    fs.writeFileSync(JOBS_STATE_PATH, serialized);
  } catch (error) {
    console.error('Failed to persist optimizer jobs to disk', error);
  }
}
const OPTIMIZER_TIMEOUT = 60 * 60 * 1000; // 1 hour
/**
 * Generate unique job ID
 */
function generateJobId(): string {
  return `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
/**
 * Update job progress
 */
function updateJobProgress(
  jobId: string,
  progress: number,
  stage: string,
  estimatedTimeRemaining?: number
) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.progress = Math.min(100, Math.max(0, progress));
  job.currentStage = stage;
  if (estimatedTimeRemaining !== undefined) {
    job.estimatedTimeRemaining = estimatedTimeRemaining;
  }
  jobs.set(jobId, job);
  persistJobsToDisk();
}
/**
 * Start optimization job
 */
export async function startOptimization(
  config: OptimizationConfig
): Promise<string> {
  console.log(`[optimizer] startOptimization request (cached jobs: ${jobs.size})`);
  const jobId = generateJobId();
  // Validate weights
  const totalWeight = config.weights.pnl + config.weights.sharpe + config.weights.drawdown;
  if (Math.abs(totalWeight - 100) > 0.01) {
    throw new Error(`Weights must sum to 100% (current: ${totalWeight}%)`);
  }
  // Create job entry
  const job: OptimizationJob = {
    jobId,
    status: 'queued',
    progress: 0,
    currentStage: 'Initializing...',
    startTime: Date.now(),
    config,
  };
  jobs.set(jobId, job);
  persistJobsToDisk();
  // Start optimization in background
  runOptimization(jobId).catch((error) => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = error.message;
      jobs.set(jobId, job);
      persistJobsToDisk();
    }
  });
  return jobId;
}
/**
 * Get job status
 */
export function getJobStatus(jobId: string): OptimizationJob | null {
  let job = jobs.get(jobId) || null;
  if (!job) {
    hydrateJobsFromDisk();
    job = jobs.get(jobId) || null;
  }
  if (!job) {
    console.warn(`[optimizer] status miss for ${jobId} (jobs cached: ${jobs.size})`);
  }
  return job;
}
/**
 * Cancel optimization job
 */
export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status === 'completed' || job.status === 'failed') {
    return false;
  }
  job.status = 'cancelled';
  job.currentStage = 'Cancelled by user';
  jobs.set(jobId, job);
  persistJobsToDisk();
  return true;
}
/**
 * Apply optimized configuration
 */
export async function applyOptimizedConfig(jobId: string): Promise<{
  success: boolean;
  backupPath?: string;
  error?: string;
}> {
  const job = jobs.get(jobId);
  if (!job) {
    return { success: false, error: 'Job not found' };
  }
  if (job.status !== 'completed') {
    return { success: false, error: 'Job not completed' };
  }
  if (!job.results?.optimizedConfig) {
    return { success: false, error: 'No optimized config available' };
  }
  try {
    // Load current config
    const currentConfig = await loadConfig();
    // Create backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `config.user.backup-${timestamp}.json`;
    fs.writeFileSync(backupPath, JSON.stringify(currentConfig, null, 2));
    // Apply optimized config
    await saveConfig(job.results.optimizedConfig);
    return { success: true, backupPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
/**
 * Main optimization logic
 * Runs the optimization by executing an external optimizer script
 * and monitoring its progress through output parsing
 */
async function runOptimization(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    // Set timeout
    const timeoutId = setTimeout(() => {
      const job = jobs.get(jobId);
      if (job && job.status === 'running') {
        job.status = 'failed';
        job.error = 'Optimization timed out after 1 hour';
        jobs.set(jobId, job);
        persistJobsToDisk();
      }
    }, OPTIMIZER_TIMEOUT);
    job.status = 'running';
    job.progress = 0;
    job.currentStage = 'Loading configuration...';
    jobs.set(jobId, job);
    persistJobsToDisk();
    // Load current config to get symbol count
    updateJobProgress(jobId, 5, 'Loading configuration...');
    const currentConfig = await loadConfig();
    const _symbolsToOptimize = job.config.symbols || Object.keys(currentConfig.symbols || {});
    updateJobProgress(jobId, 10, 'Starting optimization engine...');
    // Set environment variables for auto-confirm
    const { pnl: weightPnl, sharpe: weightSharpe, drawdown: weightDrawdown } = job.config.weights;
    const env = {
      ...process.env,
      FORCE_OPTIMIZER_OVERWRITE: '0',  // Don't auto-apply in subprocess
      FORCE_OPTIMIZER_CONFIRM: '0',
      OPTIMIZER_WEIGHT_PNL: String(weightPnl),
      OPTIMIZER_WEIGHT_SHARPE: String(weightSharpe),
      OPTIMIZER_WEIGHT_DRAWDOWN: String(weightDrawdown)
    };
    const optimizerScriptPath = path.join(process.cwd(), 'optimize-config.js');
    if (!fs.existsSync(optimizerScriptPath)) {
      throw new Error(`Optimizer script not found at ${optimizerScriptPath}`);
    }
    // Spawn the optimizer by running the Node script directly. Using process.execPath
    // keeps the invocation cross-platform and avoids Windows spawn() EINVAL errors
    // that occur when launching npm.cmd without a shell under Node 24+.
    const optimizerProcess = spawn(process.execPath, [optimizerScriptPath], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });
    let currentSymbolIndex = 0;
    // Parse output to track progress
    optimizerProcess.stdout.on('data', (data: Buffer) => {
      const output = data.toString();
      // Parse for progress indicators
      // Look for "Analyzing X (Y/Z)" pattern
      const symbolMatch = output.match(/Analyzing (\w+) \((\d+)\/(\d+)\)/i);
      if (symbolMatch) {
        const symbolName = symbolMatch[1];
        currentSymbolIndex = parseInt(symbolMatch[2]);
        const total = parseInt(symbolMatch[3]);
        
        // Progress: 15% start + 70% for symbols + 15% finalization
        const symbolProgress = 15 + (currentSymbolIndex / total) * 70;
        
        // Estimate remaining time
        const elapsed = Date.now() - job.startTime;
        const estimated = (elapsed / symbolProgress) * (100 - symbolProgress);
        
        updateJobProgress(
          jobId,
          symbolProgress,
          `Analyzing ${symbolName} (${currentSymbolIndex}/${total})...`,
          estimated
        );
      }
      // Look for completion indicators
      if (output.includes('Optimization complete') || output.includes('Results saved')) {
        updateJobProgress(jobId, 95, 'Finalizing results...');
      }
    });
    optimizerProcess.stderr.on('data', (data: Buffer) => {
      const output = data.toString();
      console.error('Optimizer stderr:', output);
      errorLogger
        .logError(new Error(output), {
          type: 'system',
          severity: 'high',
          context: {
            component: 'optimizer',
            metadata: {
              jobId,
              stream: 'stderr'
            }
          }
        })
        .catch((logError) => {
          console.error('Failed to log optimizer stderr', logError);
        });
    });
    // Wait for process to complete
    await new Promise<void>((resolve, reject) => {
      optimizerProcess.on('close', (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Optimizer exited with code ${code}`));
        }
      });
      optimizerProcess.on('error', (error: Error) => {
        reject(error);
      });
      // Check for cancellation
      const checkInterval = setInterval(() => {
        const currentJob = jobs.get(jobId);
        if (currentJob?.status === 'cancelled') {
          clearInterval(checkInterval);
          optimizerProcess.kill();
          reject(new Error('Optimization cancelled by user'));
        }
      }, 1000);
      optimizerProcess.on('close', () => {
        clearInterval(checkInterval);
      });
    });
    // Load the results from optimization-results.json
    updateJobProgress(jobId, 98, 'Loading results...');
    
    const resultsPath = 'optimization-results.json';
    
    if (!fs.existsSync(resultsPath)) {
      throw new Error('Optimization results file not found');
    }
    const resultsData = fs.readFileSync(resultsPath, 'utf8');
    const results: OptimizationResults = JSON.parse(resultsData);
    // Complete job
    updateJobProgress(jobId, 100, 'Optimization complete!');
    job.status = 'completed';
    job.results = results;
    jobs.set(jobId, job);
    persistJobsToDisk();
    clearTimeout(timeoutId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    job.status = 'failed';
    job.error = message;
    jobs.set(jobId, job);
    persistJobsToDisk();
    errorLogger
      .logError(error instanceof Error ? error : new Error(message), {
        type: 'system',
        severity: 'high',
        context: {
          component: 'optimizer',
          metadata: {
            jobId,
            message
          }
        }
      })
      .catch((logError) => {
        console.error('Failed to log optimizer failure', logError);
      });
  }
}
/**
 * Clean up old jobs (call periodically)
 */
export function cleanupOldJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  let cleaned = 0;
  let mutated = false;
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (now - job.startTime > maxAgeMs) {
      jobs.delete(jobId);
      cleaned++;
      mutated = true;
    }
  }
  if (mutated) {
  persistJobsToDisk();
  }
  return cleaned;
}
export function resetOptimizerState(): void {
  for (const job of jobs.values()) {
    if (job.status === 'running') {
      job.status = 'cancelled';
      job.currentStage = 'Reset by user';
      job.error = 'Optimization reset by user';
    }
  }

  jobs.clear();

  try {
    if (fs.existsSync(JOBS_STATE_PATH)) {
      fs.unlinkSync(JOBS_STATE_PATH);
    }
  } catch (error) {
    console.error('Failed to remove optimizer jobs cache', error);
  }

  try {
    if (fs.existsSync(OPTIMIZATION_RESULTS_PATH)) {
      fs.unlinkSync(OPTIMIZATION_RESULTS_PATH);
    }
  } catch (error) {
    console.error('Failed to remove optimization results file', error);
  }
}

// Export types for API routes
export type {
  OptimizationJob,
  OptimizationConfig,
  OptimizationResults,
  SymbolRecommendation,
};

