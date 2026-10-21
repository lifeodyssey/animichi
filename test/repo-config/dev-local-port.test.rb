# SUT: the local dev port contract between `make dev-local` and apps/web's Vite
# dev server. `make dev-local` announces the web app on http://localhost:3000 —
# matching supabase/config.toml's site_url, scripts/local-login.sh's default
# origin and the Playwright suite's default base URL — but the announcement was
# false (ANI-19): vite.config.ts declared no port, so `vite dev` bound Vite's
# default :5173 and every :3000 entry point refused the connection. Both sides
# of the announcement are pinned to one explicitly configured port here, so
# neither can move without the other, and strictPort keeps Vite from silently
# drifting to the next free port when :3000 is taken (the same lie in a
# different disguise).
require "minitest/autorun"

class DevLocalPortTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  LOCAL_DEV_PORT = "3000"
  MAKEFILE = File.join(ROOT, "Makefile")
  VITE_CONFIG = File.join(ROOT, "apps/web/vite.config.ts")

  def setup
    @makefile = File.read(MAKEFILE)
    @vite_config = File.read(VITE_CONFIG)
  end

  def test_web_dev_server_declares_the_local_dev_port
    assert vite_port, "apps/web/vite.config.ts declares no dev-server port, " \
                      "so vite dev falls back to Vite's default :5173 while dev-local announces :#{LOCAL_DEV_PORT}"
    assert_equal LOCAL_DEV_PORT, vite_port,
                 "apps/web's dev server must bind the port every local entry point assumes"
  end

  def test_dev_local_announces_the_port_the_dev_server_binds
    announced = @makefile[/Web app:\s+http:\/\/localhost:(\d+)/, 1]
    assert_equal LOCAL_DEV_PORT, announced,
                 "make dev-local must announce http://localhost:#{LOCAL_DEV_PORT} — the origin " \
                 "supabase/config.toml's site_url and scripts/local-login.sh assume"
  end

  def test_dev_server_cannot_silently_drift_off_the_announced_port
    assert_includes @vite_config, "strictPort: true",
                    "without strictPort, vite hops to the next free port when :#{LOCAL_DEV_PORT} is taken " \
                    "and the dev-local announcement lies again"
  end

  def vite_port
    @vite_config[/server:\s*\{[^}]*?port:\s*(\d+)/, 1]
  end
end
