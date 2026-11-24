import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { createDocument, deleteDocument, getDocument, listDocuments, updateDocument } from '@craft-agent/shared/documents'
import type { DocumentCreateInput, DocumentUpdateInput } from '@craft-agent/shared/documents/types'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.documents.GET, RPC_CHANNELS.documents.GET_ONE, RPC_CHANNELS.documents.CREATE,
  RPC_CHANNELS.documents.UPDATE, RPC_CHANNELS.documents.DELETE,
] as const

export function registerDocumentsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  function workspaceRoot(workspaceId: string): string {
    const ws = getWorkspaceByNameOrId(workspaceId)
    if (!ws) throw new Error(`Workspace not found: ${workspaceId}`)
    return ws.rootPath
  }
  function changed(workspaceId: string): void {
    pushTyped(server, RPC_CHANNELS.documents.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }
  server.handle(RPC_CHANNELS.documents.GET, (_ctx, workspaceId: string) => listDocuments(workspaceRoot(workspaceId)))
  server.handle(RPC_CHANNELS.documents.GET_ONE, (_ctx, workspaceId: string, id: string) => getDocument(workspaceRoot(workspaceId), id))
  server.handle(RPC_CHANNELS.documents.CREATE, (_ctx, workspaceId: string, input?: DocumentCreateInput) => {
    const result = createDocument(workspaceRoot(workspaceId), input)
    changed(workspaceId)
    return result
  })
  server.handle(RPC_CHANNELS.documents.UPDATE, (_ctx, workspaceId: string, id: string, input: DocumentUpdateInput) => {
    const result = updateDocument(workspaceRoot(workspaceId), id, input)
    changed(workspaceId)
    return result
  })
  server.handle(RPC_CHANNELS.documents.DELETE, (_ctx, workspaceId: string, id: string) => {
    deleteDocument(workspaceRoot(workspaceId), id)
    changed(workspaceId)
  })
}
