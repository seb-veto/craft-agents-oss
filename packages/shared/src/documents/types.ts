/** Native, workspace-local documents. No external publication or ACL is implied. */
export interface WorkspaceDocument {
  id: string
  title: string
  content: string
  projectId: string | null
  favorite: boolean
  createdAt: string
  updatedAt: string
  revision: number
}

export interface DocumentCreateInput {
  title?: string
  content?: string
  projectId?: string | null
}

export interface DocumentUpdateInput {
  /** Required optimistic concurrency token. A conflict must never overwrite text. */
  expectedRevision: number
  title?: string
  content?: string
  projectId?: string | null
  favorite?: boolean
}
