'use strict';

import * as vscode from 'vscode';
import * as path from 'path';

const initialConfigurations = {
	version: '0.0.5',
	configurations: [
	{
		type: 'perl',
		request: 'launch',
		exec: 'perl',
		execArgs: [],
		name: 'Perl-Debug',
		root: '${workspaceRoot}' + path.sep,
		program: '${workspaceRoot}' + path.sep + '${relativeFile}',
		inc: [],
		args: [],
		stopOnEntry: true
	}
]}

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.commands.registerCommand('extension.perl-debug.provideInitialConfigurations', () => {
		return [
			JSON.stringify(initialConfigurations, null, '\t')
		].join('\n');
	}));
}

export function deactivate() {
}
