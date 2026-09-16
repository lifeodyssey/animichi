# frozen_string_literal: true

module Orca
  module CardReconcile
    Hold = Struct.new(:card, :predicate, :target, :since, :satisfied, :detail)

    module HoldPredicates
      PR_MERGED = "pr_merged".freeze
      NO_OPEN_PR = "no_open_pr_touches".freeze
      NAMES = [PR_MERGED, NO_OPEN_PR].freeze

      module_function

      def validate!(name, card)
        return name if NAMES.include?(name)

        raise Failure, "hold for card #{card} has an unsupported release condition " \
                       "#{name.inspect}; supported predicates: #{NAMES.join(', ')}"
      end

      def target!(name, value, card)
        expected = name == PR_MERGED ? Integer : String
        return value if value.is_a?(expected)

        raise Failure, "hold for card #{card} predicate #{name.inspect} needs a " \
                       "#{expected == Integer ? 'pull request number' : 'path'}"
      end
    end

    class HoldStore
      def initialize(path)
        @path = path
      end

      def load
        return {} unless @path && File.file?(@path)

        entries.each_with_object({}) { |entry, result| result[card!(entry)] = hold(entry) }
      end

      private

      def entries
        value = JSON.parse(Receipt.read_text(@path).to_s)
        list = value.is_a?(Hash) ? value["holds"] : value
        raise Failure, "hold file #{@path} must be a list of holds" unless list.is_a?(Array)

        list
      end

      def card!(entry)
        Shape.hash!(entry, "hold in #{@path}")
        card = entry["card"]
        return card if card.is_a?(Integer)

        raise Failure, "hold in #{@path} needs an integer card"
      end

      def hold(entry)
        card = entry["card"]
        until_ = entry["until"]
        reject_free_text!(until_, card)
        name, target = until_.first
        HoldPredicates.validate!(name, card)
        Hold.new(card, name, HoldPredicates.target!(name, target, card),
                 Shape.time(entry["since"]) || File.mtime(@path), false, nil)
      end

      def reject_free_text!(value, card)
        return if value.is_a?(Hash) && !value.empty?

        raise Failure, "hold for card #{card} has a free-text release condition " \
                       "#{value.inspect}; a hold needs a machine-checkable predicate " \
                       "(#{HoldPredicates::NAMES.join(', ')})"
      end
    end

    class HoldEvaluator
      def initialize(open_pull_requests, pull_request_state)
        @open = open_pull_requests
        @state = pull_request_state
      end

      def evaluate(hold)
        satisfied, detail = hold.predicate == HoldPredicates::PR_MERGED ? merged(hold) : touches(hold)
        hold.satisfied = satisfied
        hold.detail = detail
        hold
      end

      private

      def merged(hold)
        state = @state.call(hold.target)
        [state == "MERGED", "pr_merged #{hold.target} -> #{state || 'unknown'}"]
      end

      def touches(hold)
        return [false, "unproven: open pull requests unavailable"] if @open.nil?

        truncated = @open.find(&:files_truncated)
        return [false, "unproven: ##{truncated.number} lists 100 files"] if truncated

        hit = @open.find { |pr| pr.files.any? { |path| matches?(hold.target, path) } }
        [hit.nil?, hit ? "##{hit.number} touches #{hold.target}" : "nothing open touches #{hold.target}"]
      end

      def matches?(pattern, path)
        File.fnmatch(pattern, path, File::FNM_PATHNAME) || File.fnmatch(pattern, path)
      end
    end
  end
end
