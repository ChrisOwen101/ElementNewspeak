/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Room name prefix that triggers the dynamic room renderer.
 * Any room whose name starts with this prefix will use a custom
 * LLM-generated view instead of the standard chat timeline.
 */
export const DYNAMIC_ROOM_PREFIX = "app-";

/**
 * Custom Matrix state event type that carries the renderer configuration
 * for a dynamic room: bundle URL, schema, and display name.
 * Posted by the bot once Claude Code has generated and bundled the component.
 */
export const RENDERER_STATE_EVENT = "io.element.custom_renderer";

/**
 * Custom Matrix timeline event type sent by the user when they submit
 * a prompt describing what the room should look like.
 */
export const RENDERER_PROMPT_EVENT = "io.element.renderer_prompt";

/**
 * Custom Matrix state event type posted by the bot to signal the
 * current generation status: pending, ready, or error.
 */
export const RENDERER_STATUS_EVENT = "io.element.renderer_status";
