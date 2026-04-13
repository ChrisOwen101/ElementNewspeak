/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room, type MatrixClient, RoomEvent, type MatrixEvent } from "matrix-js-sdk/src/matrix"
import { BaseViewModel } from "@element-hq/web-shared-components"

import { DynamicRoomStore, type RendererStatus } from "../../stores/DynamicRoomStore"
import { UPDATE_EVENT } from "../../stores/AsyncStore"
import defaultDispatcher from "../../dispatcher/dispatcher"
import { Action } from "../../dispatcher/actions"
import { type SubmitDynamicRoomPromptPayload } from "../../dispatcher/payloads/SubmitDynamicRoomPromptPayload"
import { type SerializedEvent } from "../../dynamic-rooms/schema"

// ─── Snapshot (what the View reads) ─────────────────────────────────────────

export interface DynamicRoomSnapshot {
    /** Current generation status: none → show prompt; pending → loading; ready → iframe; error → error */
    readonly rendererStatus: RendererStatus
    /** Bundle URL to load in the iframe once ready */
    readonly bundleUrl: string | undefined
    /** Current value of the prompt input (controlled) */
    readonly promptValue: string
    /** Room display name */
    readonly roomName: string
    /** Serialised timeline events for the postMessage bridge */
    readonly messages: ReadonlyArray<SerializedEvent>
    /** Error message when status is "error" */
    readonly errorMessage: string | undefined
    /** True when an edit is being generated in the background */
    readonly isEditPending: boolean
}

// ─── Actions (what the View can trigger) ────────────────────────────────────

export interface DynamicRoomActions {
    /** Called when the prompt input value changes */
    onPromptChange(value: string): void
    /** Called when the user submits the prompt */
    onSubmit(): void
    /** Called when the iframe wants to send a Matrix event into the room */
    onSendEvent(eventType: string, content: Record<string, unknown>): void
    /** Called when the user submits an edit prompt to modify the existing tool */
    onEditSubmit(editPrompt: string): void
}

// ─── Props (injected at construction) ───────────────────────────────────────

interface DynamicRoomProps {
    room: Room
    client: MatrixClient
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class DynamicRoomViewModel
    extends BaseViewModel<DynamicRoomSnapshot, DynamicRoomProps>
    implements DynamicRoomActions {
    private lastGenerationCounter: number

    public constructor(props: DynamicRoomProps) {
        const store = DynamicRoomStore.instance
        const renderer = store.getRenderer(props.room.roomId)
        const status = store.getStatus(props.room.roomId)

        super(props, {
            rendererStatus: status,
            bundleUrl: renderer?.bundleUrl,
            promptValue: "",
            roomName: props.room.name,
            messages: DynamicRoomViewModel.serializeTimeline(props.room),
            errorMessage: undefined,
            isEditPending: false,
        })

        this.lastGenerationCounter = store.getGenerationCounter()

        // Listen for store updates (renderer state / status changes)
        this.disposables.trackListener(DynamicRoomStore.instance, UPDATE_EVENT, this.onStoreUpdate)

        // Listen for new timeline events to keep messages up to date
        this.disposables.trackListener(props.room, RoomEvent.Timeline, this.onTimelineEvent)

        // Listen for room name changes
        this.disposables.trackListener(props.room, RoomEvent.Name, this.onRoomNameChanged)
    }

    // ─── Actions ────────────────────────────────────────────────────────

    public onPromptChange = (value: string): void => {
        this.snapshot.merge({ promptValue: value })
    };

    public onSubmit = (): void => {
        const prompt = this.snapshot.current.promptValue.trim()
        if (!prompt) return

        defaultDispatcher.dispatch<SubmitDynamicRoomPromptPayload>({
            action: Action.SubmitDynamicRoomPrompt,
            roomId: this.props.room.roomId,
            prompt,
        })

        // Clear the input
        this.snapshot.merge({ promptValue: "" })
    };

    public onSendEvent = (eventType: string, content: Record<string, unknown>): void => {
        // Cast eventType to satisfy matrix-js-sdk's strict typing for custom event types
        this.props.client.sendEvent(this.props.room.roomId, eventType as any, content).catch((err) => {
            console.error("[DynamicRoomViewModel] Failed to send event:", err)
        })
    };

    public onEditSubmit = (editPrompt: string): void => {
        if (!editPrompt) return

        this.snapshot.merge({ isEditPending: true })

        defaultDispatcher.dispatch<SubmitDynamicRoomPromptPayload>({
            action: Action.SubmitDynamicRoomPrompt,
            roomId: this.props.room.roomId,
            prompt: editPrompt,
        })
    };

    // ─── Event handlers ─────────────────────────────────────────────────

    private readonly onStoreUpdate = (): void => {
        if (this.isDisposed) return

        const store = DynamicRoomStore.instance
        const roomId = this.props.room.roomId
        const renderer = store.getRenderer(roomId)
        const status = store.getStatus(roomId)

        // Clear isEditPending when the generation counter changes
        // (meaning a generation completed, whether success or failure)
        const counterChanged = store.getGenerationCounter() !== this.lastGenerationCounter
        if (counterChanged) {
            this.lastGenerationCounter = store.getGenerationCounter()
        }

        this.snapshot.merge({
            rendererStatus: status,
            bundleUrl: renderer?.bundleUrl,
            isEditPending: counterChanged ? false : this.snapshot.current.isEditPending,
        })
    };

    private readonly onTimelineEvent = (_event: MatrixEvent): void => {
        if (this.isDisposed) return
        this.snapshot.merge({
            messages: DynamicRoomViewModel.serializeTimeline(this.props.room),
        })
    };

    private readonly onRoomNameChanged = (): void => {
        if (this.isDisposed) return
        this.snapshot.merge({ roomName: this.props.room.name })
    };

    // ─── Helpers ────────────────────────────────────────────────────────

    private static serializeTimeline(room: Room): ReadonlyArray<SerializedEvent> {
        return room
            .getLiveTimeline()
            .getEvents()
            .map((e) => ({
                eventId: e.getId() ?? "",
                type: e.getType(),
                sender: e.getSender() ?? "",
                senderDisplayName: room.getMember(e.getSender() ?? "")?.name ?? e.getSender() ?? "",
                content: e.getContent<Record<string, unknown>>(),
                timestamp: e.getTs(),
            }))
    }
}
