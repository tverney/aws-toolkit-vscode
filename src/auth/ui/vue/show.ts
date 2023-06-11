/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * This module sets up the necessary components
 * for the webview to be shown.
 */

import { getIdeProperties, isCloud9 } from '../../../shared/extensionUtilities'
import { VueWebview } from '../../../webviews/main'
import * as vscode from 'vscode'
import {
    CredentialsData,
    CredentialsKey,
    SectionName,
    StaticProfile,
    StaticProfileKeyErrorMessage,
} from '../../credentials/types'
import { Auth } from '../../auth'
import { getCredentialFormatError, getCredentialsErrors } from '../../credentials/validation'
import { profileExists } from '../../credentials/sharedCredentials'
import { getLogger } from '../../../shared/logger'
import { AuthUtil as CodeWhispererAuth } from '../../../codewhisperer/util/authUtil'
import { awsIdSignIn } from '../../../codewhisperer/util/showSsoPrompt'
import { CodeCatalystAuthenticationProvider } from '../../../codecatalyst/auth'
import { getStartedCommand } from '../../../codecatalyst/explorer'
import { ToolkitError } from '../../../shared/errors'
import { isBuilderIdConnection } from '../../connection'
import { tryAddCredentials, signout, showRegionPrompter } from '../../utils'
import { Region } from '../../../shared/regions/endpoints'
import { CancellationError } from '../../../shared/utilities/timeoutUtils'
import { validateSsoUrl } from '../../sso/validation'

export class AuthWebview extends VueWebview {
    public override id: string = 'authWebview'
    public override source: string = 'src/auth/ui/vue/index.js'
    public readonly onDidConnectionUpdate = new vscode.EventEmitter<undefined>()

    private codeCatalystAuth: CodeCatalystAuthenticationProvider

    constructor() {
        super()
        const ccAuth = CodeCatalystAuthenticationProvider.instance
        if (ccAuth === undefined) {
            throw new ToolkitError('Code Catalyst auth instance singleton was not created externally yet.')
        }
        this.codeCatalystAuth = ccAuth
    }

    async getProfileNameError(profileName?: SectionName, required = true): Promise<string | undefined> {
        if (!profileName) {
            if (required) {
                return 'Profile name is required'
            }
            return
        }

        if (await profileExists(profileName)) {
            return 'Profile name already exists'
        }
    }

    getCredentialFormatError(key: CredentialsKey, value: string | undefined): string | undefined {
        getLogger().warn('getCredentialFormatError(): %s %s', key, value)
        return getCredentialFormatError(key, value)
    }

    getCredentialsSubmissionErrors(data: CredentialsData): CredentialsData | undefined {
        return getCredentialsErrors(data)
    }

    async trySubmitCredentials(profileName: SectionName, data: StaticProfile) {
        return tryAddCredentials(profileName, data, true)
    }

    isCredentialConnected(): boolean {
        const conn = Auth.instance.activeConnection

        if (!conn) {
            return false
        }
        // Maybe need to use SecondaryAuth registerAuthListener()
        /**
         *
         * When a Builder ID is active and cred is not, the BID is
         * the main active connection. BID's are saveable and checked
         * by registerAuthListenter().
         *
         * What this means is that when creds are activated they become
         * the main Auth.instance.activeConnection and BID is a secondary
         * one.
         *
         * TODO: Show the quickpick and tell them to pick a credentials
         * connection to use.
         *
         */
        return conn.type === 'iam' && conn.state === 'valid'
    }

    async getAuthenticatedCredentialsError(data: StaticProfile): Promise<StaticProfileKeyErrorMessage | undefined> {
        return Auth.instance.authenticateData(data)
    }

    async startCodeWhispererBuilderIdSetup(): Promise<void> {
        try {
            await awsIdSignIn()
        } catch (e) {
            return
        }
    }

    async startCodeCatalystBuilderIdSetup(): Promise<void> {
        return getStartedCommand.execute(this.codeCatalystAuth)
    }

    isCodeWhispererBuilderIdConnected(): boolean {
        return CodeWhispererAuth.instance.isBuilderIdInUse() && CodeWhispererAuth.instance.isConnectionValid()
    }

