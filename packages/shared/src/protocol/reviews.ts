/** Read-only GitHub.com Reviews types shared by the workspace server and renderer. */
export interface ReviewRef {
  owner: string
  repo: string
  number: number
}

export interface ReviewItem extends ReviewRef {
  title: string
  url: string
  author: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  updatedAt: string
  createdAt: string
  additions: number
  deletions: number
  changedFiles: number
  checks: 'pending' | 'success' | 'failure' | 'none'
  reviewDecision: 'approved' | 'changes_requested' | 'review_required' | 'none'
  labels: string[]
  headRef: string
  baseRef: string
}

export interface ReviewsQueue {
  viewer: string
  toReview: ReviewItem[]
  created: ReviewItem[]
  truncated: boolean
}

export interface ReviewFile {
  path: string
  status: string
  additions: number
  deletions: number
  /** Null for binary files or when a patch cannot be returned within the byte budget. */
  patch: string | null
}

export interface ReviewDetail {
  item: ReviewItem
  body: string
  files: ReviewFile[]
  /** True when the files list or any available patch was cut to fit the response limits. */
  filesTruncated: boolean
  checks: { name: string; status: string; url?: string }[]
  checksTruncated?: boolean
  activityTruncated?: boolean
  activity: { id: string; author: string; body: string; createdAt: string; kind: 'comment' | 'review'; state?: string }[]
}
