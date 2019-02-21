'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import {
	WorkspaceFolder, DebugConfiguration, ProviderResult,
	CancellationToken
} from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	const debugProvider = new PerlDebugConfigurationProvider();

	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider(
			'perl', debugProvider
		)
	);

	// NOTE: currently disabled, but this allows sending data into an
	// output stream ("Perl Debug" in the Output panel) as possible
	// alternative to logging to the debug console using something like
	// `session.sendEvent('perlDebugOutput', '...')`.

	// const outputChannel = vscode.window.createOutputChannel(
	// 	'Perl Debug'
	// );

	// outputChannel.show(true);

	// context.subscriptions.push(
	// 	vscode.debug.onDidReceiveDebugSessionCustomEvent(
	// 		event => {
	// 			// TODO(bh): Find out if there are event naming conventions.
	// 			if (event.event !== 'perlDebugOutput') {
	// 				return;
	// 			}
	// 			outputChannel.appendLine(event.body);
	// 		}
	// 	)
	// );

}

export function deactivate() {
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
