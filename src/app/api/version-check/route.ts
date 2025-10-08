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

    // Fetch latest changes from remote for the current branch
    await execAsync(`git fetch origin ${branch}`);

    // Get current commit hash
    const { stdout: currentCommit } = await execAsync('git rev-parse HEAD');
    const currentCommitShort = currentCommit.trim().substring(0, 7);

    // Get latest commit on origin/{currentBranch}
    const { stdout: latestCommit } = await execAsync(`git rev-parse origin/${branch}`);
    const latestCommitShort = latestCommit.trim().substring(0, 7);

    // Check if we're up to date
    const isUpToDate = currentCommit.trim() === latestCommit.trim();

    // Get commits we're behind (if any)
    let commitsBehind = 0;
    let pendingCommits: Array<{
      hash: string;
      shortHash: string;
      message: string;
      author: string;
      date: string;
    }> = [];

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

    const versionInfo: VersionInfo = {
      currentCommit: currentCommit.trim(),
      currentCommitShort,
      currentBranch: branch,
      isUpToDate,
      commitsBehind,
      latestCommit: latestCommit.trim(),
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
