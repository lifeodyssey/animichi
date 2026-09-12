# frozen_string_literal: true

require "json"
require "open3"

module Orca
  module PrFeedback
    class GhTransport
      def run(argv)
        stdout, stderr, status = Open3.capture3(*argv)
        return stdout if status.success?

        detail = stderr.strip
        detail = "exit #{status.exitstatus}" if detail.empty?
        raise Failure, "gh failed: #{detail}"
      rescue SystemCallError => error
        raise Failure, "gh failed: #{error.message}"
      end
    end

    class JsonCommand
      def initialize(transport)
        @transport = transport
      end

      def run(argv, label)
        JSON.parse(@transport.run(argv))
      rescue JSON::ParserError => error
        raise Failure, "#{label} returned malformed JSON: #{error.message}"
      end
    end

    class GitHubClient
      def initialize(transport)
        @json = JsonCommand.new(transport)
      end

      def rest(endpoint, label)
        @json.run(["gh", "api", "--method", "GET", endpoint], label)
      end

      def graphql(query, variables, label)
        payload = @json.run(graphql_argv(query, variables), label)
        graphql_data(payload, label)
      end

      private

      def graphql_argv(query, variables)
        ["gh", "api", "graphql", "-f", "query=#{query}"] + graphql_fields(variables)
      end

      def graphql_fields(variables)
        variables.each_with_object([]) do |(key, value), argv|
          next if value.nil?

          argv.concat([value.is_a?(Integer) ? "-F" : "-f", "#{key}=#{value}"])
        end
      end

      def graphql_data(payload, label)
        object = Shape.object!(payload, label)
        reject_graphql_errors!(object, label)
        Shape.field!(object, "data", Hash, label)
      end

      def reject_graphql_errors!(payload, label)
        return unless payload.key?("errors")

        errors = Shape.array!(payload["errors"], "#{label}.errors")
        return if errors.empty?

        raise Failure, "#{label} returned GraphQL errors: #{JSON.generate(errors)}"
      end
    end
  end
end
