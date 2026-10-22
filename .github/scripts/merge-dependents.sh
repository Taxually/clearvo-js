#!/usr/bin/env bash
# Merges open PRs whose `Depends-on-backend: <ADO PR id>` is among the backend PRs that just went live, then
# reports back to Slack once the frontend side has actually finished (merged AND deployed to production).
#
# env: GH_TOKEN, GITHUB_REPOSITORY, LABEL (name in Slack messages, default Frontend), DEPLOY_CHECK=vercel|none (default vercel),
#      EXTRA_NOTE (appended to the Slack message), PR_IDS (comma-separated ADO PR ids), BACKEND_BUILD (label for messages),
#      DRY_RUN=true|false, PRS_JSON_FILE (test hook: use this JSON instead of `gh pr list`),
#      SLACK_WEBHOOK_URL (optional; message is printed instead when unset), CHECK_WAIT_SECONDS, VERCEL_WAIT_SECONDS
#
# Per matching PR: skip if labelled `hold`; comment (don't merge) on conflicts or failing checks; mark a draft
# ready; wait for checks to finish (the repo has no branch protection, so this is the only CI gate); squash-merge.
# After the last merge, wait for the `Vercel` commit status on that commit (the production deploy) and report it.
set -uo pipefail

REPO="${GITHUB_REPOSITORY:?}"
IDS="${PR_IDS:-}"
DRY="${DRY_RUN:-false}"
BUILD="${BACKEND_BUILD:-manual}"
WAIT_SECONDS="${CHECK_WAIT_SECONDS:-1500}"
VERCEL_WAIT="${VERCEL_WAIT_SECONDS:-900}"
LABEL="${LABEL:-Frontend}"
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${REPO}/actions/runs/${GITHUB_RUN_ID:-0}"

[ -z "${IDS// /}" ] && { echo "No backend PR ids given — nothing to do."; exit 0; }
WANT=",$(echo "$IDS" | tr -d ' [:space:]'),"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
: > "$WORK/results.txt"

slack() { # slack <text>  (printed, not posted, in dry-run or without a webhook)
  echo "--- Slack message ---"; echo "$1"; echo "---------------------"
  [ "$DRY" = "true" ] && return 0
  local hook="${SLACK_WEBHOOK_URL:-}"
  [ -z "$hook" ] && { echo "(SLACK_WEBHOOK_URL not set — not posted)"; return 0; }
  python3 -c "import json,sys;print(json.dumps({'text':sys.argv[1]}))" "$1" \
    | curl -sf -X POST -H 'Content-Type: application/json' --data @- "$hook" >/dev/null || echo "Slack post failed (ignored)"
}

if [ -n "${PRS_JSON_FILE:-}" ]; then
  cp "$PRS_JSON_FILE" "$WORK/prs.json"
else
  gh pr list --repo "$REPO" --state open --limit 200 --json number,title,body,isDraft,labels > "$WORK/prs.json" || { echo "Could not list PRs"; exit 1; }
fi

python3 - "$WORK/prs.json" "$WANT" > "$WORK/matches.tsv" <<'PYEOF'
import json, re, sys
prs = json.load(open(sys.argv[1]))
want = sys.argv[2]
for p in prs:
    m = re.search(r'^\s*Depends-on-backend:\s*#?(\d+)', p.get('body') or '', re.I | re.M)
    if not m or f',{m.group(1)},' not in want:
        continue
    hold = any((l.get('name') or '').lower() == 'hold' for l in p.get('labels', []))
    print(f"{p['number']}\t{m.group(1)}\t{'draft' if p.get('isDraft') else 'ready'}\t{'hold' if hold else '-'}\t{p['title'][:80]}")
PYEOF

if [ ! -s "$WORK/matches.tsv" ]; then
  echo "No open PR depends on backend PR(s) ${IDS}."
  exit 0
fi

say() { if [ "$DRY" = "true" ]; then echo "[dry-run] $*"; else echo "$*"; fi; }
note() { # note <pr> <text>
  if [ "$DRY" = "true" ]; then echo "[dry-run] comment on #$1: $2"; else gh pr comment "$1" --repo "$REPO" --body "$2" >/dev/null || true; fi
}
result() { echo "$1" >> "$WORK/results.txt"; } # result <slack line>

STATUS=0
LAST_SHA=""
while IFS=$'\t' read -r NUM DEP STATE HOLD TITLE; do
  echo "== #${NUM} (${STATE}, depends on backend PR ${DEP}): ${TITLE}"
  if [ "$HOLD" = "hold" ]; then
    say "skipping #${NUM}: labelled 'hold'"
    note "$NUM" "Backend PR ${DEP} is live (release ${BUILD}) but this PR is labelled \`hold\`, so it was not merged automatically. Remove the label and re-run the workflow, or merge by hand."
    result "• PR ${NUM} ${TITLE} — NOT merged: labelled hold"
    continue
  fi

  if [ "$DRY" != "true" ]; then
    MERGEABLE="$(gh pr view "$NUM" --repo "$REPO" --json mergeable --jq .mergeable 2>/dev/null || echo UNKNOWN)"
    if [ "$MERGEABLE" = "CONFLICTING" ]; then
      note "$NUM" "Backend PR ${DEP} is live (release ${BUILD}) but this PR has merge conflicts with main, so it was not merged automatically. Rebase it; the workflow can be re-run with pr_ids=${DEP}."
      result "• PR ${NUM} ${TITLE} — NOT merged: merge conflicts"
      STATUS=1; continue
    fi
  fi

  if [ "$STATE" = "draft" ]; then
    say "marking #${NUM} ready for review"
    if [ "$DRY" != "true" ] && ! gh pr ready "$NUM" --repo "$REPO"; then
      result "• PR ${NUM} ${TITLE} — NOT merged: could not mark it ready"
      STATUS=1; continue
    fi
  fi

  if [ "$DRY" = "true" ]; then
    echo "[dry-run] would wait for checks on #${NUM}, then squash-merge it"
    result "• PR ${NUM} ${TITLE} — would be merged"
    continue
  fi

  # wait for checks to register and finish
  DEADLINE=$(( $(date +%s) + WAIT_SECONDS )); VERDICT=""
  sleep 20
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    gh pr checks "$NUM" --repo "$REPO" --json bucket,name > "$WORK/checks.json" 2>/dev/null || echo '[]' > "$WORK/checks.json"
    VERDICT="$(python3 - "$WORK/checks.json" <<'PYEOF'
