# frozen_string_literal: true

require "json"
require "time"

module Orca
  module CardReconcile
    module Receipt
      module_function

      def read(path, label)
        parse(File.read(path), path, label)
      rescue SystemCallError, ArgumentError => error
        raise Failure, "#{label} at #{path} is unreadable: #{error.message}"
      end

      def read_optional(path, label)
        return nil unless File.file?(path)

        read(path, label)
      end

      def read_text(path)
        File.read(path, encoding: "UTF-8", invalid: :replace, undef: :replace)
      rescue SystemCallError, ArgumentError
        nil
      end

      def parse(json, path, label)
        Shape.hash!(JSON.parse(json), "#{label} at #{path}")
      rescue JSON::ParserError => error
        raise Failure, "#{label} at #{path} is not JSON: #{error.message}"
      end
    end
  end
end
