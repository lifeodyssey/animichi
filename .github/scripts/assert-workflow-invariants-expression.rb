# frozen_string_literal: true

# Semantic evaluator for GitHub Actions `cancel-in-progress` expressions,
# owned by assert-workflow-invariants.rb (B7 concurrency check, GOAL B.21).
# Splitting keeps the assertions file under the 300-line budget; this file
# contains no checks, only the three-valued expression judgment.
#
# The evaluator speaks the subset the design-CI-1 template family and its safe
# variants use: == / != over github.event_name and github.ref, string
# literals, literal true/false, ! negation, && / ||, parentheses. Anything
# else raises UnsupportedExpression and the caller fail-closes — a wrong guess
# on a blocking gate would lock the whole repo.

# Three-valued boolean: true / false / UNKNOWN. An expression that cannot be
# judged yields UNKNOWN and the gate demands human confirmation.
UNKNOWN = :unknown

class UnsupportedExpression < StandardError; end

TOKEN_RE = /\G\s*(==|!=|&&|\|\||!|\(|\)|'[^']*'|"[^"]*"|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/

def expr_tokens(source)
  tokens = []
  offset = 0
  until offset >= source.length
    match = TOKEN_RE.match(source, offset)
    raise UnsupportedExpression, "unrecognized token #{source[offset..].inspect}" unless match
    tokens << match[1]
    offset = match.end(0)
  end
  tokens
end

# Recursive-descent parser -> AST of [:eq|:not|:and|:or, ...] / [:ident, name]
# / [:string, value]. Kept tiny on purpose: unknown syntax must raise, not
# silently misparse.
class ExprParser
  def initialize(tokens)
    @tokens = tokens
    @index = 0
  end

  def parse
    node = parse_or
    raise UnsupportedExpression, "trailing tokens #{@tokens[@index..].inspect}" unless @index == @tokens.length
    node
  end

  def parse_or
    left = parse_and
    while current == "||"
      advance
      left = [:or, left, parse_and]
    end
    left
  end

  def parse_and
    left = parse_not
    while current == "&&"
      advance
      left = [:and, left, parse_not]
    end
    left
  end

  def parse_not
    if current == "!"
      advance
      return [:not, parse_not]
    end
    parse_equality
  end

  def parse_equality
    left = parse_primary
    return left unless %w[== !=].include?(current)
    op = advance
    [:eq, op, left, parse_primary]
  end

  def parse_primary
    token = advance
    raise UnsupportedExpression, "unexpected end of expression" unless token
    if token == "("
      node = parse_or
      raise UnsupportedExpression, "missing closing )" unless advance == ")"
      node
    elsif token.start_with?("'", '"')
      [:string, token[1..-2]]
    elsif %w[== != && || !)].include?(token)
      raise UnsupportedExpression, "unexpected operator #{token}"
    else
      [:ident, token]
    end
  end

  def current
    @tokens[@index]
  end

  def advance
    token = @tokens[@index]
    @index += 1
    token
  end
end

# Three-valued logic: false dominates &&, true dominates ||, everything else
# with an UNKNOWN operand stays UNKNOWN.
def expr_eval(node, world)
  case node[0]
  when :ident
    world.key?(node[1]) ? world[node[1]] : node[1] == "true" ? true : node[1] == "false" ? false : UNKNOWN
  when :string
    node[1]
  when :eq
    left = expr_eval(node[2], world)
    right = expr_eval(node[3], world)
    return UNKNOWN if left == UNKNOWN || right == UNKNOWN
    node[1] == "==" ? left == right : left != right
  when :not
    value = expr_eval(node[1], world)
    value == UNKNOWN ? UNKNOWN : !value
  when :and
    left = expr_eval(node[1], world)
    return false if left == false
    right = expr_eval(node[2], world)
    return false if right == false
    left == true && right == true ? true : UNKNOWN
  when :or
    left = expr_eval(node[1], world)
    return true if left == true
    right = expr_eval(node[2], world)
    return true if right == true
    left == false && right == false ? false : UNKNOWN
  end
end

# Worlds the expression is judged under: a PR-class run and a push-to-main run.
# A PR-class run (pull_request or pull_request_target) has event_name equal to
# its triggering event and a ref under refs/pull; a push-to-main run has
# event_name push and ref refs/heads/main. Deploy safety is judged on
# push-to-main only — cancelling a push to a feature branch is harmless.
# Each PR-class event gets its own world so a cancel-in-progress that only
# cancels `pull_request` runs cannot satisfy a workflow that also (or only)
# fires on `pull_request_target` — and vice versa.
EVENT_NAME = "github.event_name"
REF = "github.ref"

def world_for_pr_event(event)
  { EVENT_NAME => event, REF => "refs/pull/1/merge" }.freeze
end

WORLD_PR = world_for_pr_event("pull_request")
WORLD_PUSH_MAIN = { EVENT_NAME => "push", REF => "refs/heads/main" }.freeze

def expr_verdict(expression, world)
  body = expression.sub(/\A\s*\$\{\{\s*/, "").sub(/\s*\}\}\s*\z/, "")
  ast = ExprParser.new(expr_tokens(body)).parse
  expr_eval(ast, world)
rescue UnsupportedExpression
  UNKNOWN
end
