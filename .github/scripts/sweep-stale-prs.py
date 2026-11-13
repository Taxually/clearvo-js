#!/usr/bin/env python3
"""Daily sweep for dependent PRs that are rotting.

Backend-release-merge (merge-dependents.sh) runs once per release and gives up quietly. This sweep runs daily and,
for every open PR carrying `Depends-on-backend: <ADO PR id>`:
  - asks Azure DevOps whether that backend PR is completed and whether it is in the last successful production
    release of Pipeline 282 (same rule as ~/.claude/skills/release/scripts/backend-released.sh);
  - if it is live and the PR is still open, retries the merge through merge-dependents.sh (mark ready, wait for
    checks, squash-merge), unless the PR has a conflict / failing check / `hold` label, which are alerted instead;
  - alerts (one line per PR, only when the state changed or after 7 days) for: wrong / non-backend / abandoned id,
    merged backend PR not released after 3 days, live but cannot merge, a body that says "Matches backend PR" with no
    Depends line, and open drafts without a Depends line older than STALE_DRAFT_DAYS.

env: GH_TOKEN, GITHUB_REPOSITORY, SLACK_WEBHOOK_URL (optional; message printed when unset), DRY_RUN=true|false,
     ADO_READ_PAT (Basic) or ADO_TOKEN (bearer, local runs), LABEL, STALE_DRAFT_DAYS (7), UNRELEASED_ALERT_DAYS (3),
     MERGE_SCRIPT (default .github/scripts/merge-dependents.sh), CHECK_WAIT_SECONDS, EXTRA env passes to the merge script.
test hooks: PRS_JSON_FILE (instead of `gh pr list`), ADO_FIXTURE_FILE (json: {"live_sha": "...", "prs": {"<id>": {...}}}).
Never raises on lookup errors: an unknown ADO state is reported, not alerted per PR.
"""
import base64
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

ORG = 'https://dev.azure.com/taxually'
PROJ = 'Taxsure'
BACKEND_REPO_ID = 'f1e9a0a9-9d92-44af-bab1-4f6c051cbfca'
MARK = 'stale-pr-sweep'

REPO = os.environ.get('GITHUB_REPOSITORY', '')
DRY = os.environ.get('DRY_RUN', 'false') == 'true'
LABEL = os.environ.get('LABEL', 'Frontend')
STALE_DAYS = int(os.environ.get('STALE_DRAFT_DAYS', '7'))
UNRELEASED_DAYS = int(os.environ.get('UNRELEASED_ALERT_DAYS', '3'))
REMIND_DAYS = 7
NOW = dt.datetime.now(dt.timezone.utc)
DEP_RE = re.compile(r'^\s*Depends-on-backend:\s*#?(\d+)', re.I | re.M)
CLAIMS_RE = re.compile(r'(matches|depends on|requires|needs)\s+(the\s+)?backend\s+(PR|pull request)\b|backend\s+PR\s*#?\s*\d+', re.I)


def sh(args, check=False, env=None):
    p = subprocess.run(args, capture_output=True, text=True, env=env)
    if check and p.returncode != 0:
        raise RuntimeError(f'{args[:3]} failed: {p.stderr.strip()[:300]}')
    return p


def parse_ts(s):
    try:
        return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except Exception:
        return None


