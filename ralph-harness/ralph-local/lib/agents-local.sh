#!/usr/bin/env bash
# agents-local.sh — de-dockerized agent invocation. Replaces upstream ralph's
# `sbx run <agent> .` with direct local CLI calls. Each function takes a prompt
# FILE and an output FILE, runs the agent natively in $PROJECT_ROOT with full
# (bypass/yolo) permissions, captures combined output, and returns the agent's
# exit code. Prompts go via stdin to avoid argv length limits.
#
# Safety note: upstream relied on the Docker sandbox to contain bypass-perms
# runs. Natively we substitute: a dedicated git branch + per-task commit +
# the council review gate before each commit (see ralph-council.sh).

# run_claude <prompt-file> <out-file>  — implementer / generator / claude-reviewer
run_claude() {
  local pf="$1" out="$2"
  claude -p \
    --model "$RALPH_CLAUDE_MODEL" \
    --permission-mode bypassPermissions \
    < "$pf" > "$out" 2>&1
  return $?
}

# run_codex <prompt-file> <out-file>  — reviewer (gpt-5.5, high reasoning)
run_codex() {
  local pf="$1" out="$2"
  codex exec \
    --cd "$PROJECT_ROOT" \
    --dangerously-bypass-approvals-and-sandbox \
    -m "$RALPH_CODEX_MODEL" \
    -c model_reasoning_effort=high \
    - < "$pf" > "$out" 2>&1
  return $?
}

# run_gemini <prompt-file> <out-file>  — reviewer (gemini-2.5-pro)
run_gemini() {
  local pf="$1" out="$2"
  ( cd "$PROJECT_ROOT" && gemini -m "$RALPH_GEMINI_MODEL" -y -p "$(cat "$pf")" ) > "$out" 2>&1
  return $?
}

# Run codex + gemini reviewers in PARALLEL, each with its own prompt file.
# Args: <codex-prompt> <codex-out> <gemini-prompt> <gemini-out>
run_reviewers_parallel() {
  run_codex  "$1" "$2" &  local cpid=$!
  run_gemini "$3" "$4" &  local gpid=$!
  wait "$cpid"; local crc=$?
  wait "$gpid"; local grc=$?
  echo "$crc $grc"
}

# Verdict parsing — find the last APPROVED/REJECTED token of a given family.
# verdict <out-file> <APPROVE_TOKEN> <REJECT_TOKEN>  -> echoes approved|rejected|unclear
verdict() {
  local out="$1" ok="$2" no="$3"
  local line
  line="$(grep -oE "($ok|$no)" "$out" 2>/dev/null | tail -1)"
  if   echo "$line" | grep -q "$no"; then echo "rejected"
  elif echo "$line" | grep -q "$ok"; then echo "approved"
  else echo "unclear"; fi
}
