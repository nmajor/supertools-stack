#!/usr/bin/env bash
# task-state.sh — jq-backed helpers over .agent/tasks.json.
#
# tasks.json is an array of summaries:
#   { "id":"TASK-1", "title":"...", "priority":100, "area":"...", "type":"...",
#     "specFilePath":".agent/tasks/TASK-1.json", "passes":false, "blocked":false }
#
# "Highest priority" = largest .priority among incomplete, unblocked tasks;
# ties broken by id (ascending). Detailed spec lives at .specFilePath.

task_total() { jq 'length' "$TASKS_FILE" 2>/dev/null || echo 0; }

task_remaining() {
  jq '[.[] | select((.passes // false)==false and (.blocked // false)==false)] | length' \
    "$TASKS_FILE" 2>/dev/null || echo 0
}

# Echo the id of the next task to work, or empty string if none remain.
next_task_id() {
  jq -r '
    [ .[] | select((.passes // false)==false and (.blocked // false)==false) ]
    | sort_by([ -(.priority // 0), .id ])
    | (.[0].id // "")
  ' "$TASKS_FILE" 2>/dev/null
}

task_field() { jq -r --arg id "$1" '.[] | select(.id==$id) | .'"$2"' // ""' "$TASKS_FILE" 2>/dev/null; }

task_spec_path() {
  local p; p="$(task_field "$1" specFilePath)"
  [ -n "$p" ] && echo "$PROJECT_ROOT/$p" || echo "$TASKS_DETAIL_DIR/$1.json"
}

mark_task_pass() {
  local id="$1"; local tmp; tmp="$(mktemp)"
  jq --arg id "$id" 'map(if .id==$id then .passes=true else . end)' "$TASKS_FILE" > "$tmp" && mv "$tmp" "$TASKS_FILE"
}

mark_task_blocked() {
  local id="$1"; local tmp; tmp="$(mktemp)"
  jq --arg id "$id" 'map(if .id==$id then .blocked=true else . end)' "$TASKS_FILE" > "$tmp" && mv "$tmp" "$TASKS_FILE"
}

# 0 (true) when there is at least one task and all are passes:true.
all_tasks_pass() {
  local total remaining
  total="$(task_total)"; remaining="$(task_remaining)"
  [ "$total" -gt 0 ] && [ "$remaining" -eq 0 ]
}
