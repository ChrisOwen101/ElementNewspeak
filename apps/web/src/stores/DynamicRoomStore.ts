/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room, RoomStateEvent, type MatrixEvent, type EmptyObject } from "matrix-js-sdk/src/matrix"
import { logger } from "matrix-js-sdk/src/logger"

import { type ActionPayload } from "../dispatcher/payloads"
import { AsyncStoreWithClient } from "./AsyncStoreWithClient"
import defaultDispatcher from "../dispatcher/dispatcher"
import { Action } from "../dispatcher/actions"
import { type SubmitDynamicRoomPromptPayload } from "../dispatcher/payloads/SubmitDynamicRoomPromptPayload"
import { RENDERER_STATE_EVENT, GENERATE_API_URL } from "../dynamic-rooms/constants"
import { type RendererStateEventContent } from "../dynamic-rooms/schema"

export interface RendererConfig {
    readonly bundleUrl: string
    readonly schemaVersion: string
    readonly displayName: string
    readonly schema: RendererStateEventContent["schema"]
}

export type RendererStatus = "none" | "pending" | "ready" | "error"

interface DynamicRoomStoreState extends EmptyObject {
    // State is held in instance maps below rather than in the
    // serialisable store state, because Map isn't supported by
    // the Object.assign-based AsyncStore.
}

/**
 * Watches for `io.element.custom_renderer` state events across all joined
 * rooms. Provides per-room renderer configs and generation status.
 *
 * Handles the `SubmitDynamicRoomPrompt` action by calling the generation
 * server's HTTP API, then posting the resulting renderer state event into
 * the room.
 */
export class DynamicRoomStore extends AsyncStoreWithClient<DynamicRoomStoreState> {
    private static readonly internalInstance = ((): DynamicRoomStore => {
        const instance = new DynamicRoomStore()
        instance.start()
        return instance
    })();

    /** Per-room renderer configuration, keyed by roomId */
    private renderers = new Map<string, RendererConfig>();

    /** Per-room generation status, keyed by roomId */
    private statuses = new Map<string, RendererStatus>();

    /** Incremented each time a generation (new or edit) finishes, so VMs can detect completion */
    private generationCounter = 0;

    private constructor() {
        super(defaultDispatcher, {})
    }

    public static get instance(): DynamicRoomStore {
        return DynamicRoomStore.internalInstance
    }

    /**
     * Returns the active renderer config for a room, or undefined if none is set.
     */
    public getRenderer(roomId: string): RendererConfig | undefined {
        return this.renderers.get(roomId)
    }

    /**
     * Returns the current generation status for a room.
     */
    public getStatus(roomId: string): RendererStatus {
        return this.statuses.get(roomId) ?? "none"
    }

    /**
     * Returns a counter that increments on every generation completion (success or failure).
     */
    public getGenerationCounter(): number {
        return this.generationCounter
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────

    protected async onReady(): Promise<void> {
        if (!this.matrixClient) return
        this.matrixClient.on(RoomStateEvent.Events, this.onRoomStateEvent)

        // Bootstrap from already-known rooms
        for (const room of this.matrixClient.getRooms()) {
            this.loadRendererFromRoom(room)
        }
        this.emit("update", null)
    }

    protected async onNotReady(): Promise<void> {
        this.matrixClient?.off(RoomStateEvent.Events, this.onRoomStateEvent)
        this.renderers = new Map()
        this.statuses = new Map()
    }

    protected async onAction(payload: ActionPayload): Promise<void> {
        if (payload.action === Action.SubmitDynamicRoomPrompt) {
            const { roomId, prompt } = payload as SubmitDynamicRoomPromptPayload
            await this.submitPrompt(roomId, prompt)
        }
    }

    // ─── Event Handlers ─────────────────────────────────────────────────

    private readonly onRoomStateEvent = (event: MatrixEvent): void => {
        const eventType = event.getType()
        const roomId = event.getRoomId()
        if (!roomId) return

        const room = this.matrixClient?.getRoom(roomId)
        if (!room) return

        if (eventType === RENDERER_STATE_EVENT) {
            this.loadRendererFromRoom(room)
            this.emit("update", roomId)
        }
    };

    // ─── Loaders ────────────────────────────────────────────────────────

    /**
     * Rewrites bundle URLs that point at localhost so they use the same
     * host the browser is currently on. This lets other machines on the
     * network load bundles that were generated before BUNDLE_BASE_URL
     * was set to the LAN IP.
     */
    private rewriteBundleUrl(url: string): string {
        try {
            const parsed = new URL(url)
            if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
                parsed.hostname = window.location.hostname
                return parsed.toString()
            }
        } catch {
            // leave malformed URLs unchanged
        }
        return url
    }