# ---------------------------------------------------------------- Azure DevOps
class Ado:
    def __init__(self):
        pat, tok = os.environ.get('ADO_READ_PAT', ''), os.environ.get('ADO_TOKEN', '')
        self.fixture = None
        if os.environ.get('ADO_FIXTURE_FILE'):
            self.fixture = json.load(open(os.environ['ADO_FIXTURE_FILE']))
        if tok:
            self.auth = f'Bearer {tok}'
        elif pat:
            self.auth = 'Basic ' + base64.b64encode(f':{pat}'.encode()).decode()
        else:
            self.auth = ''
        self.available = bool(self.auth) or self.fixture is not None
        self._live = None
        self._pr = {}

    def get(self, url):
        req = urllib.request.Request(url, headers={'Authorization': self.auth})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)

    def live_sha(self):
        """Commit of the newest Pipeline 282 run whose Deploy and TestProduction stages both succeeded."""
        if self._live is not None:
            return self._live
        if self.fixture is not None:
            self._live = self.fixture.get('live_sha')
            return self._live
        runs = self.get(f'{ORG}/{PROJ}/_apis/build/builds?definitions=282&statusFilter=completed'
                        f'&queryOrder=finishTimeDescending&$top=20&api-version=7.1').get('value', [])
        ok = ('succeeded', 'succeededWithIssues')
        for r in runs:
            tl = self.get(f"{ORG}/{PROJ}/_apis/build/builds/{r['id']}/timeline?api-version=7.1").get('records', [])
            st = {(x.get('identifier') or x['name']): x.get('result') for x in tl if x['type'] == 'Stage'}
            if st.get('Deploy') in ok and st.get('TestProduction') in ok:
                self._live = r['sourceVersion']
                return self._live
        self._live = ''
        return self._live

    def pr_state(self, pr_id):
        """-> dict(state=NOT_FOUND|NOT_BACKEND|ABANDONED|ACTIVE|MERGED_NOT_LIVE|LIVE|UNKNOWN, ...)"""
        if pr_id in self._pr:
            return self._pr[pr_id]
        try:
            self._pr[pr_id] = self._pr_state(pr_id)
        except Exception as e:  # never raise: an unknown state is reported once, not per PR
            self._pr[pr_id] = {'state': 'UNKNOWN', 'why': str(e)[:120]}
        return self._pr[pr_id]

    def _pr_state(self, pr_id):
        if self.fixture is not None:
            return self.fixture['prs'].get(pr_id, {'state': 'NOT_FOUND'})
        try:
            pr = self.get(f'{ORG}/_apis/git/pullrequests/{pr_id}?api-version=7.1')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {'state': 'NOT_FOUND'}
            raise
        if (pr.get('repository') or {}).get('id') != BACKEND_REPO_ID:
            return {'state': 'NOT_BACKEND', 'title': pr.get('title', '')}
        status = pr.get('status')
        if status == 'abandoned':
            return {'state': 'ABANDONED', 'title': pr.get('title', '')}
        if status != 'completed':
            return {'state': 'ACTIVE', 'title': pr.get('title', ''), 'draft': pr.get('isDraft', False)}
        merge_sha = (pr.get('lastMergeCommit') or {}).get('commitId', '')
        closed = parse_ts(pr.get('closedDate') or '')
        age = (NOW - closed).days if closed else 0
        live = self.live_sha()
        if not live or not merge_sha:
            return {'state': 'UNKNOWN', 'why': 'no successful production release found'}
        d = self.get(f'{ORG}/{PROJ}/_apis/git/repositories/{BACKEND_REPO_ID}/diffs/commits?baseVersion={merge_sha}'
                     f'&baseVersionType=commit&targetVersion={live}&targetVersionType=commit&api-version=7.1')
        released = d.get('commonCommit') == merge_sha or d.get('behindCount', 1) == 0
        return {'state': 'LIVE' if released else 'MERGED_NOT_LIVE', 'title': pr.get('title', ''), 'age_days': age}


# ---------------------------------------------------------------- GitHub
def list_prs():
    if os.environ.get('PRS_JSON_FILE'):
        return json.load(open(os.environ['PRS_JSON_FILE']))
    p = sh(['gh', 'pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '200', '--json',
            'number,title,body,isDraft,labels,createdAt,mergeable,url'], check=True)
    return json.loads(p.stdout)


def failing_checks(num):
    if os.environ.get('PRS_JSON_FILE'):
        return ''
    p = sh(['gh', 'pr', 'checks', str(num), '--repo', REPO, '--json', 'bucket,name'])
    try:
        c = json.loads(p.stdout or '[]')
    except Exception:
        return ''
    return ', '.join(x['name'] for x in c if x['bucket'] in ('fail', 'cancel'))


def last_marker(num):
    """(key, date) of the newest sweep marker comment on the PR, or (None, None)."""
    if os.environ.get('PRS_JSON_FILE'):
        return None, None
    p = sh(['gh', 'pr', 'view', str(num), '--repo', REPO, '--json', 'comments'])
    try:
        comments = json.loads(p.stdout or '{}').get('comments', [])
    except Exception:
        return None, None
    found = (None, None)
    for c in comments:
        m = re.search(rf'<!-- {MARK}:(\S+?) (\d{{4}}-\d{{2}}-\d{{2}}) -->', c.get('body') or '')
        if m:
            found = (m.group(1), parse_ts(m.group(2) + 'T00:00:00Z'))
    return found


def merge_script_env(ids):
    env = dict(os.environ)
    env.update({'PR_IDS': ','.join(sorted(ids)), 'BACKEND_BUILD': 'daily sweep', 'DRY_RUN': 'true' if DRY else 'false',
                'SLACK_WEBHOOK_URL': ''})  # the sweep posts its own, de-duplicated alerts
    return env


