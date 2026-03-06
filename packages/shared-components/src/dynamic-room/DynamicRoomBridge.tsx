/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useRef } from "react";

import styles from "./DynamicRoomView.module.css";

// Re-use the serialised types from the view snapshot (avoids circular dependency on schema.ts)
interface SerializedEvent {
    readonly eventId: string;
    readonly type: string;
    readonly sender: string;
    readonly senderDisplayName: string;
    readonly content: Record<string, unknown>;
    readonly timestamp: number;
}

interface SerializedRoomState {
    readonly roomName: string;
    readonly members: ReadonlyArray<{ userId: string; displayName: string }>;
}

interface DynamicRoomBridgeProps {
    /** URL of the self-contained HTML bundle to load */
    readonly bundleUrl: string;
    /** Serialised timeline events to pass to the iframe */
    readonly messages: ReadonlyArray<SerializedEvent>;
    /** Serialised room state to pass to the iframe */
    readonly roomState: SerializedRoomState;
}

/**
 * Manages the sandboxed iframe and the postMessage bridge
 * between Element and the LLM-generated room component.
 *
 * - On mount & data change: posts `ROOM_DATA` to the iframe
 * - Listens for `ACTION_SEND_EVENT` messages back from the iframe
 */
export function DynamicRoomBridge({ bundleUrl, messages, roomState }: Readonly<DynamicRoomBridgeProps>): JSX.Element {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const originRef = useRef<string>("");

    // Derive the allowed origin from the bundle URL
    useEffect(() => {
        try {
            originRef.current = new URL(bundleUrl).origin;
        } catch {
            originRef.current = "";
        }
    }, [bundleUrl]);

    // Post ROOM_DATA whenever messages or roomState change
    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow || !originRef.current) return;

        iframe.contentWindow.postMessage(
            {
                type: "ROOM_DATA",
                messages,
                roomState,
            },
            originRef.current,
        );
    }, [messages, roomState]);

    // Also post ROOM_DATA once the iframe loads
    const handleLoad = (): void => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow || !originRef.current) return;

        iframe.contentWindow.postMessage(
            {
                type: "ROOM_DATA",
                messages,
                roomState,
            },
            originRef.current,
        );
    };

    // Listen for messages back from the iframe
    useEffect(() => {
        const handler = (event: MessageEvent): void => {
            // Validate origin
            if (!originRef.current || event.origin !== originRef.current) return;

            const data = event.data;
            if (data?.type === "ACTION_SEND_EVENT") {
                // TODO: dispatch send-event action through the store
                // For now, log it so we can verify the bridge works
                console.log("[DynamicRoomBridge] iframe wants to send event:", data.eventType, data.content);
            }
        };

        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    return (
        <iframe
            ref={iframeRef}
            src={bundleUrl}
            className={styles.iframe}
            sandbox="allow-scripts"
            onLoad={handleLoad}
            title="Dynamic room renderer"
        />
    );
}
