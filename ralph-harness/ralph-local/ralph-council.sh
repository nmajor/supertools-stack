#!/usr/bin/env bash
# ralph-council.sh — the build loop with a 2-reviewer gate.
# Per iteration: pick highest-priority passes:false task → Claude Opus
# implements ONLY it → Codex + Gemini review the diff (correctness + acceptance
# + INTEGRATION) → fix loop → on both-approve mark passes:true + commit on the
# ralph/build branch. Refuses to run unless planning-status is approved.
#
# Usage: ralph-council.sh [--once] [--max-iterations N] [N]

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/common.sh"
source "$HERE/lib/agents-local.sh"
source "$HERE/lib/task-state.sh"
source "$HERE/lib/promise.sh"

require_cmds git jq claude codex gemini

MAX_ITERATIONS=200
case "${1:-}" in
  --once) MAX_ITERATIONS=1 ;;
  --max-iterations) MAX_ITERATIONS="${2:-200}" ;;
  ''|*[!0-9]*) : ;;
  *) MAX_ITERATIONS="$1" ;;
esac

[ "$(planning_status)" = approved ] || die "planning-status is '$(planning_status)', not 'approved'. Run ralph-plan-council.sh first." $EXIT_PRECONDITION
[ -s "$TASKS_FILE" ] || die "no .agent/tasks.json" $EXIT_PRECONDITION
require_git_commit_capable
ensure_build_branch
ensure_clean_baseline   # isolate per-task diffs from any pre-existing dirty state

implement_prompt() {  # $1 = task id
  cat "$AGENT_DIR/PROMPT.md"
  printf '\n\n## THIS INVOCATION: implement exactly %s\nRead its spec at %s. Read .agent/DECISIONS.md and .agent/prd/SUMMARY.md first. Do NOT commit — the loop commits after review. End with <promise>%s:DONE</promise> when implemented + locally verified, or a BLOCKED/DECIDE tag.\n' \
    "$1" "$(task_spec_path "$1")" "$1"
}

review_prompt() {  # $1 = task id, $2 = diff file
  cat "$COUNCIL_DIR/CODE_REVIEWER.md"
  printf '\n\n'
  cat "$COUNCIL_DIR/INTEGRATION_REVIEWER.md"
  printf '\n\n## Task under review: %s\nSpec: %s\n## Working-tree diff to review (staged):\n```diff\n' "$1" "$(task_spec_path "$1")"
  cat "$2"
  printf '\n```\nEnd with exactly one line: CODE_APPROVED or CODE_REJECTED (followed by numbered blocking findings, each file:line).\n'
}

fix_prompt() {  # $1 = task id, $2 = findings file
  cat "$COUNCIL_DIR/FIX_REVIEW.md"
  printf '\n\n## Task: %s\nFix ONLY the blocking findings below, then re-verify. Do NOT commit.\n\n' "$1"
  cat "$2"
}

START=$(date +%s)
for i in $(seq 1 "$MAX_ITERATIONS"); do
  if all_tasks_pass; then
    log "🎉 COMPLETE — all $(task_total) tasks pass. <promise>COMPLETE</promise>"
    exit $EXIT_COMPLETE
  fi
  id="$(next_task_id)"
  [ -n "$id" ] || { log "no remaining unblocked tasks. <promise>COMPLETE</promise>"; exit $EXIT_COMPLETE; }
  title="$(task_field "$id" title)"
  echo; log "════ iteration $i/$MAX_ITERATIONS · $id — $title ════"

  # 1) implement
  ip="$(mktemp)"; implement_prompt "$id" > "$ip"
  io="$HISTORY_DIR/$id-implement.log"
  run_claude "$ip" "$io" || log "implementer exited nonzero — checking what it produced"
  iout="$(cat "$io")"
  if needs_help "$iout"; then
    reason="$(extract_blocked_reason "$iout")$(extract_decide_question "$iout")"
    log "⛔ $id raised BLOCKED/DECIDE: $reason"
    exit $EXIT_BLOCKED
  fi
  # The implementer must actually change something. No diff → it didn't do the
  # task; do not send an empty diff to review or finalize a no-op task.
  git -C "$PROJECT_ROOT" add -A
  if git -C "$PROJECT_ROOT" diff --cached --quiet; then
    mark_task_blocked "$id"
    log "⛔ $id: implementer produced no changes — marked blocked. <promise>BLOCKED:$id no diff</promise>"
    exit $EXIT_BLOCKED
  fi
  echo "$iout" | grep -q "<promise>$id:DONE</promise>" \
    || log "   note: $id DONE tag not found in implementer output — proceeding on the produced diff"

  # 2) review (Codex + Gemini, parallel) → fix loop
  approved=false
  for rr in $(seq 1 "$MAX_REVIEW_ROUNDS"); do
    git -C "$PROJECT_ROOT" add -A
    diff="$(mktemp)"; git -C "$PROJECT_ROOT" diff --cached --stat > "$diff"; git -C "$PROJECT_ROOT" diff --cached | head -c 200000 >> "$diff"
    rp="$(mktemp)"; review_prompt "$id" "$diff" > "$rp"
    xr="$REVIEWS_DIR/$id-CODE-REVIEW-$rr-codex.md"
    mr="$REVIEWS_DIR/$id-CODE-REVIEW-$rr-gemini.md"
    log "   review round $rr: codex + gemini (parallel)…"
    run_codex "$rp" "$xr" & a=$!
    run_gemini "$rp" "$mr" & b=$!
    wait $a; wait $b
    vx="$(verdict "$xr" CODE_APPROVED CODE_REJECTED)"
    vm="$(verdict "$mr" CODE_APPROVED CODE_REJECTED)"
    log "   verdicts: codex=$vx · gemini=$vm"
    if [ "$vx" = approved ] && [ "$vm" = approved ]; then approved=true; break; fi
    if [ "$rr" -lt "$MAX_REVIEW_ROUNDS" ]; then
      ff="$(mktemp)"; { echo "# Findings ($id review round $rr)"; for r in "$xr" "$mr"; do echo; echo "## $(basename "$r")"; grep -nE 'CODE_REJECTED' -A 60 "$r" 2>/dev/null || tail -50 "$r"; done; } > "$ff"
      fp="$(mktemp)"; fix_prompt "$id" "$ff" > "$fp"
      log "   fixing findings (claude)…"
      run_claude "$fp" "$HISTORY_DIR/$id-fix-$rr.log" || true
    fi
  done

  if [ "$approved" != true ]; then
    mark_task_blocked "$id"
    log "⛔ $id failed review after $MAX_REVIEW_ROUNDS rounds — marked blocked. <promise>BLOCKED:$id review</promise>"
    exit $EXIT_BLOCKED
  fi

  # 3) accept: mark + log, then COMMIT (must succeed). A task is only finalized
  #    once its per-task commit lands; a commit failure rolls back the pass.
  mark_task_pass "$id"
  log_entry "$id — $title" "Council-approved (codex+gemini). Review: $REVIEWS_DIR/$id-CODE-REVIEW-*."
  if ! commit_task "$id" "$title"; then
    mark_task_pending "$id"; mark_task_blocked "$id"
    log "⛔ $id: commit failed — rolled back passes, marked blocked. <promise>BLOCKED:$id commit</promise>"
    exit $EXIT_BLOCKED
  fi
  log "   ✓ $id done & committed ($(task_remaining) remaining)"
done

log "⚠️ reached max iterations ($MAX_ITERATIONS); $(task_remaining) tasks remain."
exit $EXIT_MAX_ITERATIONS
