import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface VersionInfo {
  currentCommit: string;
  currentCommitShort: string;
  currentBranch: string;
  isUpToDate: boolean;
  commitsBehind: number;
  latestCommit: string;
  latestCommitShort: string;
  pendingCommits: Array<{
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
  }>;
  error?: string;
}

export async function GET() {
  try {
    // Get current branch
    const { stdout: currentBranch } = await execAsync('git branch --show-current');
    const branch = currentBranch.trim();

    // Get current commit hash
    const { stdout: currentCommit } = await execAsync('git rev-parse HEAD');
    const currentCommitShort = currentCommit.trim().substring(0, 7);

    // Try to fetch latest changes from remote (but don't fail if this doesn't work)
    let latestCommit = currentCommit.trim();
    let latestCommitShort = currentCommitShort;
    let isUpToDate = true;
    let commitsBehind = 0;
    let pendingCommits: Array<{
      hash: string;
      shortHash: string;
      message: string;
      author: string;
      date: string;
    }> = [];

    try {
      // Fetch latest changes from remote for the current branch
      await execAsync(`git fetch origin ${branch}`, { timeout: 5000 });

      // Get latest commit on origin/{currentBranch}
      const { stdout: remoteCommit } = await execAsync(`git rev-parse origin/${branch}`);
      latestCommit = remoteCommit.trim();
      latestCommitShort = latestCommit.substring(0, 7);

      // Check if we're up to date
      isUpToDate = currentCommit.trim() === latestCommit;

      // Get commits we're behind (if any)
      if (!isUpToDate) {
        // Get commits between current and origin/{currentBranch}
        const { stdout: commitsOutput } = await execAsync(`git log --oneline --format="%H|%h|%s|%an|%ad" --date=short HEAD..origin/${branch}`);

        if (commitsOutput.trim()) {
          const commits = commitsOutput.trim().split('\n');
          commitsBehind = commits.length;

          pendingCommits = commits.map(commit => {
            const [hash, shortHash, message, author, date] = commit.split('|');
            return {
              hash: hash.trim(),
              shortHash: shortHash.trim(),
              message: message.trim(),
              author: author.trim(),
              date: date.trim()
            };
          });
        }
      }
    } catch (fetchError) {
      // If fetch fails (no network, no remote, etc.), just use local info
      console.warn('Could not fetch remote updates:', fetchError instanceof Error ? fetchError.message : 'Unknown error');
    }

    const versionInfo: VersionInfo = {
      currentCommit: currentCommit.trim(),
      currentCommitShort,
      currentBranch: branch,
      isUpToDate,
      commitsBehind,
      latestCommit,
      latestCommitShort,
      pendingCommits
    };

    return NextResponse.json(versionInfo);

  } catch (error) {
    console.error('Failed to check version:', error);

    return NextResponse.json({
      error: 'Failed to check version status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
