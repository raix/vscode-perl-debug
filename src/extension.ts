'use strict';

import * as vscode from 'vscode';

const initialConfigurations = {
	version: '0.0.2',
	configurations: [
	{
		type: 'perl',
		request: 'launch',
		exec: 'perl',
		name: 'Perl-Debug',
		root: '${workspaceRoot}/',
		program: '${workspaceRoot}/${command.AskForProgramName}',
		inc: [],
		stopOnEntry: true
	}
]}

export function activate(context: vscode.ExtensionContext) {

	let disposable = vscode.commands.registerCommand('extension.perl-debug.getProgramName', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the name of a perl file in the workspace folder",
			value: "test.pl"
		});
	});
	context.subscriptions.push(disposable);

	context.subscriptions.push(vscode.commands.registerCommand('extension.perl-debug.provideInitialConfigurations', () => {
		return [
			JSON.stringify(initialConfigurations, null, '\t')
		].join('\n');
	}));
}

export function deactivate() {
}
