/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type Room, KnownMembership, EventTimeline, EventType, type MatrixClient } from "matrix-js-sdk/src/matrix"

import { isKnockDenied } from "../../utils/membership"
import { shouldShowComponent } from "../../customisations/helpers/UIComponents"
import { UIComponent } from "../../settings/UIFeature"
import { showCreateNewRoom } from "../../utils/space"
import dispatcher from "../../dispatcher/dispatcher"
import { Action } from "../../dispatcher/actions"
import { DYNAMIC_ROOM_PREFIX } from "../../dynamic-rooms/constants"
import createRoomFn from "../../createRoom"
import Modal from "../../Modal"
import TextInputDialog from "../../components/views/dialogs/TextInputDialog"
import { _t } from "../../languageHandler"

/**
 * Check if the user has access to the options menu.
 * @param room
 */
export function hasAccessToOptionsMenu(room: Room): boolean {
    return (
        room.getMyMembership() === KnownMembership.Invite ||
        (room.getMyMembership() !== KnownMembership.Knock &&
            !isKnockDenied(room) &&
            shouldShowComponent(UIComponent.RoomOptionsMenu))
    )
}

/**
 * Check if the user has access to the notification menu.
 * @param room
 * @param isGuest
 * @param isArchived
 */
export function hasAccessToNotificationMenu(room: Room, isGuest: boolean, isArchived: boolean): boolean {
    return !isGuest && !isArchived && hasAccessToOptionsMenu(room)
}

/**
 * Create a room
 * @param space - The space to create the room in
 */
export async function createRoom(space?: Room | null): Promise<void> {
    if (space) {
        await showCreateNewRoom(space)
    } else {
        dispatcher.fire(Action.CreateRoom)
    }
}

/**
 * Create a dynamic tool room with the "app-" prefix.
 * Shows a dialog to let the user pick a name, then creates the room
 * and navigates to it so the user sees the prompt input immediately.
 * @param client - The Matrix client
 * @param space - Optional parent space
 */
export async function createToolRoom(client: MatrixClient, space?: Room | null): Promise<void> {
    const { finished } = Modal.createDialog(TextInputDialog, {
        title: _t("dynamic_room|create_dialog_title"),
        description: _t("dynamic_room|create_dialog_description"),
        button: _t("action|create"),
        placeholder: _t("dynamic_room|create_dialog_placeholder"),
        value: "",
        focus: true,
        hasCancel: true,
    })

    const [ok, rawName] = await finished
    if (!ok || !rawName) return

    const name = `${DYNAMIC_ROOM_PREFIX}${rawName}`
    await createRoomFn(client, {
        name,
        parentSpace: space ?? undefined,
    })
}

/**
 * Check if the user has the rights to create a room in the given space
 * If the space is not provided, it will check if the user has the rights to create a room in general
 * @param matrixClient
 * @param space
 */
export function hasCreateRoomRights(matrixClient: MatrixClient, space?: Room | null): boolean {
    const hasUIRight = shouldShowComponent(UIComponent.CreateRooms)
    if (!space || !hasUIRight) return hasUIRight

    return Boolean(
        space
            ?.getLiveTimeline()
            .getState(EventTimeline.FORWARDS)
            ?.maySendStateEvent(EventType.RoomAvatar, matrixClient.getSafeUserId()),
    )
}
