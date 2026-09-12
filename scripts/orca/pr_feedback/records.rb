# frozen_string_literal: true

module Orca
  module PrFeedback
    module Author
      module_function

      def from(value, label)
        return nil if value.nil?

        object = Shape.object!(value, "#{label}.author")
        login = Shape.field!(object, "login", String, "#{label}.author")
        Shape.nonempty!(login, "#{label}.author.login")
      end
    end

    module Records
      COMMON = { "id" => String, "fullDatabaseId" => [String, Integer, NilClass],
                 "author" => [Hash, NilClass], "authorAssociation" => String,
                 "body" => String, "url" => String, "createdAt" => String,
                 "updatedAt" => String }.freeze
      COMMON_MAP = { "id" => "id", "database_id" => "fullDatabaseId",
                     "author_association" => "authorAssociation", "body" => "body",
                     "url" => "url", "created_at" => "createdAt",
                     "updated_at" => "updatedAt" }.freeze
      INLINE = { "path" => String, "line" => [Integer, NilClass],
                 "originalLine" => [Integer, NilClass], "outdated" => Shape::BOOLEAN,
                 "replyTo" => [Hash, NilClass] }.freeze

      module_function

      def comment(node, label)
        normalize_feedback_record(node, label)
      end

      def review(node, label)
        item = normalize_feedback_record(node, label)
        Shape.fields!(node, { "state" => String, "submittedAt" => String,
                              "commit" => [Hash, NilClass] }, label)
        item.merge("state" => node["state"], "submitted_at" => node["submittedAt"],
                   "commit_sha" => commit_sha(node["commit"], label))
      end

      def inline_comment(node, label)
        item = normalize_feedback_record(node, label)
        Shape.fields!(node, INLINE, label)
        item.merge("path" => node["path"], "line" => node["line"],
                   "original_line" => node["originalLine"], "outdated" => node["outdated"],
                   "reply_to_id" => reply_id(node["replyTo"], label))
      end

      def normalize_feedback_record(node, label)
        item = Shape.object!(node, label)
        Shape.fields!(item, COMMON, label)
        validate_common_strings!(item, label)
        Projection.from(item, COMMON_MAP).merge("author" => Author.from(item["author"], label))
      end

      def validate_common_strings!(item, label)
        %w[id url createdAt updatedAt].each do |key|
          Shape.nonempty!(item[key], "#{label}.#{key}")
        end
      end

      def commit_sha(commit, label)
        return nil unless commit

        Shape.field!(commit, "oid", String, "#{label}.commit")
      end

      def reply_id(reply, label)
        return nil unless reply

        Shape.field!(reply, "id", String, "#{label}.replyTo")
      end
    end

    class ThreadCollector
      THREAD = { "id" => String, "isResolved" => Shape::BOOLEAN,
                 "isOutdated" => Shape::BOOLEAN, "comments" => Hash }.freeze

      def initialize(client)
        @comments = ThreadCommentPager.new(client)
      end

      def collect(threads)
        threads.each_with_index.map { |thread, index| normalize(thread, index) }
      end

      private

      def normalize(thread, index)
        label = "review thread #{index + 1}"
        item = Shape.object!(thread, label)
        Shape.fields!(item, THREAD, label)
        Shape.nonempty!(item["id"], "#{label}.id")
        comments = @comments.fetch(item["id"], item["comments"])
        thread_result(item, normalize_comments(comments, item["id"]))
      end

      def normalize_comments(comments, thread_id)
        comments.each_with_index.map do |comment, index|
          Records.inline_comment(comment, "review thread #{thread_id} comment #{index + 1}")
        end
      end

      def thread_result(thread, comments)
        { "id" => thread["id"], "resolved" => thread["isResolved"],
          "outdated" => thread["isOutdated"], "comments" => comments }
      end
    end
  end
end