    isCodeCatalystBuilderIdConnected(): boolean {
        return this.codeCatalystAuth.isConnectionValid()
    }

    async signoutBuilderId(): Promise<void> {
        await this.deleteSavedBuilderIdConns()

        // Deletes active connection
        const builderIdConn = (await Auth.instance.listConnections()).find(isBuilderIdConnection)
        await signout(Auth.instance, builderIdConn)
    }

    private async deleteSavedBuilderIdConns(): Promise<void> {
        if (CodeWhispererAuth.instance.isBuilderIdInUse()) {
            await CodeWhispererAuth.instance.secondaryAuth.removeConnection()
        }

        if (this.codeCatalystAuth.activeConnection) {
            await this.codeCatalystAuth.removeSavedConnection()
        }
    }

    async getIdentityCenterRegion(): Promise<Region> {
        return showRegionPrompter()
    }

    async startIdentityCenterSetup(startUrl: string, regionId: Region['id']) {
        try {
            await CodeWhispererAuth.instance.connectToEnterpriseSso(startUrl, regionId)
        } catch (e) {
            // This scenario will most likely be due to failing to connect from user error.
            // When the sso login process fails (eg: wrong url) they will come back
            // to the IDE and cancel the 'waiting for browser response'
            if (CancellationError.isUserCancelled(e)) {
                return
            }
        }
    }

    isCodeWhispererIdentityCenterConnected(): boolean {
        return CodeWhispererAuth.instance.isEnterpriseSsoInUse() && CodeWhispererAuth.instance.isConnectionValid()
    }

    async signoutIdentityCenter(): Promise<void> {
        const activeConn = CodeWhispererAuth.instance.isEnterpriseSsoInUse()
            ? CodeWhispererAuth.instance.conn
            : undefined
        if (!activeConn) {
            // At this point CW is not actively using IAM IC,
            // even if a valid IAM IC profile exists. We only
            // want to sign out if it being actively used.
            getLogger().warn('authWebview: Attempted to signout of identity center when it was not being used')
            return
        }

        await this.deleteSavedIdentityCenterConns()
        await signout(Auth.instance, activeConn) // deletes active connection
    }

    /**
     * Deletes the saved connection, but it is possible an active one still persists
     */
    private async deleteSavedIdentityCenterConns(): Promise<void> {
        if (CodeWhispererAuth.instance.isEnterpriseSsoInUse()) {
            await CodeWhispererAuth.instance.secondaryAuth.removeConnection()
        }
    }

    getSsoUrlError(url?: string) {
        if (!url) {
            return
        }
        return validateSsoUrl(Auth.instance, url)
    }

    /**
     * Sets up {@link onDidConnectionUpdate} to emit auth change events
     * that happen outside of the webview (eg: status bar > quickpick).
     */
    setupConnectionChangeEmitter() {
        const events = [
            this.codeCatalystAuth.onDidChangeActiveConnection,
            CodeWhispererAuth.instance.secondaryAuth.onDidChangeActiveConnection,
            Auth.instance.onDidChangeActiveConnection,
            Auth.instance.onDidChangeConnectionState,
        ]

        events.forEach(event =>
            event(() => {
                this.onDidConnectionUpdate.fire(undefined)
            })
        )
    }
}

const Panel = VueWebview.compilePanel(AuthWebview)
let activePanel: InstanceType<typeof Panel> | undefined
let subscriptions: vscode.Disposable[] | undefined

export async function showAuthWebview(ctx: vscode.ExtensionContext): Promise<void> {
    activePanel ??= new Panel(ctx)

    activePanel.server.setupConnectionChangeEmitter()

    const webview = await activePanel!.show({
        title: `Add Connection to ${getIdeProperties().company}`,
        viewColumn: isCloud9() ? vscode.ViewColumn.One : vscode.ViewColumn.Active,
    })

    if (!subscriptions) {
        subscriptions = [
            webview.onDidDispose(() => {
                vscode.Disposable.from(...(subscriptions ?? [])).dispose()
                activePanel = undefined
                subscriptions = undefined
            }),
        ]
    }
}