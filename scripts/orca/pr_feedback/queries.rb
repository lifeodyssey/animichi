# frozen_string_literal: true

module Orca
  module PrFeedback
    module Queries
      INLINE_COMMENT_SELECTION = <<~GRAPHQL.freeze
        id fullDatabaseId author { login } authorAssociation body url createdAt updatedAt
        path line originalLine outdated replyTo { id }
      GRAPHQL

      COMMENTS = <<~GRAPHQL.freeze
        query PullRequestComments($owner: String!, $name: String!, $number: Int!, $after: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              comments(first: 100, after: $after) {
                nodes {
                  id fullDatabaseId author { login } authorAssociation body url createdAt updatedAt
                }
                pageInfo { hasNextPage endCursor }
                totalCount
              }
            }
          }
        }
      GRAPHQL

      REVIEWS = <<~GRAPHQL.freeze
        query PullRequestReviews($owner: String!, $name: String!, $number: Int!, $after: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviews(first: 100, after: $after,
                      states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
                nodes {
                  id fullDatabaseId author { login } authorAssociation body url createdAt updatedAt
                  state submittedAt commit { oid }
                }
                pageInfo { hasNextPage endCursor }
                totalCount
              }
            }
          }
        }
      GRAPHQL

      THREADS = <<~GRAPHQL.freeze
        query PullRequestThreads($owner: String!, $name: String!, $number: Int!, $after: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $after) {
                nodes {
                  id isResolved isOutdated
                  comments(first: 100) {
                    nodes {
                      #{INLINE_COMMENT_SELECTION}
                    }
                    pageInfo { hasNextPage endCursor }
                    totalCount
                  }
                }
                pageInfo { hasNextPage endCursor }
                totalCount
              }
            }
          }
        }
      GRAPHQL

      THREAD_COMMENTS = <<~GRAPHQL.freeze
        query PullRequestThreadComments($threadId: ID!, $after: String) {
          node(id: $threadId) {
            __typename
            ... on PullRequestReviewThread {
              id
              comments(first: 100, after: $after) {
                nodes {
                  #{INLINE_COMMENT_SELECTION}
                }
                pageInfo { hasNextPage endCursor }
                totalCount
              }
            }
          }
        }
      GRAPHQL
    end
  end
end
