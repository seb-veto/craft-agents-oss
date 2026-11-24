export const MAX_QUEUE_ITEMS = 50
const MAX_CHECKS = 50
const MAX_ACTIVITY = 50

export const VIEWER_QUERY = `query ReviewsViewer { viewer { login } }`

const PR_FIELDS = `
  number title state isDraft createdAt updatedAt additions deletions changedFiles
  reviewDecision headRefName baseRefName
  author { login }
  repository { owner { login } name }
  labels(first: 30) { nodes { name } }
`

export const QUEUES_QUERY = `query ReviewsQueues($review: String!, $created: String!) {
  toReview: search(query: $review, type: ISSUE, first: ${MAX_QUEUE_ITEMS}) {
    pageInfo { hasNextPage }
    nodes { ... on PullRequest { ${PR_FIELDS} commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }
  }
  created: search(query: $created, type: ISSUE, first: ${MAX_QUEUE_ITEMS}) {
    pageInfo { hasNextPage }
    nodes { ... on PullRequest { ${PR_FIELDS} commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }
  }
}`

export const DETAIL_QUERY = `query ReviewsDetail($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${PR_FIELDS}
      body
      commits(last: 1) { nodes { commit { statusCheckRollup {
        state
        contexts(first: ${MAX_CHECKS}) {
          pageInfo { hasNextPage }
          nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl }
            ... on StatusContext { context state targetUrl }
          }
        }
      } } } }
      timelineItems(last: ${MAX_ACTIVITY}, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW]) {
        pageInfo { hasPreviousPage }
        nodes {
          __typename
          ... on IssueComment { id author { login } body createdAt }
          ... on PullRequestReview { id author { login } body createdAt submittedAt state }
        }
      }
    }
  }
}`
