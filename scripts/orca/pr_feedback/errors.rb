# frozen_string_literal: true

module Orca
  module PrFeedback
    class Failure < StandardError; end

    module Shape
      BOOLEAN = [TrueClass, FalseClass].freeze

      module_function

      def object!(value, label)
        return value if value.is_a?(Hash)

        raise Failure, "#{label} must be an object"
      end

      def array!(value, label)
        return value if value.is_a?(Array)

        raise Failure, "#{label} must be an array"
      end

      def field!(object, key, types, label)
        raise Failure, "#{label} is missing #{key}" unless object.key?(key)

        value = object[key]
        return value if Array(types).any? { |type| value.is_a?(type) }

        raise Failure, "#{label}.#{key} has an invalid type"
      end

      def fields!(object, specification, label)
        specification.each { |key, types| field!(object, key, types, label) }
        object
      end

      def nonempty!(value, label)
        return value unless value.empty?

        raise Failure, "#{label} must not be empty"
      end
    end
  end
end
