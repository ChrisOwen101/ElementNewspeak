/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// ─── Matrix Event Content Shapes ────────────────────────────────────────────

/**
 * Describes a single custom event type that the renderer understands.
 * These are stored inside the renderer state event's `schema` field so
 * both the bundle and Element know what to expect.
 */
export interface EventTypeSchema {
    /** Fully namespaced Matrix event type, e.g. "io.element.kanban.card" */
    readonly type: string
    /** Human-readable description of the event */
    readonly description?: string
    /** Maps field name → type descriptor string, e.g. { title: "string", status: "todo|in_progress|done" } */
    readonly contentFields: Record<string, string>
}

/**
 * The schema section inside a `io.element.custom_renderer` state event.
 * Declares which custom event types the room's renderer can handle.
 */
export interface RendererSchema {
    readonly events: ReadonlyArray<EventTypeSchema>
}

/**
 * Content of the `io.element.custom_renderer` **state** event.
 * Posted by the client once the generation server returns a bundleUrl.
 */
export interface RendererStateEventContent {
    /** URL of the self-contained HTML bundle to load in the iframe */
    readonly bundleUrl: string
    /** Semver string for the schema contract */
    readonly schemaVersion: string
    /** Human-readable label for the renderer, shown in the room header */
    readonly displayName: string
    /** Describes the custom event types this renderer handles */
    readonly schema: RendererSchema
}

// ─── postMessage Bridge Types ───────────────────────────────────────────────

/**
 * A Matrix event serialised for safe passage across the postMessage boundary.
 * No live MatrixClient references — just plain data.
 */
export interface SerializedEvent {
    readonly eventId: string
    readonly type: string
    readonly sender: string
    readonly senderDisplayName: string
    readonly content: Record<string, unknown>
    readonly timestamp: number
}

/**
 * Snapshot of room state passed to the iframe component.
 */
export interface SerializedRoomState {
    readonly roomName: string
    readonly members: ReadonlyArray<{ userId: string; displayName: string }>
}

/**
 * Parent → iframe: delivers room data whenever the timeline updates.
 */
export interface RoomDataMessage {
    readonly type: "ROOM_DATA"
    readonly messages: ReadonlyArray<SerializedEvent>
    readonly roomState: SerializedRoomState
}

/**
 * iframe → parent: the component wants to send a Matrix event.
 */
export interface ActionSendEventMessage {
    readonly type: "ACTION_SEND_EVENT"
    readonly eventType: string
    readonly content: Record<string, unknown>
}

/**
 * Parent → iframe: result of a send-event action.
 */
export interface ActionSendEventResultMessage {
    readonly type: "ACTION_SEND_EVENT_RESULT"
    readonly success: boolean
    readonly eventId?: string
    readonly error?: string
}

/**
 * Discriminated union of every message type that crosses the postMessage bridge.
 */
export type BridgeMessage = RoomDataMessage | ActionSendEventMessage | ActionSendEventResultMessage
