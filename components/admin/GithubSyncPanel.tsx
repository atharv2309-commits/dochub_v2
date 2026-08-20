'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { GitBranch, Loader2, RefreshCw, Settings2 } from 'lucide-react'
import { connectGithubRepo, runGithubSync } from '@/app/(admin)/admin/projects/[slug]/actions'
import type { SyncResult } from '@/lib/sync/github'

interface Props {
  projectId: string
  githubRepo: string | null
  githubBranch: string
  neverSynced: boolean
}

export function GithubSyncPanel({ projectId, githubRepo, githubBranch, neverSynced }: Props) {
  const [connectOpen, setConnectOpen] = useState(false)
  const [repo, setRepo] = useState(githubRepo ?? '')
  const [branch, setBranch] = useState(githubBranch)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [connecting, startConnecting] = useTransition()
  const [syncing, startSyncing] = useTransition()

  function submitConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!repo.trim()) return
    setConnectError(null)
    startConnecting(async () => {
      try {
        await connectGithubRepo(projectId, repo, branch)
        setConnectOpen(false)
      } catch (err) {
        setConnectError(err instanceof Error ? err.message : 'Failed to connect repo')
      }
    })
  }

  function sync() {
    setSyncError(null)
    startSyncing(async () => {
      try {
        setResult(await runGithubSync(projectId))
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : 'Sync failed')
      }
    })
  }

  if (!githubRepo) {
    return (
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <GitBranch className="w-4 h-4" />
            Connect GitHub repo
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect a GitHub repo</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitConnect} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="gh-repo">
                Repository
                <span className="text-muted-foreground font-normal ml-1 text-xs">(owner/name)</span>
              </Label>
              <Input
                id="gh-repo"
                placeholder="FlytBaseAILabs/flytbase-docs"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Expects a GitBook Git-Sync layout: SUMMARY.md at the repo root, plus nested .md files.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gh-branch">Branch</Label>
              <Input id="gh-branch" value={branch} onChange={(e) => setBranch(e.target.value)} required />
            </div>
            {connectError && <p className="text-sm text-destructive">{connectError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setConnectOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={connecting || !repo.trim()}>
                {connecting ? 'Connecting...' : 'Connect'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <a
          href={`https://github.com/${githubRepo}/tree/${githubBranch}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <GitBranch className="w-3.5 h-3.5" />
          {githubRepo}
        </a>
        <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
          <DialogTrigger asChild>
            <button className="text-muted-foreground hover:text-foreground transition-colors" title="Change repo">
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>GitHub repo settings</DialogTitle>
            </DialogHeader>
            <form onSubmit={submitConnect} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="gh-repo-edit">Repository</Label>
                <Input id="gh-repo-edit" value={repo} onChange={(e) => setRepo(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gh-branch-edit">Branch</Label>
                <Input id="gh-branch-edit" value={branch} onChange={(e) => setBranch(e.target.value)} required />
              </div>
              {connectError && <p className="text-sm text-destructive">{connectError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setConnectOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={connecting || !repo.trim()}>
                  {connecting ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Button variant="outline" size="sm" className="gap-2" onClick={sync} disabled={syncing}>
        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        {syncing ? 'Syncing...' : 'Sync from GitHub'}
      </Button>

      {neverSynced && !result && (
        <p className="text-xs text-muted-foreground">Never synced yet</p>
      )}
      {syncError && <p className="text-xs text-destructive">{syncError}</p>}
      {result && !syncError && (
        <p className="text-xs text-muted-foreground">
          {result.noChanges
            ? 'Already up to date'
            : `+${result.pagesAdded} added, ${result.pagesUpdated} updated${
                result.pagesUnreferenced.length ? `, ${result.pagesUnreferenced.length} no longer in SUMMARY.md` : ''
              }${result.errors.length ? ` — ${result.errors.length} error(s)` : ''}`}
        </p>
      )}
    </div>
  )
}
