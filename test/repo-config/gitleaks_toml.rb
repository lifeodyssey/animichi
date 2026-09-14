# frozen_string_literal: true
# Restricted TOML reader for the repository gitleaks contract
# (test/repo-config/gitleaks.test.rb).
#
# Why a reader instead of a regex: gitleaks loads .gitleaks.toml through Viper,
# which lowercases every key and unmarshals with weak typing. Measured against
# gitleaks 8.30.1, every spelling below changes detection and none of them is
# `id = "github-pat"` on one raw line:
#
#   [[rules]]                  [["rules"]]              [[Rules]]      [rules]
#   id = """github-pat"""      id = '''github-pat'''    "id" = "github-pat"
#   id = "github\u002dpat"     ID = "github-pat"        \u0072ules as a header
#   stopwords = ["AIza\u0053y"]                        stopwords = "AIzaSy"
#
# It decodes the TOML subset a repository gitleaks config may use and raises
# Unsupported for everything else, so a spelling the contract cannot compare is
# refused instead of silently ignored. Inline tables, arrays of inline tables,
# and datetime values are the valid-but-unsupported cases; extend this reader
# before they appear in .gitleaks.toml (the contract flunks with UNREADABLE).

module GitleaksToml
  Unsupported = Class.new(StandardError)
  Assignment = Struct.new(:path, :key, :value)

  # Allowlist keys the contract compares against its probe secrets.
  ALLOWLIST_KEYS = %w[paths regexes stopwords].freeze

  def self.read(text)
    Reader.new(text).read
  end

  def self.allowlists(assignments)
    assignments.select { |assignment| assignment.path.split(".").last.to_s.downcase.start_with?("allowlist") }
  end

  def self.rule_ids(assignments)
    assignments.select { |assignment| assignment.path.casecmp?("rules") && assignment.key.casecmp?("id") }
               .map(&:value)
  end

  # The value if it is an array of strings, nil for every other shape.
  def self.strings(assignment)
    value = assignment.value
    value if value.is_a?(Array) && value.all? { |item| item.is_a?(String) }
  end

  # Restricted TOML scanner: headers, key/value assignments, and the string,
  # boolean, number, and string-array values a gitleaks config uses. Keys keep
  # their spelling and are compared case-insensitively by the caller, which is
  # what Viper's key lowercasing does to them.
  class Reader
    BARE_KEY = /[A-Za-z0-9_-]/
    ESCAPES = { "b" => "\b", "t" => "\t", "n" => "\n", "f" => "\f", "r" => "\r", '"' => '"', "\\" => "\\" }.freeze

    def initialize(text)
      @text = text
      @pos = 0
      @line = 1
      @path = ""
      @assignments = []
    end

    def read
      loop do
        skip_trivia
        break if eof?
        peek == "[" ? table : key_value
      end
      @assignments
    end

    def table
      array = peek(2) == "[["
      advance(array ? 2 : 1)
      @path = key_path.join(".")
      close = array ? "]]" : "]"
      raise Unsupported, failure("table header is not closed") unless peek(close.length) == close
      advance(close.length)
      end_of_statement
    end

    def key_value
      parts = key_path
      skip_spaces
      raise Unsupported, failure("expected '=' after #{parts.join('.')}") unless peek == "="
      advance
      value = value_after_equals
      end_of_statement
      @assignments << Assignment.new(join(parts), parts.last, value)
    end

    def join(parts)
      [@path, parts[0..-2].join(".")].reject(&:empty?).join(".")
    end

    def key_path
      parts = []
      loop do
        skip_spaces
        parts << key_part
        skip_spaces
        return parts unless peek == "."
        advance
      end
    end

    def key_part
      return basic_string if peek == '"'
      return literal_string if peek == "'"
      bare_key
    end

    def bare_key
      key = +""
      key << advance while peek =~ BARE_KEY
      raise Unsupported, failure("empty key") if key.empty?
      key
    end

    def value_after_equals
      skip_spaces
      return delimited_string('"""', true) if peek(3) == '"""'
      return delimited_string("'''", false) if peek(3) == "'''"
      return basic_string if peek == '"'
      return literal_string if peek == "'"
      return array if peek == "["
      scalar
    end

    def scalar
      token = +""
      token << advance while peek =~ /[^\s,\]#}]/
      return true if token == "true"
      return false if token == "false"
      numeric(token)
    end

    def numeric(token)
      value = Integer(token, exception: false)
      value = Float(token, exception: false) if value.nil?
      raise Unsupported, failure("value #{token.inspect} is not a string, boolean, or number") if value.nil?
      value
    end

    def array
      advance
      elements = []
      elements << element until at("]")
      advance
      elements
    end

    def at(token)
      skip_trivia
      peek == token
    end

    def element
      value = value_after_equals
      skip_trivia
      return value if peek == "]"
      raise Unsupported, failure("missing ',' in array after #{value.inspect}") unless peek == ","
      advance
      value
    end

    def basic_string
      advance
      value = +""
      value << next_basic_char until peek == '"'
      advance
      value
    end

    def next_basic_char
      raise Unsupported, failure("unterminated basic string") if eof? || peek == "\n"
      peek == "\\" ? escape_sequence : advance
    end

    def literal_string
      advance
      value = +""
      value << next_literal_char until peek == "'"
      advance
      value
    end

    def next_literal_char
      raise Unsupported, failure("unterminated literal string") if eof? || peek == "\n"
      advance
    end

    def delimited_string(delimiter, escapes)
      advance(3)
      advance if peek == "\n"
      value = +""
      value << next_delimited_char(escapes) until peek(3) == delimiter
      advance(3)
      value
    end

    def next_delimited_char(escapes)
      raise Unsupported, failure("unterminated multiline string") if eof?
      return continuation if escapes && peek(2) =~ /\\[ \t\r\n]/
      return escape_sequence if escapes && peek == "\\"
      advance
    end

    def continuation
      advance
      advance while peek =~ /[ \t\r\n]/
      ""
    end

    def escape_sequence
      advance
      char = advance
      return unicode(char == "u" ? 4 : 8) if %w[u U].include?(char)
      ESCAPES.fetch(char) { raise Unsupported, failure("unsupported escape \\#{char}") }
    end

    def unicode(length)
      digits = advance(length)
      raise Unsupported, failure("invalid unicode escape") unless digits =~ /\A\h{#{length}}\z/
      codepoint = digits.to_i(16)
      raise Unsupported, failure("code point out of range") if (0xD800..0xDFFF).cover?(codepoint) || codepoint > 0x10FFFF
      [codepoint].pack("U")
    end

    def skip_trivia
      loop do
        advance while peek =~ /[ \t\r\n]/
        break unless peek == "#"
        advance until eof? || peek == "\n"
      end
    end

    def skip_spaces
      advance while peek =~ /[ \t]/
    end

    def end_of_statement
      skip_spaces
      trailing = peek
      raise Unsupported, failure("unexpected trailing token #{trailing.inspect}") unless ["", "#", "\n"].include?(trailing)
      advance until eof? || peek == "\n"
      advance if peek == "\n"
    end

    def eof?
      @pos >= @text.length
    end

    def peek(length = 1)
      @text[@pos, length].to_s
    end

    def advance(length = 1)
      taken = peek(length)
      @line += taken.count("\n")
      @pos += taken.length
      taken
    end

    def failure(message)
      "#{message} at line #{@line}"
    end
  end
end
