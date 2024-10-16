/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import * as semver from 'semver'
import { isCloud9 } from '../../shared/extensionUtilities'
import { getInlineSuggestEnabled } from '../../shared/utilities/editorUtilities'
import {
    AWSTemplateCaseInsensitiveKeyWords,
    AWSTemplateKeyWords,
    JsonConfigFileNamingConvention,
} from '../models/constants'

export function getLocalDatetime() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return new Date().toLocaleString([], { timeZone: timezone })
}

export function asyncCallWithTimeout<T>(asyncPromise: Promise<T>, message: string, timeLimit: number): Promise<T> {
    let timeoutHandle: NodeJS.Timeout
    const timeoutPromise = new Promise((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(message)), timeLimit)
    })
    return Promise.race([asyncPromise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle)
        return result as T
    })
}

export function isInlineCompletionEnabled() {
    return getInlineSuggestEnabled() && !isCloud9()
}

// This is the VS Code version that started to have regressions in inline completion API
export function isVscHavingRegressionInlineCompletionApi() {
    return semver.gte(vscode.version, '1.78.0') && getInlineSuggestEnabled() && !isCloud9()
}

export function getFileExt(languageId: string) {
    switch (languageId) {
        case 'java':
            return '.java'
        case 'python':
            return '.py'
        default:
            break
    }
    return undefined
}

/**
 * Returns the longest overlap between the Suffix of firstString and Prefix of second string
 * getPrefixSuffixOverlap("adwg31", "31ggrs") = "31"
 */
export function getPrefixSuffixOverlap(firstString: string, secondString: string) {
    let i = Math.min(firstString.length, secondString.length)
    while (i > 0) {
        if (secondString.slice(0, i) === firstString.slice(-i)) {
            break
        }
        i--
    }
    return secondString.slice(0, i)
}

export function checkLeftContextKeywordsForJson(fileName: string, leftFileContent: string, language: string): boolean {
    if (
        language === 'json' &&
        !AWSTemplateKeyWords.some((substring) => leftFileContent.includes(substring)) &&
        !AWSTemplateCaseInsensitiveKeyWords.some((substring) => leftFileContent.toLowerCase().includes(substring)) &&
        !JsonConfigFileNamingConvention.has(fileName.toLowerCase())
    ) {
        return true
    }
    return false
}
