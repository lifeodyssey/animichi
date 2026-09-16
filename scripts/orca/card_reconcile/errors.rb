# frozen_string_literal: true

module Orca
  module CardReconcile
    class Failure < StandardError
      # The exit status of the command that failed, when there was one. A git read whose answer *is*
      # its status (`merge-base --is-ancestor`) has to tell a definitive "no" from an unreadable read.
      attr_reader :status

      def initialize(message, status = nil)
        super(message)
        @status = status
      end
    end

    module Shape
      module_function

      def hash!(value, label)
        return value if value.is_a?(Hash)

        raise Failure, "#{label} must be an object"
      end

      def text!(value, label)
        return value if value.is_a?(String) && !value.empty?

        raise Failure, "#{label} must be a non-empty string"
      end

      def integer!(value, label)
        return value if value.is_a?(Integer)

        raise Failure, "#{label} must be an integer"
      end

      def time(value)
        return nil if value.nil?

        Time.parse(value.to_s).utc
      rescue ArgumentError
        nil
      end
    end
  end
end
