/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Action } from "../actions";
import { type ActionPayload } from "../payloads";

export interface SubmitDynamicRoomPromptPayload extends Pick<ActionPayload, "action"> {
    action: Action.SubmitDynamicRoomPrompt;

    /** The room to send the prompt in */
    roomId: string;

    /** The user's natural-language prompt */
    prompt: string;
}
