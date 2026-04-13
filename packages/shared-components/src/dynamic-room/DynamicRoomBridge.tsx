/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useRef } from "react"

import styles from "./DynamicRoomView.module.css"

// Re-use the serialised types from the view snapshot (avoids circular dependency on schema.ts)
interface SerializedEvent {
    readonly eventId: string
    readonly type: string
    readonly sender: string
    readonly senderDisplayName: string
    readonly content: Record<string, unknown>
    readonly timestamp: number
}

interface SerializedRoomState {
    readonly roomName: string
    readonly members: ReadonlyArray<{ userId: string; displayName: string }>
}

interface DynamicRoomBridgeProps {
    /** URL of the self-contained HTML bundle to load */
    readonly bundleUrl: string
    /** Serialised timeline events to pass to the iframe */
    readonly messages: ReadonlyArray<SerializedEvent>
    /** Serialised room state to pass to the iframe */
    readonly roomState: SerializedRoomState
    /** Callback when the iframe wants to send a Matrix event */
    readonly onSendEvent: (eventType: string, content: Record<string, unknown>) => void
}

/**
 * Manages the sandboxed iframe and the postMessage bridge
 * between Element and the LLM-generated room component.
 *
 * - On mount & data change: posts `ROOM_DATA` to the iframe
 * - Listens for `ACTION_SEND_EVENT` messages back from the iframe
 */
export function DynamicRoomBridge({ bundleUrl, messages, roomState, onSendEvent }: Readonly<DynamicRoomBridgeProps>): JSX.Element {
    const iframeRef = useRef<HTMLIFrameElement>(null)

    // Post ROOM_DATA to the sandboxed iframe.
    // The iframe has sandbox="allow-scripts" so its origin is "null".
    // We must use "*" as the target origin for postMessage to reach it.
    const postRoomData = (): void => {
        const iframe = iframeRef.current
        if (!iframe?.contentWindow) return

        iframe.contentWindow.postMessage(
            {
                type: "ROOM_DATA",
                messages,
                roomState,
            },
            "*",
        )
    }

    // Post ROOM_DATA whenever messages or roomState change
    useEffect(() => {
        postRoomData()
    }, [messages, roomState])

    // Also post ROOM_DATA once the iframe loads
    const handleLoad = (): void => {
        postRoomData()
    }

    // Listen for messages back from the iframe.
    // Validate by checking event.source matches our iframe's contentWindow
    // (origin-based checks don't work for sandboxed iframes whose origin is "null").
    useEffect(() => {
        const handler = (event: MessageEvent): void => {
            // Validate the message came from our iframe
            if (event.source !== iframeRef.current?.contentWindow) return

            const data = event.data
            if (data?.type === "ACTION_SEND_EVENT") {
                const eventType = data.eventType
                const content = data.content
                if (typeof eventType === "string" && content && typeof content === "object") {
                    console.log("[DynamicRoomBridge] Sending event:", eventType, content)
                    onSendEvent(eventType, content as Record<string, unknown>)
                }
            }
        }

        window.addEventListener("message", handler)
        return () => window.removeEventListener("message", handler)
    }, [])

    return (
        <iframe
            ref={iframeRef}
            src={bundleUrl}
            className={styles.iframe}
            sandbox="allow-scripts"
            onLoad={handleLoad}
            title="Dynamic room renderer"
        />
    )
}