    private loadRendererFromRoom(room: Room): void {
        const event = room.currentState.getStateEvents(RENDERER_STATE_EVENT, "")
        if (!event) return

        const content = event.getContent<RendererStateEventContent>()
        if (!content.bundleUrl) return

        this.renderers.set(room.roomId, {
            bundleUrl: this.rewriteBundleUrl(content.bundleUrl),
            schemaVersion: content.schemaVersion ?? "1",
            displayName: content.displayName ?? room.name,
            schema: content.schema ?? { events: [] },
        })

        // If we have a renderer, it's "ready"
        this.statuses.set(room.roomId, "ready")
    }

    // ─── Actions ────────────────────────────────────────────────────────

    /**
     * Calls the generation server HTTP API, then posts the resulting
     * `io.element.custom_renderer` state event into the room.
     */
    private async submitPrompt(roomId: string, prompt: string): Promise<void> {
        if (!this.matrixClient) {
            logger.error("DynamicRoomStore: Cannot submit prompt — no MatrixClient")
            return
        }

        // Set status to pending only if there's no existing renderer (first generation).
        // For edits, keep the current iframe visible while the new version is built.
        const isEdit = this.statuses.get(roomId) === "ready"
        if (!isEdit) {
            this.statuses.set(roomId, "pending")
            this.emit("update", roomId)
        }

        try {
            logger.info(`DynamicRoomStore: Sending prompt to ${GENERATE_API_URL} for room ${roomId}`)
            const response = await fetch(GENERATE_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomId, prompt }),
            })

            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({ error: response.statusText }))
                throw new Error(errorBody.error || `HTTP ${response.status}`)
            }

            const { bundleUrl: rawBundleUrl } = (await response.json()) as { bundleUrl: string }
            const bundleUrl = this.rewriteBundleUrl(rawBundleUrl)
            logger.info(`DynamicRoomStore: Generation complete, bundleUrl=${bundleUrl}`)

            // Preserve the existing displayName for edits
            const existingRenderer = this.renderers.get(roomId)
            const displayName = isEdit && existingRenderer
                ? existingRenderer.displayName
                : prompt.slice(0, 80)

            // Post the renderer state event into the room so other clients see it
            logger.info(`DynamicRoomStore: Sending state event to room ${roomId}`)
            await this.matrixClient.sendStateEvent(
                roomId,
                RENDERER_STATE_EVENT as any,
                {
                    bundleUrl,
                    displayName,
                    schemaVersion: "1",
                    schema: { events: [] },
                },
                "",
            )
            logger.info(`DynamicRoomStore: State event sent successfully for room ${roomId}`)

            // Update local state immediately (onRoomStateEvent will also fire)
            this.renderers.set(roomId, {
                bundleUrl,
                displayName,
                schemaVersion: "1",
                schema: { events: [] },
            })
            this.statuses.set(roomId, "ready")
            this.generationCounter++
            this.emit("update", roomId)
        } catch (err) {
            logger.error(`DynamicRoomStore: Generation/update failed for room ${roomId}:`, err)
            if (isEdit) {
                // For edits, keep the current tool visible — just clear the pending state
                this.statuses.set(roomId, "ready")
            } else {
                this.statuses.set(roomId, "error")
            }
            this.generationCounter++
            this.emit("update", roomId)
        }
    }
}
