# frozen_string_literal: true

# Command/script fingerprints from a workflow `run:` block or a gate script
# line. Identity is the invoked script path or a normalized check command —
# not a job name and not a YAML line number (#1114).

CHECK_PREFIX = /\A(?:ruby(?:\s+-c)?|bash|sh|python3?|uvx|uv\s+tool\s+run|pnpm|npm|npx|node|atlas|actionlint|docker\s+build|wrangler|pulumi|sqlfluff|semgrep|playwright|make|ruff|mypy|vulture|pytest|shellcheck|git\s+diff)\b/

SCRIPT_INVOKE = %r{
  (?:ruby(?:\s+-c)?|bash|python3?|node(?:\s+--test)?|uv\s+run\s+--script)
  (?:\s+--import\s+\S+)*
  \s+
  ([.\w/-]+\.(?:rb|sh|py|ts|mjs))
}x

LISTED_SCRIPTS = %r{(?:\.github/scripts|scripts/local-gates)/[\w.-]+\.(?:rb|sh|py)}

SHELL_NOISE = /\A(?:if|then|fi|for|do|done|case|esac|while|else|elif|in|return|exit|break|continue|local|export|declare|trap|shift|set|source|:)\b/
ASSIGNMENT_ONLY = /\A[A-Za-z_][A-Za-z0-9_]*=(?:\S.*)?\z/
TEST_BRACKET = /\A(?:\[|\[\[|test)\b/

def strip_shell_comment(line)
  in_s = false
  in_d = false
  out = +""
  i = 0
  while i < line.length
    c = line[i]
    consumed = comment_char(line, i, c, in_s, in_d, out)
    break if consumed == :comment
    in_s, in_d, i = consumed
  end
  out.strip
end

def comment_char(line, i, char, in_s, in_d, out)
  return quote_single(char, in_s, in_d, out, i) if in_s
  return quote_double(line, i, char, in_s, in_d, out) if in_d
  return start_quote(char, in_s, in_d, out, i) if char == "'" || char == '"'
  return :comment if comment_start?(line, i, char)

  out << char
  [in_s, in_d, i + 1]
end

def quote_single(char, in_s, in_d, out, i)
  in_s = false if char == "'"
  out << char
  [in_s, in_d, i + 1]
end

def quote_double(line, i, char, in_s, in_d, out)
  if char == "\\"
    out << char << line[i + 1].to_s
    return [in_s, in_d, i + 2]
  end
  in_d = false if char == '"'
  out << char
  [in_s, in_d, i + 1]
end

def start_quote(char, in_s, in_d, out, i)
  out << char
  [char == "'" || in_s, char == '"' || in_d, i + 1]
end

def comment_start?(line, index, char)
  char == "#" && (index.zero? || line[index - 1].match?(/[[:space:]]/))
end

def split_shell_commands(run)
  run.to_s.gsub("\\\n", " ").split(/\n/).flat_map do |raw|
    line = strip_shell_comment(raw)
    next [] if line.empty?

    line.split(/\s*(?:&&|\|\|)\s*/).map(&:strip).reject(&:empty?)
  end
end

def expand_gate_vars(text)
  text.gsub(%r{"\$GS/}, ".github/scripts/")
      .gsub("$GS/", ".github/scripts/")
      .gsub(%r{"\$GS"/}, ".github/scripts/")
      .gsub("$GS\"/", ".github/scripts/")
      .gsub(%r{"\$SCRIPT_DIR/}, "scripts/local-gates/")
      .gsub("$SCRIPT_DIR/", "scripts/local-gates/")
end

def package_from_dir(dir)
  return nil if dir.nil? || dir.empty? || dir == "."

  parts = dir.to_s.sub(%r{\A\./}, "").split("/")
  return nil if parts.empty? || parts[0].include?("$") || parts[0].include?("{")
  return parts[1] if %w[apps workers packages].include?(parts[0]) && parts.size >= 2

  parts[0]
end

def pnpm_filter(cmd)
  return [nil, cmd] unless cmd.start_with?("pnpm", "npm")
  return pnpm_named_flag(cmd, /(?:--filter|-F)\s+(\S+)/) if cmd.match?(/(?:--filter|-F)\s+\S+/)
  return pnpm_dir_flag(cmd) if cmd.match?(/(?:--dir|-C)\s+\S+/)

  [nil, cmd]
end

def pnpm_named_flag(cmd, pattern)
  pkg = cmd.match(pattern)[1]
  [pkg, cmd.sub(/\s*(?:--filter|-F)\s+\S+/, "")]
end

def pnpm_dir_flag(cmd)
  dir = cmd.match(/(?:--dir|-C)\s+(\S+)/)[1]
  [package_from_dir(dir) || dir, cmd.sub(/\s*(?:--dir|-C)\s+\S+/, "")]
end

def strip_prefix_assignments(cmd)
  cmd.sub(/\A(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, "")
end

def normalize_cmd(cmd)
  s = strip_prefix_assignments(cmd.dup)
  s.gsub!(/\$\{\{[^}]+\}\}/, "")
  s.gsub!(/\benv(?:\s+-u\s+\S+|\s+[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+))*\s+/, "")
  s.gsub!(/\buv run(?:\s+--(?:frozen|no-build|script|locked|no-sync)|\s+--no-binary-package\s+\S+)+/, "uv run")
  s.gsub!(/\buv tool run(?:\s+--no-build)?/, "uv tool run")
  s.gsub!(/\buvx(?:\s+--no-build)?/, "uvx")
  s.gsub!(/\s+--outdir\s+\S+/, "")
  s.gsub!(/\s+(?:-color|--color)\b/, "")
  s.gsub!(%r{\A\./actionlint\b}, "actionlint")
  s.gsub!(/\s+--env=""/, " --env=")
  s.gsub!(/\Auv run /, "")
  s.gsub!(/\Apython(?:3)? -m pytest\b/, "pytest")
  s.gsub(/\s+/, " ").strip
end

def skip_check_cmd?(cmd)
  return true if cmd.empty? || cmd.match?(SHELL_NOISE) || cmd.match?(ASSIGNMENT_ONLY)
  return true if cmd.match?(TEST_BRACKET) || cmd.start_with?("{", "}", "(", ")", ";;")
  return true if setup_install?(cmd) || plumbing_cmd?(cmd)
  return true if cmd.match?(/\Apython(?:3)? -c\b/) || cmd.include?("wrangler dev")
  return true if cmd.match?(/\Aruby -c "\$/)

  false
end

def setup_install?(cmd)
  cmd.match?(/\A(?:uv python install|uv sync|pnpm install|npm install)\b/) ||
    cmd.include?("playwright install") ||
    cmd.include?("playwright --version")
end

def plumbing_cmd?(cmd)
  cmd.match?(/\A(?:curl|tar|mkdir|mv|cp|chmod|sha256sum|corepack|sleep|kill|tee|gh)\b/) ||
    cmd.match?(/\Apulumi package add\b/) ||
    cmd.match?(/\Agit (?:checkout --|add)\b/) ||
    cmd.include?("GITHUB_OUTPUT") ||
    cmd.include?("GITHUB_ENV") ||
    cmd.match?(%r{\Adocker build -f apps/agent/docker/})
end

def canonical_fingerprint(fp)
  s = fp.gsub('"', "")
  s = s.sub("::npm ", "::pnpm ").sub("::pnpm run ", "::pnpm ")
  s = s.gsub("../../apps/agent/", "apps/agent/")
  s = fold_script_rel(s)
  s = fold_pytest(s)
  s = fold_ruff(s)
  s = fold_git_diff(s)
  s = fold_playwright(s)
  s = fold_atlas_apply(s)
  s = fold_pulumi(s)
  s
end

def fold_script_rel(fp)
  return fp unless fp.start_with?("script:")

  "script:#{fp.sub(/\Ascript:/, "").sub(%r{\A(?:\.\./)+}, "")}"
end

def fold_pytest(fp)
  return fp unless fp =~ /\A(cmd:[^:]+::pytest )(.+)\z/

  paths = Regexp.last_match(2).split.reject { |tok| tok.start_with?("-") }
  "#{Regexp.last_match(1)}#{paths.join(' ').sub(%r{/\z}, '')}"
end

def fold_ruff(fp)
  return fp unless fp =~ /\A(cmd:[^:]+::ruff (?:check|format(?: --check)?))\b/

  Regexp.last_match(1)
end

def fold_git_diff(fp)
  s = fp.sub(/\bgit diff --exit-code(?: HEAD)? -- /, "git diff --exit-code -- ")
  return s unless s.include?("agent_models.py")

  "cmd:git diff --exit-code -- apps/agent/src/animichi/interfaces/boundary/agent_models.py"
end

def fold_playwright(fp)
  fp.sub(/playwright test.*/, "playwright test")
end

def fold_atlas_apply(fp)
  fp.sub(/\b(atlas migrate apply)\b.*/, '\1')
end

def fold_pulumi(fp)
  fp.sub(/\b(pulumi (?:login|preview|up|stack))\b.*/, '\1')
end

def fingerprints_from_run(run, workdir)
  text = expand_gate_vars(run.to_s)
  found = invoked_script_fps(text)
  found.concat(command_fps(text, workdir))
  found.map { |fp| canonical_fingerprint(fp) }
end

def invoked_script_fps(text)
  found = text.scan(SCRIPT_INVOKE).flatten.map { |path| "script:#{path.sub(%r{\A\./}, "")}" }
  return found unless text.include?("ruby -c")

  found.concat(text.scan(LISTED_SCRIPTS).map { |path| "script:#{path}" })
end

def direct_script_cmd(cmd)
  return nil unless cmd =~ %r{\A(?:\./)?((?:\.github/scripts|scripts)/[\w./-]+\.(?:rb|sh|py|mjs))\b}

  "script:#{Regexp.last_match(1)}"
end

def command_fps(text, workdir)
  found = []
  split_shell_commands(text).each do |raw|
    fp = one_command_fp(raw, workdir)
    found << fp if fp
  end
  found
end

def one_command_fp(raw, workdir)
  cmd = normalize_cmd(raw)
  return nil if skip_check_cmd?(cmd) || cmd.match?(SCRIPT_INVOKE)

  script_fp = direct_script_cmd(cmd)
  return script_fp if script_fp

  pkg_command_fp(cmd, workdir)
end

def pkg_command_fp(cmd, workdir)
  pkg, rest = pnpm_filter(cmd)
  rest = normalize_cmd(rest)
  return nil unless rest.match?(CHECK_PREFIX)

  pkg ||= package_from_dir(workdir)
  prefix = pkg ? "#{pkg}::" : ""
  "cmd:#{prefix}#{rest}"
end
