#!/usr/bin/env bash
# SUT: scripts/web-dev-server.sh
# The web dev server `make dev-local` starts and `make dev-stop` ends. It may
# signal only the process group it started: a port another program holds
# stops `start` with an error and leaves that program running, and `stop` ends
# the recorded server, or nothing when the recorded pid now names a process
# that started at another time.
#
# The server is a stub `pnpm` that reports its pid and blocks. The other
# program is a listener this test starts on a port the kernel picks, in a
# process group of its own; it exits 0 when the test releases it, so `wait`
# tells "left alone" (0) from "terminated" (143). No case uses a fixed port or
# signals a process this test did not start, and every process started here
# reads a pipe whose only writer is this test, so none outlives it.
set -euo pipefail

SUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/web-dev-server.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/bin"
mkfifo "$TMP/lifeline" "$TMP/ready"
exec 5<>"$TMP/lifeline" 6<>"$TMP/ready"

cat >"$TMP/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
exec 5>&- 6>&-
printf '%s %s\n' "$$" "$*" >"$STUB_READY"
read -r _ <"$STUB_LIFELINE"
STUB
chmod +x "$TMP/bin/pnpm"

LISTENER='import socket, sys
host = sys.argv[1]
s = socket.socket(socket.getaddrinfo(host, 0)[0][0])
s.bind((host, 0))
s.listen()
print(s.getsockname()[1], flush=True)
sys.stdin.read()'

# A listener on one loopback address (127.0.0.1 unless another is named).
start_bystander() {
  local host="${1:-127.0.0.1}"
  rm -f "$TMP/hold" "$TMP/port"
  mkfifo "$TMP/hold" "$TMP/port"
  exec 3<>"$TMP/hold"
  set -m
  python3 -c "$LISTENER" "$host" <"$TMP/hold" >"$TMP/port" 5>&- 6>&- 3>&- &
  BYSTANDER=$!
  set +m
  read -r BYSTANDER_PORT <"$TMP/port"
}

release_bystander() {
  exec 3>&-
  BYSTANDER_STATUS=0
  wait "$BYSTANDER" || BYSTANDER_STATUS=$?
}

free_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'
}

run_sut() {
  local rc=0
  PATH="$TMP/bin:$PATH" STUB_READY="$TMP/ready" STUB_LIFELINE="$TMP/lifeline" \
    bash "$SUT" "$@" >"$TMP/out" 2>&1 3>&- || rc=$?
  printf '%s\n' "$rc"
}

# The pid and arguments the stub server reported once it was running.
server_report() {
  local line
  read -t 10 -r line <&6 || fail "the dev server never started"
  printf '%s\n' "$line"
}

fail() {
  echo "FAIL: $1" >&2
  echo "--- web-dev-server output:" >&2; cat "$TMP/out" >&2
  exit 1
}

test_a_port_held_by_another_program_stops_dev_local_with_an_error() {
  local rc
  start_bystander
  rc="$(run_sut start "$BYSTANDER_PORT" "$TMP/a/web.pid" "$TMP/a/web.log")"
  [ "$rc" != 0 ] || fail "start must fail while another program holds the port"
  grep -qF "port $BYSTANDER_PORT is already in use" "$TMP/out" || fail "start must name the held port"
  [ ! -e "$TMP/a/web.pid" ] || fail "a refused start must not record a server"
  release_bystander
  [ "$BYSTANDER_STATUS" = 0 ] || fail "start signalled the program holding the port (status $BYSTANDER_STATUS)"
  echo "ok: a port another program holds stops start with an error, and that program keeps running"
}

test_dev_stop_ends_the_server_dev_local_started_and_nothing_else() {
  local rc pid
  start_bystander
  rc="$(run_sut start "$(free_port)" "$TMP/b/web.pid" "$TMP/b/web.log")"
  [ "$rc" = 0 ] || fail "start on a free port must succeed (exit $rc)"
  pid="$(sed -n 1p "$TMP/b/web.pid")"
  [ "$(server_report)" = "$pid --filter web dev" ] || fail "the pid file must name the server start launched"
  rc="$(run_sut stop "$TMP/b/web.pid")"
  [ "$rc" = 0 ] || fail "stop must succeed (exit $rc)"
  ! kill -0 "$pid" 2>/dev/null || fail "the server start launched is still running"
  [ ! -e "$TMP/b/web.pid" ] || fail "stop must remove the pid file"
  release_bystander
  [ "$BYSTANDER_STATUS" = 0 ] || fail "stop signalled a process it did not start (status $BYSTANDER_STATUS)"
  echo "ok: stop ends the server start launched, and only that server"
}

