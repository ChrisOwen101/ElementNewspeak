/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type KeyboardEvent } from "react";
import { Button, InlineSpinner, Text } from "@vector-im/compound-web";

import styles from "./DynamicRoomView.module.css";
import { type ViewModel, useViewModel } from "../viewmodel";
import { DynamicRoomBridge } from "./DynamicRoomBridge";

// ─── Snapshot ───────────────────────────────────────────────────────────────

export interface DynamicRoomViewSnapshot {
    /** Current generation status */
    readonly rendererStatus: "none" | "pending" | "ready" | "error";
    /** Bundle URL to load in the iframe */
    readonly bundleUrl: string | undefined;
    /** Current prompt input value */
    readonly promptValue: string;
    /** Room display name */
    readonly roomName: string;
    /** Serialised timeline events for the bridge */
    readonly messages: ReadonlyArray<{
        readonly eventId: string;
        readonly type: string;
        readonly sender: string;
        readonly senderDisplayName: string;
        readonly content: Record<string, unknown>;
        readonly timestamp: number;
    }>;
    /** Error message when status is "error" */
    readonly errorMessage: string | undefined;
}

// ─── Actions ────────────────────────────────────────────────────────────────

export interface DynamicRoomViewActions {
    /** Called when the prompt input value changes */
    onPromptChange(value: string): void;
    /** Called when the user submits the prompt */
    onSubmit(): void;
    /** Called when the iframe wants to send a Matrix event */
    onSendEvent(eventType: string, content: Record<string, unknown>): void;
}

/** The view model type for DynamicRoomView */
export type DynamicRoomViewViewModel = ViewModel<DynamicRoomViewSnapshot, DynamicRoomViewActions>;

// ─── Props ──────────────────────────────────────────────────────────────────

interface DynamicRoomViewProps {
    /** The view model driving this view */
    vm: DynamicRoomViewViewModel;
}

// ─── View ───────────────────────────────────────────────────────────────────

/**
 * Renders the custom UI for dynamic `app-` rooms.
 *
 * - When no renderer is configured: shows a prompt input + submit button.
 * - While generating: shows a loading spinner.
 * - Once ready: shows the LLM-generated bundle in a sandboxed iframe.
 * - On error: shows the error message with a retry prompt.
 */
export function DynamicRoomView({ vm }: Readonly<DynamicRoomViewProps>): JSX.Element {
    const state = useViewModel(vm);

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === "Enter") {
            vm.onSubmit();
        }
    };

    switch (state.rendererStatus) {
        case "none":
            return (
                <div className={styles.container}>
                    <Text size="lg" weight="semibold">
                        {state.roomName}
                    </Text>
                    <Text size="md">Describe what this room should look like</Text>
                    <div className={styles.promptForm}>
                        <input
                            className={styles.promptInput}
                            type="text"
                            value={state.promptValue}
                            onChange={(e) => vm.onPromptChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="e.g. A kanban board where messages are cards..."
                        />
                        <Button size="sm" onClick={vm.onSubmit} disabled={!state.promptValue.trim()}>
                            Submit
                        </Button>
                    </div>
                </div>
            );

        case "pending":
            return (
                <div className={styles.container}>
                    <div className={styles.spinner}>
                        <InlineSpinner />
                        <Text size="md">Generating your room view…</Text>
                    </div>
                </div>
            );

        case "ready":
            return (
                <div className={styles.iframeContainer}>
                    {state.bundleUrl && (
                        <DynamicRoomBridge
                            bundleUrl={state.bundleUrl}
                            messages={state.messages}
                            roomState={{ roomName: state.roomName, members: [] }}
                            onSendEvent={vm.onSendEvent}
                        />
                    )}
                </div>
            );

        case "error":
            return (
                <div className={styles.container}>
                    <div className={styles.error}>
                        <Text size="lg" weight="semibold">
                            Something went wrong
                        </Text>
                        <Text size="md">{state.errorMessage ?? "Failed to generate the room view."}</Text>
                    </div>
                    <div className={styles.promptForm}>
                        <input
                            className={styles.promptInput}
                            type="text"
                            value={state.promptValue}
                            onChange={(e) => vm.onPromptChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Try a different prompt..."
                        />
                        <Button size="sm" onClick={vm.onSubmit} disabled={!state.promptValue.trim()}>
                            Retry
                        </Button>
                    </div>
                </div>
            );
    }
}
