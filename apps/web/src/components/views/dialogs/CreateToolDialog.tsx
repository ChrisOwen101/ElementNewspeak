/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type ChangeEvent, createRef } from "react"

import Field from "../elements/Field"
import { _t } from "../../../languageHandler"
import BaseDialog from "./BaseDialog"
import DialogButtons from "../elements/DialogButtons"

interface IProps {
    onFinished(ok?: false): void
    onFinished(ok: true, name: string, prompt: string): void
}

interface IState {
    name: string
    prompt: string
}

export class CreateToolDialog extends React.Component<IProps, IState> {
    private nameField = createRef<Field>();

    public constructor(props: IProps) {
        super(props)
        this.state = {
            name: "",
            prompt: "",
        }
    }

    public componentDidMount(): void {
        this.nameField.current?.focus()
    }

    private onOk = (ev: React.FormEvent): void => {
        ev.preventDefault()
        if (!this.state.name.trim() || !this.state.prompt.trim()) return
        this.props.onFinished(true, this.state.name.trim(), this.state.prompt.trim())
    };

    private onCancel = (): void => {
        this.props.onFinished(false)
    };

    private static toTitleCase(str: string): string {
        return str.replace(/\b\w/g, (c) => c.toUpperCase())
    }

    private onNameChange = (ev: ChangeEvent<HTMLInputElement>): void => {
        this.setState({ name: CreateToolDialog.toTitleCase(ev.target.value) })
    };

    private onPromptChange = (ev: ChangeEvent<HTMLTextAreaElement>): void => {
        this.setState({ prompt: ev.target.value })
    };

    private get isValid(): boolean {
        return !!this.state.name.trim() && !!this.state.prompt.trim()
    }

    public render(): React.ReactNode {
        return (
            <BaseDialog
                className="mx_CreateToolDialog"
                onFinished={this.props.onFinished}
                title={_t("dynamic_room|create_dialog_title")}
                fixedWidth={false}
            >
                <form onSubmit={this.onOk}>
                    <div className="mx_Dialog_content">
                        <div className="mx_CreateToolDialog_field">
                            <Field
                                ref={this.nameField}
                                type="text"
                                label={_t("dynamic_room|create_dialog_name_label")}
                                value={this.state.name}
                                onChange={this.onNameChange}
                                placeholder={_t("dynamic_room|create_dialog_placeholder")}
                            />
                        </div>
                        <div className="mx_CreateToolDialog_field">
                            <Field
                                element="textarea"
                                label={_t("dynamic_room|create_dialog_prompt_label")}
                                value={this.state.prompt}
                                onChange={this.onPromptChange}
                                placeholder={_t("dynamic_room|create_dialog_prompt_placeholder")}
                                rows={4}
                            />
                        </div>
                    </div>
                </form>
                <DialogButtons
                    primaryButton={_t("action|create")}
                    disabled={!this.isValid}
                    onPrimaryButtonClick={this.onOk}
                    onCancel={this.onCancel}
                    hasCancel={true}
                />
            </BaseDialog>
        )
    }
}
