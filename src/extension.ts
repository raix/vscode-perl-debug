'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import {
	WorkspaceFolder, DebugConfiguration, ProviderResult,
	CancellationToken
} from 'vscode';

let perlDebugOutputChannel: vscode.OutputChannel | undefined;
let streamCatcherOutputChannel: vscode.OutputChannel | undefined;

function handleStreamCatcherEvent(
	event: vscode.DebugSessionCustomEvent
) {

	if (!streamCatcherOutputChannel) {

		streamCatcherOutputChannel = vscode.window.createOutputChannel(
			'Perl Debug RAW'
		);

		streamCatcherOutputChannel.show(true);

	}

	streamCatcherOutputChannel.appendLine(
		JSON.stringify([
			new Date().toISOString(),
			event.event,
			...event.body,
		])
	);

}

function handleCustomEvent(event: vscode.DebugSessionCustomEvent) {

	if (event.session.type !== 'perl') {
		return;
	}

	switch (event.event) {
		case 'perl-debug.streamcatcher.write':
		case 'perl-debug.streamcatcher.data':
			handleStreamCatcherEvent(event);
			break;
		case 'perl-debug.streamcatcher.clear':
			if (streamCatcherOutputChannel) {
				streamCatcherOutputChannel.clear();
			}
			break;
		default:
			return;
	}

}

export function activate(context: vscode.ExtensionContext) {

	const debugProvider = new PerlDebugConfigurationProvider();

	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider(
			'perl', debugProvider
		)
	);

	context.subscriptions.push(
		vscode.debug.onDidReceiveDebugSessionCustomEvent(
			handleCustomEvent
		)
	);

}

export function deactivate(): Thenable<void> {
	return;
}

class PerlDebugConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is
	 * being launched, e.g. add all missing attributes to the debug
	 * configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		const editor = vscode.window.activeTextEditor;

		if (!config.request && editor.document.languageId === 'perl') {

			const defaultConfig = vscode.extensions.getExtension(
				"mortenhenriksen.perl-debug"
			)
			.packageJSON
			.contributes
			.debuggers[0]
			.initialConfigurations[0];

			return defaultConfig;

		} else if (!config.request) {

			// Not trying to debug perl?
			return undefined;
		}

		if (config.port && !config.console) {
			config.console = 'remote';
		}

		if (!config.console) {
			config.console = 'integratedTerminal';
		}

		return config;
	}
}
