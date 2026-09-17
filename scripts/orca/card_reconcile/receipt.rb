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

      # A receipt whose fields a reader derives rows from: every named field must be present and
      # well-formed, so a malformed receipt refuses the read instead of nil-ing into the ladder.
      def read_validated(path, label, fields)
        document = read(path, label)
        fields.each do |field, type|
          Shape.public_send("#{type}!", document[field], "#{label} #{field}")
        end
        document
      end

      def read_validated_optional(path, label, fields)
        return nil unless File.file?(path)

        read_validated(path, label, fields)
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
