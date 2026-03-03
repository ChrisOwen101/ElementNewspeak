/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { registerCustomProtocol } from "linkifyjs";

// Linkify supports some common protocols but not others, register all permitted url schemes if unsupported
// https://github.com/nfrasser/linkifyjs/blob/main/packages/linkifyjs/src/scanner.mjs#L171-L177
// This also handles registering the `matrix:` protocol scheme
export const LinkifySupportedProtocols = ["file", "mailto", "http", "https", "ftp", "ftps"];

/**
 * Protocols that do not require a slash in the URL.
 */
export const LinkifyOptionalSlashProtocols = [
    "bitcoin",
    "geo",
    "im",
    "magnet",
    "mailto",
    "matrix",
    "news",
    "openpgp4fpr",
    "sip",
    "sms",
    "smsto",
    "tel",
    "urn",
    "xmpp",
];

/**
 * URL schemes that are safe to be resolved within the context of a Matrix client.
 */
export const PERMITTED_URL_SCHEMES = [
    "bitcoin",
    "ftp",
    "geo",
    "http",
    "https",
    "im",
    "irc",
    "ircs",
    "magnet",
    "mailto",
    "matrix",
    "mms",
    "news",
    "nntp",
    "openpgp4fpr",
    "sip",
    "sftp",
    "sms",
    "smsto",
    "ssh",
    "tel",
    "urn",
    "webcal",
    "wtai",
    "xmpp",
];

// Unfortunately linkify must be configured in the global scope.
PERMITTED_URL_SCHEMES.forEach((scheme) => {
    if (!LinkifySupportedProtocols.includes(scheme)) {
        registerCustomProtocol(scheme, LinkifyOptionalSlashProtocols.includes(scheme));
    }
});

registerCustomProtocol("mxc", false);