test_a_pid_file_naming_a_reused_pid_signals_nothing() {
  local rc
  start_bystander
  mkdir -p "$TMP/c"
  printf '%s\n%s\n' "$BYSTANDER" "Thu Jan  1 00:00:00 1970" >"$TMP/c/web.pid"
  rc="$(run_sut stop "$TMP/c/web.pid")"
  [ "$rc" = 0 ] || fail "a stale pid file is not an error (exit $rc)"
  grep -qF "nothing was signalled" "$TMP/out" || fail "stop must say it signalled nothing"
  [ ! -e "$TMP/c/web.pid" ] || fail "stop must drop the stale pid file"
  release_bystander
  [ "$BYSTANDER_STATUS" = 0 ] || fail "stop signalled the process now holding the recorded pid (status $BYSTANDER_STATUS)"
  echo "ok: a pid file whose pid now names another process signals nothing"
}

test_a_second_start_keeps_the_running_server_recorded() {
  local rc pid
  rc="$(run_sut start "$(free_port)" "$TMP/d/web.pid" "$TMP/d/web.log")"
  [ "$rc" = 0 ] || fail "the first start must succeed (exit $rc)"
  pid="$(server_report | cut -d ' ' -f 1)"
  rc="$(run_sut start "$(free_port)" "$TMP/d/web.pid" "$TMP/d/web.log")"
  [ "$rc" != 0 ] || fail "a second start must fail while the recorded server runs"
  grep -qF "still running" "$TMP/out" || fail "the second start must say the server is still running"
  [ "$(sed -n 1p "$TMP/d/web.pid")" = "$pid" ] || fail "the second start overwrote the running server's record"
  [ "$(run_sut stop "$TMP/d/web.pid")" = 0 ] || fail "stop must end the first server"
  ! kill -0 "$pid" 2>/dev/null || fail "the first server is still running"
  echo "ok: a second start leaves the running server recorded, so stop still ends it"
}

test_stop_with_nothing_recorded_succeeds_quietly() {
  [ "$(run_sut stop "$TMP/e/web.pid")" = 0 ] || fail "stop with no pid file must succeed"
  grep -qF "nothing to stop" "$TMP/out" || fail "stop must say there is nothing to stop"
  echo "ok: stop with nothing recorded succeeds and says so"
}

test_a_port_held_on_the_ipv6_loopback_alone_stops_dev_local() {
  local rc
  start_bystander ::1
  rc="$(run_sut start "$BYSTANDER_PORT" "$TMP/f/web.pid" "$TMP/f/web.log")"
  [ "$rc" != 0 ] || fail "start must fail while another program holds the port on ::1"
  grep -qF "port $BYSTANDER_PORT is already in use" "$TMP/out" || fail "start must name the port held on ::1"
  release_bystander
  [ "$BYSTANDER_STATUS" = 0 ] || fail "start signalled the program holding the port on ::1 (status $BYSTANDER_STATUS)"
  echo "ok: a port held on the IPv6 loopback alone stops start too"
}

# Asked of names_running_server alone, never through stop: with this guard
# broken, stop would signal process group 1, which is every process there is.
test_pid_one_names_no_server_even_with_its_own_start_time() {
  local started
  # shellcheck source=scripts/web-dev-server.sh
  started="$( (source "$SUT"; start_time_of 1) )"
  [ -n "$started" ] || fail "pid 1's start time must be readable for this case to mean anything"
  mkdir -p "$TMP/g"
  printf '%s\n%s\n' 1 "$started" >"$TMP/g/web.pid"
  # shellcheck source=scripts/web-dev-server.sh
  ! (source "$SUT"; names_running_server "$TMP/g/web.pid") || fail "pid 1 named the server; stop would signal every process"
  echo "ok: pid 1 names no server, even recorded with its own start time"
}

test_a_port_held_by_another_program_stops_dev_local_with_an_error
test_dev_stop_ends_the_server_dev_local_started_and_nothing_else
test_a_pid_file_naming_a_reused_pid_signals_nothing
test_a_second_start_keeps_the_running_server_recorded
test_stop_with_nothing_recorded_succeeds_quietly
test_a_port_held_on_the_ipv6_loopback_alone_stops_dev_local
test_pid_one_names_no_server_even_with_its_own_start_time
echo "web-dev-server.test.sh: all green"