# ---------------------------------------------------------------- main
def main():
    ado = Ado()
    prs = list_prs()
    alerts = []   # (pr dict, key, reason, next step)
    retry = []    # (pr dict, backend id)

    def flag(pr, key, reason, step):
        alerts.append((pr, key, reason, step))

    for pr in prs:
        labels = {(l.get('name') or '').lower() for l in pr.get('labels', [])}
        body = pr.get('body') or ''
        m = DEP_RE.search(body)
        created = parse_ts(pr.get('createdAt') or '')
        age = (NOW - created).days if created else 0
        if not m:
            if CLAIMS_RE.search(body):
                flag(pr, 'claims-backend-no-depends',
                     'its description refers to a backend PR but has no `Depends-on-backend: <id>` line, so no release will ever merge it',
                     'add the line with the ADO PR id (or remove the claim) so the release merge picks it up')
            elif pr.get('isDraft') and age >= STALE_DAYS and 'hold' not in labels:
                flag(pr, 'stale-draft', f'a draft for {age} days with no `Depends-on-backend` line, so nothing will merge or revisit it',
                     'finish and publish it, add the Depends-on-backend line, or close it')
            continue
        bid = m.group(1)
        if 'hold' in labels:
            continue
        if not ado.available:
            continue
        st = ado.pr_state(bid)
        s = st['state']
        if s == 'NOT_FOUND':
            flag(pr, f'bad-id-{bid}', f'`Depends-on-backend: {bid}` does not exist in Azure DevOps', 'fix the id to the real backend PR id')
        elif s == 'NOT_BACKEND':
            flag(pr, f'bad-id-{bid}', f'ADO PR {bid} is not a backend PR ("{st.get("title","")[:50]}")', 'fix the id to the backend PR id')
        elif s == 'ABANDONED':
            flag(pr, f'abandoned-{bid}', f'backend PR {bid} was abandoned, so this PR will never be released', 'close this PR or point it at the replacement backend PR')
        elif s == 'MERGED_NOT_LIVE':
            if st.get('age_days', 0) >= UNRELEASED_DAYS:
                flag(pr, f'not-released-{bid}', f'backend PR {bid} merged {st["age_days"]} days ago but is still not in a production release',
                     'check the Pipeline 282 runs (a red release drops the id list; the daily sweep will merge this once it is live)')
        elif s == 'LIVE':
            retry.append((pr, bid))
        elif s == 'UNKNOWN':
            print(f'warning: could not determine backend PR {bid} state ({st.get("why")})')

    # Live and still open: retry the merge if nothing blocks it, otherwise alert with the blocker.
    clean_ids = set()
    for pr, bid in retry:
        fails = failing_checks(pr['number'])
        if pr.get('mergeable') == 'CONFLICTING':
            flag(pr, f'conflict-{bid}', f'backend PR {bid} is live but this PR has merge conflicts with main', 'rebase it on main; the next sweep merges it')
        elif fails:
            flag(pr, f'checks-{bid}', f'backend PR {bid} is live but checks are failing: {fails}', 'fix the failing checks; the next sweep merges it')
        else:
            clean_ids.add(bid)

    if clean_ids:
        script = os.environ.get('MERGE_SCRIPT', '.github/scripts/merge-dependents.sh')
        print(f'retrying merge for live backend PRs: {sorted(clean_ids)}')
        p = subprocess.run(['bash', script], env=merge_script_env(clean_ids), text=True)
        if not DRY:
            still = {x['number']: x for x in list_prs()}
            for pr, bid in retry:
                if bid in clean_ids and pr['number'] in still:
                    flag(pr, f'merge-failed-{bid}', f'backend PR {bid} is live and the automatic retry did not merge this PR', 'open the PR comments for the reason (checks timed out or the merge failed) and merge by hand')
        elif p.returncode != 0:
            print('dry-run: merge script exited non-zero')

    # Alert de-duplication: only when the state key changed, or the last alert is older than REMIND_DAYS.
    lines, to_comment = [], []
    for pr, key, reason, step in alerts:
        prev_key, prev_date = last_marker(pr['number'])
        if prev_key == key and prev_date and (NOW - prev_date).days < REMIND_DAYS:
            print(f'#{pr["number"]}: already alerted ({key}), skipping')
            continue
        lines.append(f'• <{pr.get("url") or ""}|{LABEL} PR {pr["number"]}> {pr["title"][:70]}: {reason}. Next: {step}.')
        to_comment.append((pr, key, reason, step))

    if not ado.available:
        print('warning: no ADO_READ_PAT / ADO_TOKEN, so Depends-on-backend PRs could not be checked (only the GitHub-only checks ran)')

    if lines:
        msg = f':warning: *{LABEL} PRs that need attention* (daily sweep)\n' + '\n'.join(lines)
        slack(msg)
        for pr, key, reason, step in to_comment:
            body = f'Daily sweep: {reason}. Next step: {step}.\n\n<!-- {MARK}:{key} {NOW:%Y-%m-%d} -->'
            if DRY:
                print(f'[dry-run] comment on #{pr["number"]}: {body.splitlines()[0]}')
            else:
                sh(['gh', 'pr', 'comment', str(pr['number']), '--repo', REPO, '--body', body])
    else:
        print('Nothing needs attention.')


def slack(text):
    print('--- Slack message ---\n' + text + '\n---------------------')
    hook = os.environ.get('SLACK_WEBHOOK_URL', '')
    if DRY or not hook:
        if not DRY:
            print('(SLACK_WEBHOOK_URL not set - not posted)')
        return
    try:
        req = urllib.request.Request(hook, data=json.dumps({'text': text}).encode(), headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=20).read()
    except Exception as e:
        print(f'Slack post failed (ignored): {e}')


if __name__ == '__main__':
    main()
