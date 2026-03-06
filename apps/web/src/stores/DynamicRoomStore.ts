/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room, RoomStateEvent, type MatrixEvent, type EmptyObject } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { type ActionPayload } from "../dispatcher/payloads";
import { AsyncStoreWithClient } from "./AsyncStoreWithClient";
import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import { type SubmitDynamicRoomPromptPayload } from "../dispatcher/payloads/SubmitDynamicRoomPromptPayload";
import {
    RENDERER_STATE_EVENT,
    RENDERER_PROMPT_EVENT,
    RENDERER_STATUS_EVENT,
} from "../dynamic-rooms/constants";
import {
    type RendererStateEventContent,
    type RendererStatusEventContent,
} from "../dynamic-rooms/schema";

export interface RendererConfig {
    readonly bundleUrl: string;
    readonly schemaVersion: string;
    readonly displayName: string;
    readonly schema: RendererStateEventContent["schema"];
}

export type RendererStatus = RendererStatusEventContent["status"] | "none";

interface DynamicRoomStoreState extends EmptyObject {
    // State is held in instance maps below rather than in the
    // serialisable store state, because Map isn't supported by
    // the Object.assign-based AsyncStore.
}

/**
 * Watches for `io.element.custom_renderer` and `io.element.renderer_status`
 * state events across all joined rooms. Provides per-room renderer configs
 * and generation status to the rest of the application.
 *
 * Also handles the `SubmitDynamicRoomPrompt` action by sending the user's
 * prompt as a timeline event into the room.
 */
export class DynamicRoomStore extends AsyncStoreWithClient<DynamicRoomStoreState> {
    private static readonly internalInstance = ((): DynamicRoomStore => {
        const instance = new DynamicRoomStore();
        instance.start();
        return instance;
    })();

    /** Per-room renderer configuration, keyed by roomId */
    private renderers = new Map<string, RendererConfig>();

    /** Per-room generation status, keyed by roomId */
    private statuses = new Map<string, RendererStatus>();

    private constructor() {
        super(defaultDispatcher, {});
    }

    public static get instance(): DynamicRoomStore {
        return DynamicRoomStore.internalInstance;
    }

    /**
     * Returns the active renderer config for a room, or undefined if none is set.
     */
    public getRenderer(roomId: string): RendererConfig | undefined {
        return this.renderers.get(roomId);
    }

    /**
     * Returns the current generation status for a room.
     */
    public getStatus(roomId: string): RendererStatus {
        return this.statuses.get(roomId) ?? "none";
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────

    protected async onReady(): Promise<void> {
        if (!this.matrixClient) return;
        this.matrixClient.on(RoomStateEvent.Events, this.onRoomStateEvent);

        // Bootstrap from already-known rooms
        for (const room of this.matrixClient.getRooms()) {
            this.loadRendererFromRoom(room);
            this.loadStatusFromRoom(room);
        }
        this.emit("update", null);
    }

    protected async onNotReady(): Promise<void> {
        this.matrixClient?.off(RoomStateEvent.Events, this.onRoomStateEvent);
        this.renderers = new Map();
        this.statuses = new Map();
    }

    protected async onAction(payload: ActionPayload): Promise<void> {
        if (payload.action === Action.SubmitDynamicRoomPrompt) {
            const { roomId, prompt } = payload as SubmitDynamicRoomPromptPayload;
            await this.submitPrompt(roomId, prompt);
        }
    }

    // ─── Event Handlers ─────────────────────────────────────────────────

    private readonly onRoomStateEvent = (event: MatrixEvent): void => {
        const eventType = event.getType();
        const roomId = event.getRoomId();
        if (!roomId) return;

        const room = this.matrixClient?.getRoom(roomId);
        if (!room) return;

        if (eventType === RENDERER_STATE_EVENT) {
            this.loadRendererFromRoom(room);
            this.emit("update", roomId);
        } else if (eventType === RENDERER_STATUS_EVENT) {
            this.loadStatusFromRoom(room);
            this.emit("update", roomId);
        }
    };

    // ─── Loaders ────────────────────────────────────────────────────────

    private loadRendererFromRoom(room: Room): void {
        const event = room.currentState.getStateEvents(RENDERER_STATE_EVENT, "");
        if (!event) return;

        const content = event.getContent<RendererStateEventContent>();
        if (!content.bundleUrl) return;

        this.renderers.set(room.roomId, {
            bundleUrl: content.bundleUrl,
            schemaVersion: content.schemaVersion ?? "1",
            displayName: content.displayName ?? room.name,
            schema: content.schema ?? { events: [] },
        });
    }

    private loadStatusFromRoom(room: Room): void {
        const event = room.currentState.getStateEvents(RENDERER_STATUS_EVENT, "");
        if (!event) return;

        const content = event.getContent<RendererStatusEventContent>();
        if (content.status) {
            this.statuses.set(room.roomId, content.status);
        }
    }

    // ─── Actions ────────────────────────────────────────────────────────

    /**
     * Sends the user's prompt into the room as an `io.element.renderer_prompt`
     * timeline event. The bot picks this up and starts generating.
     */
    private async submitPrompt(roomId: string, prompt: string): Promise<void> {
        if (!this.matrixClient) {
            logger.error("DynamicRoomStore: Cannot submit prompt — no MatrixClient");
            return;
        }

        try {
            await this.matrixClient.sendEvent(roomId, RENDERER_PROMPT_EVENT, {
                body: prompt,
            });
            logger.info(`DynamicRoomStore: Sent renderer prompt to ${roomId}`);
        } catch (err) {
            logger.error("DynamicRoomStore: Failed to send renderer prompt", err);
        }
    }
}