import json, sys
c = json.load(open(sys.argv[1]))
if not c: print('none')
elif any(x['bucket'] in ('fail', 'cancel') for x in c): print('fail:' + ', '.join(x['name'] for x in c if x['bucket'] in ('fail', 'cancel')))
elif any(x['bucket'] == 'pending' for x in c): print('pending')
else: print('pass')
PYEOF
)"
    case "$VERDICT" in pass|fail:*) break;; esac
    sleep 30
  done

  case "$VERDICT" in
    pass|none) ;;
    fail:*) note "$NUM" "Backend PR ${DEP} is live (release ${BUILD}) but these checks are failing: ${VERDICT#fail:}. Not merged. Fix them; the workflow can be re-run with pr_ids=${DEP}."
            result "• PR ${NUM} ${TITLE} — NOT merged: failing checks (${VERDICT#fail:})"; STATUS=1; continue;;
    *) note "$NUM" "Backend PR ${DEP} is live (release ${BUILD}) but checks did not finish within $((WAIT_SECONDS/60)) minutes. Not merged; re-run the workflow with pr_ids=${DEP}."
       result "• PR ${NUM} ${TITLE} — NOT merged: checks did not finish in time"; STATUS=1; continue;;
  esac

  if gh pr merge "$NUM" --repo "$REPO" --squash; then
    note "$NUM" "Backend PR ${DEP} went live in release ${BUILD}; merged automatically."
    LAST_SHA="$(gh pr view "$NUM" --repo "$REPO" --json mergeCommit --jq .mergeCommit.oid 2>/dev/null || true)"
    result "• PR ${NUM} ${TITLE} — merged"
  else
    note "$NUM" "Backend PR ${DEP} is live (release ${BUILD}) but the automatic merge failed. Merge by hand."
    result "• PR ${NUM} ${TITLE} — NOT merged: the merge itself failed"
    STATUS=1
  fi
done < "$WORK/matches.tsv"

# Wait for the production deploy of the last merge: Vercel reports a `Vercel` commit status on it.
DEPLOY=""
if [ -n "$LAST_SHA" ] && [ "$DRY" != "true" ] && [ "${DEPLOY_CHECK:-vercel}" = vercel ]; then
  VDEADLINE=$(( $(date +%s) + VERCEL_WAIT )); VSTATE=pending
  while [ "$(date +%s)" -lt "$VDEADLINE" ]; do
    VSTATE="$(gh api "repos/${REPO}/commits/${LAST_SHA}/status" --jq '[.statuses[]|select(.context=="Vercel")|.state][0] // "pending"' 2>/dev/null || echo pending)"
    case "$VSTATE" in success|failure|error) break;; esac
    sleep 20
  done
  # A merge superseded by a newer commit never gets its own production deploy; the newest commit's deploy covers it.
  if [ "$VSTATE" = pending ]; then
    HEAD_SHA="$(gh api "repos/${REPO}/commits/main" --jq .sha 2>/dev/null || true)"
    if [ -n "$HEAD_SHA" ] && [ "$HEAD_SHA" != "$LAST_SHA" ]; then
      HSTATE="$(gh api "repos/${REPO}/commits/${HEAD_SHA}/status" --jq '[.statuses[]|select(.context=="Vercel")|.state][0] // "pending"' 2>/dev/null || echo pending)"
      [ "$HSTATE" = success ] && { VSTATE=success; LAST_SHA="$HEAD_SHA"; }
    fi
  fi
  case "$VSTATE" in
    success) DEPLOY="Production deploy of ${LABEL}: succeeded (${LAST_SHA:0:8})";;
    failure|error) DEPLOY="Production deploy of ${LABEL}: FAILED (${LAST_SHA:0:8}) — check Vercel"; STATUS=1;;
    *) DEPLOY="Production deploy of ${LABEL}: still running after $((VERCEL_WAIT/60)) minutes (${LAST_SHA:0:8}) — check Vercel"; STATUS=1;;
  esac
fi

ICON=":white_check_mark:"; [ "$STATUS" -ne 0 ] && ICON=":warning:"
[ "$DRY" = "true" ] && ICON=":test_tube:"
MSG="${ICON} *${LABEL}* — release ${BUILD}"$'\n'"$(cat "$WORK/results.txt")"
[ -n "$DEPLOY" ] && MSG="${MSG}"$'\n'"${DEPLOY}"
[ -n "${EXTRA_NOTE:-}" ] && MSG="${MSG}"$'\n'"${EXTRA_NOTE}"
MSG="${MSG}"$'\n'"<${RUN_URL}|Workflow run>"
slack "$MSG"

exit $STATUS
