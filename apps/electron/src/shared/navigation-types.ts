/** Renderer navigation extensions, kept separate from the Electron API contract. */
import type { NavigationState as BaseNavigationState, RightSidebarPanel } from './types'
export * from './types'

export interface GoalsNavigationState {
  navigator: 'goals'
  details: { type: 'goal'; goalId: string } | null
  rightSidebar?: RightSidebarPanel
}

export interface DocumentsNavigationState {
  navigator: 'documents'
  details: { type: 'document'; documentId: string } | null
  rightSidebar?: RightSidebarPanel
}

export interface InboxNavigationState {
  navigator: 'inbox'
  details: { type: 'inbox-session'; sessionId: string } | null
  rightSidebar?: RightSidebarPanel
}

export interface ReviewsNavigationState {
  navigator: 'reviews'
  details: { type: 'review'; reviewId: string } | null
  rightSidebar?: RightSidebarPanel
}

export type NavigationState = BaseNavigationState | GoalsNavigationState | DocumentsNavigationState | InboxNavigationState | ReviewsNavigationState
export const isSessionsNavigation = (state: NavigationState): state is Extract<NavigationState, { navigator: 'sessions' }> => state.navigator === 'sessions'
export const isSourcesNavigation = (state: NavigationState): state is Extract<NavigationState, { navigator: 'sources' }> => state.navigator === 'sources'
export const isSettingsNavigation = (state: NavigationState): state is Extract<NavigationState, { navigator: 'settings' }> => state.navigator === 'settings'
export const isSkillsNavigation = (state: NavigationState): state is Extract<NavigationState, { navigator: 'skills' }> => state.navigator === 'skills'
export const isAutomationsNavigation = (state: NavigationState): state is Extract<NavigationState, { navigator: 'automations' }> => state.navigator === 'automations'
export const isProjectsNavigation = (state: NavigationState): state is Extract<NavigationState, { navigator: 'projects' }> => state.navigator === 'projects'
export const isPagesNavigation = (state: NavigationState): state is Extract<NavigationState, { navigator: 'pages' }> => state.navigator === 'pages'
export const isGoalsNavigation = (state: NavigationState): state is Extract<NavigationState, { navigator: 'goals' }> => state.navigator === 'goals'
export const isDocumentsNavigation = (state: NavigationState): state is DocumentsNavigationState => state.navigator === 'documents'
