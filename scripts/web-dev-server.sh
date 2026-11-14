#!/usr/bin/env bash
# The apps/web dev server that `make dev-local` starts and `make dev-stop`
# ends. It signals only the process group it started. The pid file records
# that group's leader and the time the leader started; a recorded pid whose
# process started at another time (the server exited and the pid was reused)
# is dropped without a signal. A port another program holds stops `start`
# with an error, and that program is left running.
#
# Usage: web-dev-server.sh start <port> <pid-file> <log-file>
#        web-dev-server.sh stop <pid-file>
set -euo pipefail

refuse() {
  printf 'web-dev-server: %s\n' "$1" >&2
  exit 1
}

# A listener answers on the address it bound, and 127.0.0.1 and ::1 are
# separate binds: both are asked, as e2e/lane-port-check.ts asks them.
port_answers() {
  nc -z -w 1 127.0.0.1 "$1" >/dev/null 2>&1 || nc -z -w 1 ::1 "$1" >/dev/null 2>&1
}

# Who listens on the port, by pid. Naming is best-effort (lsof is absent on
# some runners, and blind to other users' sockets); port_answers decides.
holders_of() {
  local pids
  pids="$(lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null)" || pids=""
  printf '%s\n' "${pids:-an unidentified process}" | paste -sd ' ' -
}

# When a process started, as ps reports it; nothing when it is gone. ps writes
# the time in the caller's locale and zone, and start and stop are separate
# runs, so both read it in the same fixed ones.
start_time_of() {
  local started
  started="$(LC_ALL=C TZ=UTC ps -o lstart= -p "$1")" || return 1
  read -r started <<<"$started"
  printf '%s\n' "$started"
}

# Whether the pid file names a live process that started when it recorded.
# A pid below 2 never qualifies: as a process group, 0 is this script's own
# group and 1 is every process there is.
names_running_server() {
  local pid recorded
  pid="$(sed -n 1p "$1")"
  recorded="$(sed -n 2p "$1")"
  [[ "$pid" =~ ^[0-9]+$ ]] && ((pid > 1)) && [ -n "$recorded" ] &&
    [ "$(start_time_of "$pid" 2>/dev/null)" = "$recorded" ]
}

refuse_a_busy_start() {
  local port="$1" pid_file="$2"
  command -v nc >/dev/null 2>&1 || refuse "nc is needed to tell whether port $port is free"
  if [ -f "$pid_file" ] && names_running_server "$pid_file"; then
    refuse "the server dev-local started is still running ($pid_file); run make dev-stop first"
  fi
  if port_answers "$port"; then
    refuse "port $port is already in use by $(holders_of "$port"); it was left running. Free the port, then run make dev-local again"
  fi
}

# The server runs in a process group of its own (job control is on while it
# is launched), so stop can end pnpm and the vite process under it together.
# Its stdin is /dev/null: a background group that reads the terminal is
# stopped by SIGTTIN.
start() {
  local port="$1" pid_file="$2" log_file="$3" pid
  [[ "$port" =~ ^[0-9]+$ ]] || refuse "the port must be a number: $port"
  refuse_a_busy_start "$port" "$pid_file"
  mkdir -p "$(dirname "$pid_file")"
  set -m
  pnpm --filter web dev </dev/null >"$log_file" 2>&1 &
  pid=$!
  set +m
  printf '%s\n%s\n' "$pid" "$(start_time_of "$pid")" >"$pid_file"
  echo "Web app started (process group $pid, log $log_file)"
}

# stop returns once the group has exited, so a dev-local right after a
# dev-stop finds the port free instead of refusing it.
wait_for_group_exit() {
  local tries=50
  while kill -0 -- "-$1" 2>/dev/null; do
    ((--tries > 0)) || refuse "process group $1 is still running 5s after SIGTERM"
    sleep 0.1
  done
}

stop() {
  local pid_file="$1" pid
  [ -f "$pid_file" ] || { echo "No web app recorded in $pid_file; nothing to stop."; return 0; }
  pid="$(sed -n 1p "$pid_file")"
  if ! names_running_server "$pid_file"; then
    rm -f "$pid_file"
    echo "Process $pid is not the server dev-local started (it exited, or its pid was reused); nothing was signalled."
    return 0
  fi
  kill -TERM -- "-$pid"
  wait_for_group_exit "$pid"
  rm -f "$pid_file"
  echo "✓ Web app stopped (process group $pid)"
}

main() {
  case "${1:-}:$#" in
    start:4) start "$2" "$3" "$4" ;;
    stop:2) stop "$2" ;;
    *) refuse "usage: web-dev-server.sh start <port> <pid-file> <log-file> | stop <pid-file>" ;;
  esac
}

# Run when executed. Its test sources the file to ask names_running_server on
# its own whether a pid below 2 names the server: asked through stop, a broken
# guard would signal process group 1 (every process) or 0 (the caller's own).
[[ "${BASH_SOURCE[0]}" != "$0" ]] || main "$@"
