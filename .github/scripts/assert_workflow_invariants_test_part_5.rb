# frozen_string_literal: true

# ── Unit (196C): stray operators must raise at parse time, not degrade into
# [:ident, ...] nodes that surface as UNKNOWN with the wrong diagnosis. The
# guard list must treat `!` and `)` as separate tokens. ───────────────────────
require_relative "assert-workflow-invariants-expression"

def assert_parser_rejects(expression, label)
  body = expression.sub(/\A\s*\$\{\{\s*/, "").sub(/\s*\}\}\s*\z/, "")
  ast = ExprParser.new(expr_tokens(body)).parse
  abort "FAIL: #{label} must raise UnsupportedExpression, parsed #{ast.inspect}"
rescue UnsupportedExpression
  puts "PASS: #{label} raises UnsupportedExpression"
end

assert_parser_rejects("${{ ) == 'x' }}", "stray closing paren")
assert_parser_rejects("${{ ! == 'x' }}", "bare not")
assert_parser_rejects("${{ && }}", "bare and")
assert_parser_rejects("${{ 'a' || }}", "trailing or")

puts "All assert-workflow-invariants.rb behavioral tests passed."
# frozen_string_literal: true
