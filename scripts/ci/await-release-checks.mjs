import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const gateName = 'checks / Quality gate'

export async function awaitReleaseChecks({ request, repository, branch, sha, now = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 35 * 60 * 1000 }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^automation\/release-[\w.-]+$/.test(branch) || !/^[a-f\d]{40}$/i.test(sha)) {
    throw Error('Invalid release candidate identity')
  }
  const root = `/repos/${repository}/actions`
  const runsPath = `${root}/workflows/ci.yml/runs?event=workflow_dispatch&head_sha=${sha}&per_page=100`
  const previous = new Set((await request('GET', runsPath)).workflow_runs.map(run => run.id))
  await request('POST', `${root}/workflows/ci.yml/dispatches`, { ref: branch })
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    const runs = (await request('GET', runsPath)).workflow_runs
    const run = runs.filter(item => !previous.has(item.id) && item.head_sha === sha &&
      item.head_branch === branch && item.event === 'workflow_dispatch').sort((a, b) => b.id - a.id)[0]
    if (run?.status === 'completed') {
      const jobs = (await request('GET', `${root}/runs/${run.id}/jobs?per_page=100`)).jobs
      const gate = jobs.find(job => job.name === gateName)
      if (run.conclusion !== 'success' || gate?.conclusion !== 'success') {
        throw Error(`Release candidate CI did not pass: ${run.html_url}`)
      }
      return { id: run.id, url: run.html_url, sha }
    }
    await pause(15000)
  }
  throw Error('Timed out waiting for release candidate Quality gate; master was not advanced')
}

async function main() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, RELEASE_CANDIDATE_BRANCH, RELEASE_CANDIDATE_SHA } = process.env
  if (!GITHUB_TOKEN) throw Error('GITHUB_TOKEN is required')
  const request = async (method, endpoint, body) => {
    const response = await fetch('https://api.github.com' + endpoint, {
      method, headers: { Authorization: 'Bearer ' + GITHUB_TOKEN,
        Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
        'User-Agent': 'geekgeekrun-release-quality-checks', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000)
    })
    if (!response.ok) throw Error(`GitHub ${method} ${endpoint} failed (${response.status})`)
    return response.status === 204 ? null : response.json()
  }
  const result = await awaitReleaseChecks({ request, repository: GITHUB_REPOSITORY,
    branch: RELEASE_CANDIDATE_BRANCH, sha: RELEASE_CANDIDATE_SHA })
  console.log(`Release candidate Quality gate passed: ${result.url}`)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `\nRelease candidate: [Quality gate passed](${result.url}) for \`${result.sha}\`.\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
