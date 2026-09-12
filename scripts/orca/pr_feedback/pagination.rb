# frozen_string_literal: true

module Orca
  module PrFeedback
    module Connections
      module_function

      def pull_request(data, field, label)
        repository = Shape.field!(data, "repository", Hash, label)
        pull_request = Shape.field!(repository, "pullRequest", Hash, "#{label}.repository")
        Shape.field!(pull_request, field, Hash, "#{label}.pullRequest")
      end

      def thread(data, thread_id, label)
        node = Shape.field!(data, "node", Hash, label)
        type = Shape.field!(node, "__typename", String, "#{label}.node")
        raise Failure, "#{label} returned #{type}, not a review thread" unless type == "PullRequestReviewThread"

        validate_thread_id!(node, thread_id, label)
        Shape.field!(node, "comments", Hash, "#{label}.node")
      end

      def validate_thread_id!(node, expected, label)
        actual = Shape.field!(node, "id", String, "#{label}.node")
        raise Failure, "#{label} returned the wrong thread" unless actual == expected
      end
    end

    module Connection
      module_function

      def read(value, label)
        object = Shape.object!(value, label)
        nodes = Shape.field!(object, "nodes", Array, label)
        page_info = Shape.field!(object, "pageInfo", Hash, label)
        total = Shape.field!(object, "totalCount", Integer, label)
        raise Failure, "#{label}.totalCount must not be negative" if total.negative?

        [nodes, next_cursor(page_info, label), total]
      end

      def next_cursor(page_info, label)
        more = Shape.field!(page_info, "hasNextPage", Shape::BOOLEAN, "#{label}.pageInfo")
        cursor = Shape.field!(page_info, "endCursor", [String, NilClass], "#{label}.pageInfo")
        return nil unless more

        Shape.nonempty!(cursor || "", "#{label}.pageInfo.endCursor")
      end
    end

    class CursorGuard
      def initialize(label)
        @label = label
        @seen = {}
      end

      def accept(cursor)
        return nil unless cursor
        raise Failure, "#{@label} repeated pagination cursor" if @seen.key?(cursor)

        @seen[cursor] = true
        cursor
      end
    end

    class PageAccumulator
      def initialize(label)
        @label = label
        @items = []
        @ids = {}
        @total = nil
      end

      def add(nodes, total, cursor)
        @total ||= total
        raise Failure, "#{@label}.totalCount changed during capture" unless @total == total

        nodes.each { |node| add_item(node) }
        validate_progress!(cursor)
      end

      def finish
        return @items if @items.length == @total

        raise Failure, "#{@label}.totalCount reported #{@total}, captured #{@items.length}"
      end

      private

      def validate_progress!(cursor)
        raise Failure, count_mismatch if @items.length > @total
        return unless cursor && @items.length == @total

        raise Failure, "#{@label} claims another page after capturing totalCount #{@total}"
      end

      def count_mismatch
        "#{@label}.totalCount reported #{@total}, captured #{@items.length}"
      end

      def add_item(node)
        item = Shape.object!(node, "#{@label} node")
        id = Shape.field!(item, "id", String, "#{@label} node")
        raise Failure, "#{@label} repeated node #{id}" if @ids.key?(id)

        @ids[id] = true
        @items << item
      end
    end

    class PullRequestPager
      def initialize(client, query, variables, field, label)
        @client = client
        @query = query
        @variables = variables
        @field = field
        @label = label
        @guard = CursorGuard.new(label)
      end

      def fetch
        result = PageAccumulator.new(@label)
        cursor = nil
        loop do
          nodes, cursor, total = fetch_page(cursor)
          result.add(nodes, total, cursor)
          break unless cursor
        end
        result.finish
      end

      private

      def fetch_page(cursor)
        data = @client.graphql(@query, @variables.merge("after" => cursor), page_label(cursor))
        connection = Connections.pull_request(data, @field, @label)
        nodes, following, total = Connection.read(connection, @label)
        [nodes, @guard.accept(following), total]
      end

      def page_label(cursor)
        cursor ? "#{@label} after #{cursor}" : "#{@label} first page"
      end
    end

    class ThreadCommentPager
      def initialize(client)
        @client = client
      end

      def fetch(thread_id, initial)
        result = collect_pages(thread_id, initial)
        raise Failure, "review thread #{thread_id} has no comments" if result.empty?
        result
      end

      private

      def collect_pages(thread_id, initial)
        guard = CursorGuard.new("review thread #{thread_id} comments")
        result = PageAccumulator.new("review thread #{thread_id} comments")
        nodes, cursor, total = Connection.read(initial, "review thread #{thread_id} comments")
        result.add(nodes, total, cursor)
        while cursor
          nodes, cursor, total = fetch_page(thread_id, cursor, guard)
          result.add(nodes, total, cursor)
        end
        result.finish
      end

      def fetch_page(thread_id, cursor, guard)
        label = "review thread #{thread_id} comments after #{cursor}"
        variables = { "threadId" => thread_id, "after" => cursor }
        data = @client.graphql(Queries::THREAD_COMMENTS, variables, label)
        connection = Connections.thread(data, thread_id, label)
        nodes, following, total = Connection.read(connection, label)
        [nodes, guard.accept(following), total]
      end
    end
  end
end
