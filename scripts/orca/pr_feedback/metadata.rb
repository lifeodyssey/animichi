# frozen_string_literal: true

module Orca
  module PrFeedback
    Repository = Struct.new(:owner, :name) do
      OWNER = /\A[A-Za-z0-9][A-Za-z0-9-]{0,38}\z/.freeze
      NAME = /\A[A-Za-z0-9._-]{1,100}\z/.freeze

      def self.parse(value)
        parts = value.to_s.split("/", -1)
        raise Failure, "--repo must be OWNER/REPO" unless valid_parts?(parts)

        new(parts[0], parts[1])
      end

      def self.valid_parts?(parts)
        parts.length == 2 && parts[0].match?(OWNER) && parts[1].match?(NAME) &&
          !parts[0].end_with?("-") && ![".", ".."].include?(parts[1])
      end

      def full_name
        "#{owner}/#{name}"
      end
    end

    module PullRequestNumber
      module_function

      def parse(value)
        number = value.is_a?(Integer) ? value : Integer(value, 10)
        raise Failure, "--pr must be a positive integer" unless number.positive?

        number
      rescue ArgumentError, TypeError
        raise Failure, "--pr must be a positive integer"
      end
    end

    module Projection
      module_function

      def from(source, mapping)
        mapping.each_with_object({}) { |(target, key), result| result[target] = source.fetch(key) }
      end
    end

    class Metadata
      FIELDS = { "number" => Integer, "node_id" => String, "html_url" => String,
                 "title" => String, "state" => String, "draft" => Shape::BOOLEAN,
                 "merged" => Shape::BOOLEAN, "merged_at" => [String, NilClass],
                 "merge_commit_sha" => [String, NilClass], "mergeable" => Shape::BOOLEAN + [NilClass],
                 "mergeable_state" => String, "head" => Hash, "base" => Hash }.freeze
      IDENTITY = { "id" => "node_id", "number" => "number", "url" => "html_url",
                   "title" => "title", "state" => "state", "draft" => "draft" }.freeze
      MERGE = { "merged" => "merged", "merged_at" => "merged_at",
                "merge_commit_sha" => "merge_commit_sha", "mergeable" => "mergeable",
                "mergeable_state" => "mergeable_state" }.freeze
      HEAD = { "sha" => String, "ref" => String, "label" => String }.freeze

      def initialize(repository, number)
        @repository = repository
        @number = number
      end

      def normalize(payload)
        item = Shape.object!(payload, "pull request metadata")
        Shape.fields!(item, FIELDS, "pull request metadata")
        validate_identity!(item)
        result = Projection.from(item, IDENTITY)
        result["repository"] = @repository.full_name
        result["head"] = normalize_head(item["head"])
        result["merge"] = Projection.from(item, MERGE)
        result
      end

      private

      def normalize_head(head)
        Shape.fields!(head, HEAD, "pull request metadata.head")
        Projection.from(head, { "sha" => "sha", "ref" => "ref", "label" => "label" })
      end

      def validate_identity!(item)
        raise Failure, "pull request number changed" unless item["number"] == @number

        base = Shape.field!(item["base"], "repo", Hash, "pull request metadata.base")
        name = Shape.field!(base, "full_name", String, "pull request metadata.base.repo")
        raise Failure, "pull request repository mismatch" unless name == @repository.full_name
      end
    end
  end
end
